"""Manage source-table imports and schema setup independently from the scheduler."""
import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx

from catalog import catalog_routes, normalize_catalog
from catalog.master_data import TABLES, map_tables, read_sources
from catalog.repository import CatalogRepository
from scripts.utils.config import Config
from scripts.utils.database import Database
from scripts.utils.model import ConfigError, LiveError, SOURCES


class Parser(argparse.ArgumentParser):
    def error(self, message): raise ConfigError(message)


def parser():
    result = Parser(description='来源表校验、业务目录导入及采集器数据库初始化')
    commands = result.add_subparsers(dest='command', required=True, parser_class=Parser)
    for command in ('init-db', 'inspect-sources', 'sync-sources', 'validate-config'):
        item = commands.add_parser(command)
        item.add_argument('--config', default=str(Path(__file__).resolve().parent / 'config/local.toml'))
        if command == 'sync-sources':
            item.add_argument('--dry-run', action='store_true', help='完整读取校验来源，预览任务，不连接 MySQL')
    return result


def source_summary(snapshot, credentials):
    catalog = normalize_catalog(snapshot)
    return {'code': 0, 'rows': {key: len(value) for key, value in snapshot.items()},
            'catalog_counts': {key: len(value) for key, value in catalog.items()},
            'derived_tasks': len(catalog_routes(catalog, credentials))}


def execute(args):
    config = Config.load(args.config)
    master = config.data.get('master_data', {})
    if args.command in ('inspect-sources', 'sync-sources'):
        if master.get('mode') not in ('json', 'feishu', 'xlsx') or set(master.get('tables', {})) != set(TABLES):
            raise ConfigError('需要配置 master_data.mode 及三张来源表映射')
    if args.command == 'validate-config':
        return {'code': 0, 'source_mode': master.get('mode'), 'credentials': len(config.credentials),
                'message': '配置结构有效；请运行 inspect-sources 和 sync-sources --dry-run 校验原表'}
    if args.command == 'inspect-sources' or (args.command == 'sync-sources' and args.dry_run):
        with httpx.Client(timeout=config.settings.get('timeout_seconds', 30), follow_redirects=False) as client:
            tables = read_sources(config, client, headers_only=args.command == 'inspect-sources')
        if args.command == 'inspect-sources':
            return {'code': 0, 'message': '仅显示适配后的字段表头，不输出数据行', 'tables': {
                name: {'sheet_id': table.get('sheet_id'), 'title': table.get('title'),
                       'headers': table.get('values', [[]])[0]} for name, table in tables.items()}}
        return {**source_summary(map_tables(tables, config.data), config.credentials), 'dry_run': True}
    database = Database.connect(config)
    try:
        catalog = CatalogRepository(database.connection)
        with database.lock('catalog-import'):
            if args.command == 'init-db':
                from registry import get
                catalog.init_schema()
                for source in SOURCES:
                    get(source).Repository(database.connection).init_schema()
                return {'code': 0, 'message': '来源镜像、业务目录和各采集器事实表与查询视图已创建或更新'}
            if args.command == 'sync-sources':
                with httpx.Client(timeout=config.settings.get('timeout_seconds', 30), follow_redirects=False) as client:
                    snapshot = map_tables(read_sources(config, client), config.data)
                catalog.sync_sources(snapshot)
                return source_summary(snapshot, config.credentials)
        raise ConfigError('未知的目录管理命令')
    finally:
        database.close()


def main(argv=None):
    try:
        result = execute(parser().parse_args(argv))
    except LiveError as exc:
        result = {'code': exc.code, 'message': str(exc)}
    except KeyboardInterrupt:
        result = {'code': 130, 'message': '任务已中止'}
    except Exception as exc:
        result = {'code': 4, 'message': '运行失败，请检查依赖安装、配置结构及数据库可用性',
                  'error_type': type(exc).__name__}
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return result['code']


if __name__ == '__main__':
    raise SystemExit(main())
