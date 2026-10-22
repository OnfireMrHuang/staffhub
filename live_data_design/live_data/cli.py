"""Batch scheduling CLI; data import and source execution live under scripts."""
from contextlib import nullcontext
from scripts.catalog.repository import CatalogRepository
from scripts.utils.cli import DEFAULT_CONFIG, Parser, run_main
from scripts.utils.config import Config
from scripts.utils.model import ConfigError, SOURCES, Window, timestamp
from scripts.utils.notify import Notifier
from .dispatch import Dispatcher
from .runner import Runner


def parser():
    root = Parser(description='从 MySQL 业务目录调度采集和授权维护（Asia/Shanghai）')
    commands = root.add_subparsers(dest='command', required=True, parser_class=Parser)
    for command in ('collect', 'schedule', 'check-auth', 'authorize', 'auth-maintain'):
        p = commands.add_parser(command)
        p.add_argument('--config', default=DEFAULT_CONFIG)
        p.add_argument('--source', choices=SOURCES)
        p.add_argument('--route-id', action='append', help='从数据库关联生成的任务标识')
        p.add_argument('--credential')
        if command in ('collect', 'schedule'):
            p.add_argument('--start')
            p.add_argument('--end')
            p.add_argument('--dry-run', action='store_true', help='读取 MySQL 业务目录预览调度任务')
        if command in ('authorize', 'auth-maintain'):
            p.add_argument('--wait-seconds', type=int, default=15)
    return root


def select(routes, args):
    result = [route for route in routes if route.enabled and
              (not args.source or route.source == args.source) and
              (not args.route_id or route.route_id in args.route_id) and
              (not args.credential or route.credential == args.credential)]
    if args.route_id and set(args.route_id) != {route.route_id for route in result}:
        raise ConfigError('指定任务不存在、已停用或与筛选条件冲突')
    if not result:
        raise ConfigError('没有匹配的采集任务，请检查来源镜像及关联')
    return result


def execute(args):
    config = Config.load(args.config)
    if hasattr(args, 'wait_seconds') and not 1 <= args.wait_seconds <= 1800:
        raise ConfigError('wait-seconds 必须为1至1800秒')
    collecting = args.command in ('collect', 'schedule')
    window = Window.parse(args.start, args.end) if collecting else None
    catalog = CatalogRepository.connect(config)
    try:
        with catalog.lock('scheduler') if collecting else nullcontext():
            routes = select(catalog.routes(config.credentials), args)
            if getattr(args, 'dry_run', False):
                return {'code': 0, 'dry_run': True, 'route_source': 'mysql_business_catalog',
                        'start': timestamp(window.start), 'end': timestamp(window.end),
                        'routes': [{'route_id': r.route_id, 'source': r.source, 'product_id': r.product_id,
                                    'room_id': r.room_id, 'account_id': r.account_id,
                                    'credential': r.credential} for r in routes]}
            runner = Runner(Dispatcher(config), config.settings.get('on_error', 'continue'),
                            Notifier(config), config.settings.get('alert_on_error', False))
            if args.command == 'auth-maintain':
                return runner.maintain(routes, args.wait_seconds)
            if args.command in ('check-auth', 'authorize'):
                return runner.check(routes, args.command == 'authorize', getattr(args, 'wait_seconds', 15))
            return runner.collect(routes, window)
    finally:
        catalog.close()


def main(argv=None):
    return run_main(execute, parser(), argv, source=None)
