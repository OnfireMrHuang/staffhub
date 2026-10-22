"""Standalone Qianchuan commands: arguments, component assembly, and execution."""
import httpx

from scripts.utils.cli import common_parser, preview, read_task_file, run_main, validate_credentials
from scripts.utils.config import Config
from scripts.utils.model import ConfigError, Window
from scripts.utils.runtime import CollectionService, error_result
from scripts.utils.transport import Transport
from .auth import Auth
from .collector import Collector
from .repository import Repository
from .task import make_task, validate

SOURCE = 'qianchuan'
TASK_FIELDS = ('product_id', 'room_id', 'credential', 'advertiser_id', 'app_id',
               'account_scope', 'aweme_id', 'aweme_internal_id', 'metrics')


def parser():
    root, commands = common_parser('千川单任务采集、检查授权与人工授权；无需业务目录')
    for command, sub in commands.items():
        if command == 'init-db':
            continue
        sub.add_argument('--advertiser-id')
        sub.add_argument('--app-id')
        scope = sub.add_mutually_exclusive_group()
        scope.add_argument('--account-scope', action='store_true', default=None)
        scope.add_argument('--aweme-id')
        scope.add_argument('--aweme-internal-id', help='已核实的千川主播内部 ID')
        if command == 'collect':
            sub.add_argument('--metrics', help='逗号分隔的来源指标字段名')
    return root


def read_task(args):
    data = read_task_file(args, SOURCE, TASK_FIELDS)
    if data is not None:
        route = make_task(**data)
    else:
        options = {}
        for field in ('account_scope', 'aweme_id'):
            value = getattr(args, field, None)
            if value is not None:
                options[field] = value
        if getattr(args, 'aweme_internal_id', None) is not None:
            options['aweme_ids'] = [args.aweme_internal_id]
        if getattr(args, 'app_id', None) is not None:
            options['expected_app_id'] = args.app_id
        if getattr(args, 'metrics', None) is not None:
            options['metrics'] = [field.strip() for field in args.metrics.split(',')]
        route = make_task(args.product_id, args.room_id, args.credential,
                          getattr(args, 'advertiser_id', '') or '', options)
    if not route.options.get('expected_app_id'):
        raise ConfigError('千川任务必须提供 --app-id 或 options.expected_app_id')
    return route


def execute(args):
    config = Config.load(args.config)
    if args.command == 'init-db':
        repository = Repository.connect(config)
        try:
            repository.init_schema()
        finally:
            repository.close()
        return {'code': 0, 'source': SOURCE, 'status': 'initialized'}
    route = read_task(args)
    validate(route)
    validate_credentials(config, route)
    if args.command == 'authorize' and not 1 <= args.wait_seconds <= 1800:
        raise ConfigError('wait-seconds 必须为1至1800秒')
    window = Window.parse(args.start, args.end) if args.command == 'collect' else None
    if args.command == 'collect' and args.dry_run:
        return preview(route, window)
    if args.command in ('check-auth', 'authorize'):
        try:
            state = check_task(config, route, renew=args.command == 'authorize', force=args.command == 'authorize',
                               wait_seconds=getattr(args, 'wait_seconds', 15))
            return {'code': 0, 'source': SOURCE, 'task_id': route.route_id, 'route_id': route.route_id,
                    'status': 'session_valid', 'scope_status': state.get('scope_status', 'verified')}
        except Exception as error:
            return error_result(error, route)
    return collect_task(config, route, window)


def check_task(config, route, renew=False, force=False, wait_seconds=15):
    """Probe or maintain one task's authorization without opening MySQL."""
    validate(route)
    validate_credentials(config, route)
    if not 1 <= wait_seconds <= 1800:
        raise ConfigError('wait-seconds 必须为1至1800秒')
    with httpx.Client(timeout=config.settings.get('timeout_seconds', 30), follow_redirects=False) as client:
        return Auth(config, client).ensure(route, renew=renew, force=force, wait_seconds=wait_seconds)


def collect_task(config, route, window):
    """Assemble and close the Qianchuan-owned collection components."""
    validate(route)
    validate_credentials(config, route)
    with httpx.Client(timeout=config.settings.get('timeout_seconds', 30), follow_redirects=False) as client:
        repository = Repository.connect(config)
        try:
            auth = Auth(config, client)
            collector = Collector(Transport(client), config.settings.get('max_pages', 10000))
            return CollectionService(repository, auth, collector).execute(route, window)
        finally:
            repository.close()


def main(argv=None):
    return run_main(execute, parser(), argv, SOURCE)
