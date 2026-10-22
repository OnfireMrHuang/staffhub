"""Independent zhongan commands and concrete component composition."""
import httpx
from scripts.utils.cli import common_parser, read_task_file, run_main, validate_credentials, preview
from scripts.utils.config import Config
from scripts.utils.model import ConfigError, Window
from scripts.utils.runtime import CollectionService, error_result
from scripts.utils.transport import Transport
from .auth import Auth
from .collector import Collector
from .repository import Repository
from .task import make_task, validate

TASK_FIELDS = ('product_id', 'room_id', 'credential', 'dy_no', 'platform')


def parser():
    root, commands = common_parser('zhongan 单任务采集、检查授权与人工授权；无需业务目录')
    for name, command in commands.items():
        if name == 'init-db':
            continue
        command.add_argument('--dy-no')
        command.add_argument('--platform')
    return root


def read_task(args):
    data = read_task_file(args, 'zhongan', TASK_FIELDS)
    if data is not None:
        return make_task(**data)
    return make_task(args.product_id, args.room_id, args.credential, options={key: value for key, value in [('dy_no', args.dy_no), ('platform', args.platform)] if value is not None})


def check_task(config, route, renew=False, force=False, wait_seconds=15):
    validate(route)
    validate_credentials(config, route)
    if not 1 <= wait_seconds <= 1800:
        raise ConfigError('wait-seconds 必须为1至1800秒')
    with httpx.Client(timeout=config.settings.get('timeout_seconds', 30), follow_redirects=False) as client:
        return Auth(config, client).ensure(route, renew=renew, force=force, wait_seconds=wait_seconds)


def collect_task(config, route, window):
    validate(route)
    validate_credentials(config, route)
    with httpx.Client(timeout=config.settings.get('timeout_seconds', 30), follow_redirects=False) as client:
        repository = Repository.connect(config)
        try:
            collector = Collector(Transport(client), config.settings.get('max_pages', 10000))
            return CollectionService(repository, Auth(config, client), collector).execute(route, window)
        finally:
            repository.close()


def execute(args):
    config = Config.load(args.config)
    if args.command == 'init-db':
        repository = Repository.connect(config)
        try:
            repository.init_schema()
        finally:
            repository.close()
        return {'code': 0, 'source': 'zhongan', 'status': 'initialized'}
    route = read_task(args)
    validate_credentials(config, route)
    base = {'code': 0, 'source': 'zhongan', 'task_id': route.route_id, 'route_id': route.route_id}
    if args.command in ('check-auth', 'authorize'):
        try:
            state = check_task(config, route, renew=args.command == 'authorize', force=args.command == 'authorize',
                               wait_seconds=getattr(args, 'wait_seconds', 15))
            return {**base, 'status': 'session_valid', 'scope_status': state.get('scope_status', 'verified')}
        except Exception as error:
            return error_result(error, route)
    window = Window.parse(args.start, args.end)
    if args.dry_run:
        return preview(route, window)
    return collect_task(config, route, window)


def main(argv=None):
    return run_main(execute, parser(), argv, 'zhongan')
