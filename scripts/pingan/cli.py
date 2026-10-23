"""Own command arguments, configuration and concrete execution components."""
import httpx
from scripts.utils.cli import Parser, preview, run_main, validate_auth_config
from scripts.utils.config import Config
from scripts.utils.model import ConfigError, Window
from scripts.utils.runtime import CollectionService, error_result
from scripts.utils.transport import Transport
from .task import make_task, validate
from .auth import Auth
from .collector import Collector
from .repository import Repository


def parser():
    root = Parser(description='pingan 独立采集项目')
    commands = root.add_subparsers(dest='command', required=True, parser_class=Parser)
    for name in ('check-auth','authorize','collect'):
        p = commands.add_parser(name)
        p.add_argument('--config', default='config/local.toml')
        p.add_argument('--channel', required=True)
        if name == 'collect':
            p.add_argument('--start')
            p.add_argument('--end')
            p.add_argument('--dry-run', action='store_true')
        if name == 'authorize': p.add_argument('--wait-seconds', type=int, default=15)
    return root


def read_task(args, config):
    return make_task(options={'channel':args.channel})



def check_task(config, task, renew=False, force=False, wait_seconds=15):
    validate(task)
    validate_auth_config(config, task)
    if not 1 <= wait_seconds <= 1800: raise ConfigError('wait-seconds 必须为1至1800秒')
    with httpx.Client(timeout=config.settings.get('timeout_seconds',30),follow_redirects=False) as client:
        return Auth(config,client).ensure(task,renew=renew,force=force,wait_seconds=wait_seconds)


def validate_collection_config(config):
    return Repository.configured_tables(config)


def collect_task(config, task, window):
    validate(task)
    validate_auth_config(config, task)
    with httpx.Client(timeout=config.settings.get('timeout_seconds',30),follow_redirects=False) as client:
        repository = Repository.connect(config)
        try:
            return CollectionService(repository, Auth(config,client),
                Collector(Transport(client), config.settings.get('max_pages',10000))).execute(task,window)
        finally:
            repository.close()


def execute(args):
    config = Config.load(args.config)
    task = read_task(args,config)
    validate_auth_config(config,task)
    if args.command == 'collect':
        validate_collection_config(config)
        window = Window.parse(args.start, args.end)
        if args.dry_run: return preview(task,window)
        try: return collect_task(config,task,window)
        except Exception as error: return error_result(error,task)
    try:
        state = check_task(config,task,renew=args.command=='authorize',force=args.command=='authorize',
                           wait_seconds=getattr(args,'wait_seconds',15))
        return {'code':0,'source':'pingan','task_id':task.task_id,'status':'session_valid',
                'scope_status':state.get('scope_status','verified')}
    except Exception as error:
        return error_result(error,task)


def main(argv=None):
    return run_main(execute,parser(),argv,'pingan')
