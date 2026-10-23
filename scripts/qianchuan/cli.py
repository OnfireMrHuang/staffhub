"""Own command arguments, configuration and concrete execution components."""
import httpx
from scripts.utils.cli import Parser, preview, run_main, validate_auth_config
from scripts.utils.config import Config
from scripts.utils.model import ConfigError
from scripts.utils.runtime import CollectionService, error_result
from scripts.utils.transport import Transport
from .task import make_task, validate, configured_options
from .auth import Auth
from .collector import Collector
from .repository import Repository
from .parameters import GRANULARITIES, cli_window, collection_window


def parser():
    root = Parser(description='qianchuan 独立采集项目', allow_abbrev=False)
    commands = root.add_subparsers(dest='command', required=True, parser_class=Parser)
    for name in ('check-auth','authorize','collect','init-db'):
        p = commands.add_parser(name, allow_abbrev=False)
        p.add_argument('--config', default='config/local.toml')
        if name == 'init-db': continue
        p.add_argument('--advertiser-id', '--advertise-id', dest='advertise_id', required=True, help='接口 advertiser_id；兼容旧 --advertise-id')
        if name == 'collect':
            p.add_argument('--start-date')
            p.add_argument('--end-date')
            p.add_argument('--time-granularity', choices=GRANULARITIES)
            p.add_argument('--aweme-ids', nargs='+', help='filtering.aweme_ids 内部 ID；本汇表每次保存一个主播')
            p.add_argument('--dry-run', action='store_true')
    return root


def read_task(args, config):
    accounts = config.data.get('accounts', {})
    if not isinstance(accounts, dict): raise ConfigError('accounts 必须为配置表')
    options = accounts.get(str(int(args.advertise_id)) if args.advertise_id.isdigit() else args.advertise_id, {})
    if not isinstance(options, dict): raise ConfigError('账户展示配置必须为对象')
    options = configured_options(config, options)
    if getattr(args, 'time_granularity', None): options['time_granularity'] = args.time_granularity
    if getattr(args, 'aweme_ids', None): options['aweme_ids'] = args.aweme_ids
    return make_task(args.advertise_id, options)



def check_task(config, task, renew=False, force=False, wait_seconds=15):
    validate(task)
    validate_auth_config(config, task)
    if not 1 <= wait_seconds <= 1800: raise ConfigError('wait-seconds 必须为1至1800秒')
    with httpx.Client(timeout=config.settings.get('timeout_seconds',30),follow_redirects=False) as client:
        return Auth(config,client).ensure(task,renew=renew,force=force,wait_seconds=wait_seconds)


def collect_task(config, task, window):
    validate(task)
    validate_auth_config(config, task)
    window = collection_window(task, window)
    with httpx.Client(timeout=config.settings.get('timeout_seconds',30),follow_redirects=False) as client:
        repository = Repository.connect(config)
        try:
            return CollectionService(repository, Auth(config,client),
                Collector(Transport(client), config.settings.get('max_pages',10000))).execute(task,window)
        finally:
            repository.close()


def execute(args):
    config = Config.load(args.config)
    if args.command == 'init-db':
        repository = Repository.connect(config)
        try: repository.init_schema()
        finally: repository.close()
        return {'code':0,'source':'qianchuan','status':'schema_ready'}
    task = read_task(args,config)
    validate_auth_config(config,task)
    if args.command == 'collect':
        window = cli_window(args.start_date, args.end_date, task.options['time_granularity'])
        if args.dry_run: return preview(task,window)
        try: return collect_task(config,task,window)
        except Exception as error: return error_result(error,task)
    try:
        state = check_task(config,task,renew=args.command=='authorize',force=args.command=='authorize',
                           wait_seconds=getattr(args,'wait_seconds',15))
        return {'code':0,'source':'qianchuan','task_id':task.task_id,'status':'session_valid',
                'scope_status':state.get('scope_status','verified')}
    except Exception as error:
        return error_result(error,task)


def main(argv=None):
    return run_main(execute,parser(),argv,'qianchuan')
