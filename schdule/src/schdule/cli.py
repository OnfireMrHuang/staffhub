"""Two finite scheduled jobs; cron owns time triggers, source projects own collection."""
import argparse
import json
import sys
from .config import Settings
from .errors import ScheduleError, failure
from .collectors import Collectors
from .plan import load_mysql,load_fixture,build_plan
from .runtime import Run
from .notify import Notifier
from . import authorization,collection
from scripts.utils.model import Window


class Parser(argparse.ArgumentParser):
    def error(self,message):raise ScheduleError('调度参数无效，请使用 --help 查看')


def parser(job):
    root=Parser(prog='schdule-'+job)
    root.add_argument('--config',default='config/local.toml')
    root.add_argument('--dry-run',action='store_true')
    root.add_argument('--plan-file',help='仅 dry-run 允许的离线投影 JSON')
    if job=='collect':
        root.add_argument('--start')
        root.add_argument('--end')
    return root


def execute(job,args):
    settings=Settings.load(args.config)
    if args.plan_file and not args.dry_run:raise ScheduleError('--plan-file 仅用于 dry-run；正式运行必须读取 MySQL')
    window=Window.parse(args.start,args.end) if job=='collect' else None
    # Verify complete configuration before taking any source-side action.
    notifier=Notifier(settings)
    adapter=Collectors(settings)
    def read_plan():
        bindings=load_fixture(args.plan_file,settings.max_rows) if args.plan_file else load_mysql(settings)
        return build_plan(bindings,adapter)
    if args.dry_run:
        targets=read_plan()
        result={'code':0,'job':job,'dry_run':True,'tasks':[]}
        for target in targets:
            item=target.summary()
            if window:item['periods']=[{'start':p.start.isoformat(),'end':p.end.isoformat()} for p in collection.windows(target,window)]
            result['tasks'].append(item)
        return result
    with Run(settings.runtime_dir,job) as run:
        targets=read_plan()
        if job=='auth':
            options=settings.data.get('authorization',{})
            return authorization.execute(targets,adapter,run,notifier,
                threshold=options.get('refresh_before_seconds',1800),wait=options.get('wait_seconds',15))
        options=settings.data.get('collection',{})
        return collection.execute(targets,adapter,run,notifier,window,
            on_error=options.get('on_error','continue'),notify=options.get('notify_on_error',False))


def main(job,argv=None):
    try:
        args=parser(job).parse_args(argv)
        result=execute(job,args)
    except KeyboardInterrupt:result={'code':130,'job':job,'status':'interrupted'}
    except Exception as error:result={**failure(error),'job':job}
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))
    return result['code']


def auth_main():return main('auth')
def collect_main():return main('collect')


def module_main():
    if len(sys.argv)<2 or sys.argv[1] not in ('auth','collect'):
        print('usage: python -m schdule {auth|collect} [options]')
        return 2
    return main(sys.argv[1],sys.argv[2:])
