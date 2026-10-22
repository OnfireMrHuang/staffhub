"""CLI primitives. Concrete command composition belongs to each source package."""
import argparse
import json
from pathlib import Path
from .model import ConfigError, timestamp
from .runtime import error_result

DEFAULT_CONFIG = str(Path(__file__).resolve().parents[2] / 'config/local.toml')


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ConfigError('命令行参数无效，请使用 --help 检查必需字段和选项')


def common_parser(description):
    root = Parser(description=description)
    commands = root.add_subparsers(dest='command', required=True, parser_class=Parser)
    parsers = {}
    for command in ('collect', 'check-auth', 'authorize', 'init-db'):
        p = parsers[command] = commands.add_parser(command)
        p.add_argument('--config', default=DEFAULT_CONFIG)
        if command == 'init-db':
            continue
        p.add_argument('--task-file', help='不含凭据内容的单任务 JSON，与显式任务参数互斥')
        for field in ('product-id', 'room-id', 'credential'):
            p.add_argument('--' + field)
        if command == 'collect':
            p.add_argument('--start')
            p.add_argument('--end')
            p.add_argument('--dry-run', action='store_true', help='离线校验任务；不鉴权、不联网、不连接数据库')
        if command == 'authorize':
            p.add_argument('--wait-seconds', type=int, default=15)
    return root, parsers


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ConfigError('任务 JSON 字段不得重复')
        result[key] = value
    return result


def read_task_file(args, source, task_fields):
    if not args.task_file:
        return None
    if any(getattr(args, field, None) is not None for field in task_fields):
        raise ConfigError('--task-file 与显式任务参数不能混用')
    try:
        path = Path(args.task_file)
        if path.stat().st_size > 128 * 1024:
            raise ConfigError('任务文件不得超过128KB')
        data = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=_unique_object)
    except (OSError, ValueError) as exc:
        raise ConfigError('无法读取有效任务 JSON') from exc
    allowed = {'product_id', 'room_id', 'source', 'credential', 'account_id', 'options'}
    required = {'product_id', 'room_id', 'source', 'credential'}
    if not isinstance(data, dict) or set(data) - allowed or required - set(data):
        raise ConfigError('任务 JSON 缺少必需字段或含未知字段；不得包含凭据内容')
    if data.pop('source') != source:
        raise ConfigError('任务文件来源与脚本来源不一致')
    return data


def validate_credentials(config, route):
    profile = config.credentials.get(route.credential)
    if not profile or profile.get('source') != route.source:
        raise ConfigError('任务凭据别名不存在或来源不匹配')


def preview(route, window):
    return {'code': 0, 'source': route.source, 'task_id': route.route_id,
            'route_id': route.route_id, 'status': 'planned', 'dry_run': True,
            'start': timestamp(window.start), 'end': timestamp(window.end),
            'task': {'source': route.source, 'product_id': route.product_id, 'room_id': route.room_id,
                     'credential': route.credential, 'account_id': route.account_id, 'options': route.options}}


def run_main(execute, parser, argv, source):
    try:
        result = execute(parser.parse_args(argv))
    except KeyboardInterrupt:
        result = {'code': 130, 'source': source, 'task_id': None,
                  'status': 'interrupted', 'message': '任务已中止'}
    except Exception as error:
        result = error_result(error, source=source)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return result['code']
