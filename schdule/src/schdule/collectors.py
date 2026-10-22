"""The only adapter to the source-owned public API. No auth/API/SQL implementation."""
from copy import deepcopy
from importlib import import_module
from scripts.utils.config import Config
from scripts.utils.cli import validate_credentials
from .errors import ScheduleError, failure
from .models import Target


class Collectors:
    def __init__(self, settings):
        self.settings=settings
        self.configs={}

    def prepare(self,binding):
        source=binding.source
        if source not in self.configs:
            self.configs[source]=Config.load(self.settings.source_path(source))
        config=self.configs[source]
        api=import_module('scripts.'+source+'.cli')
        tasks=import_module('scripts.'+source+'.task')
        if source in ('marketing','qianchuan'):
            accounts=config.data.get('accounts',{})
            if not isinstance(accounts,dict):raise ScheduleError('来源 accounts 必须为对象')
            account=binding.advertise_id
            key=str(int(account)) if account.isascii() and account.isdigit() else account
            options=deepcopy(accounts.get(key,{}))
            if not isinstance(options,dict):raise ScheduleError('来源账户配置必须为对象')
            options.update(binding.options)
            task=tasks.make_task(binding.credential,account,options)
        else:
            if binding.advertise_id:raise ScheduleError('保单计划不能携带广告账户')
            task=tasks.make_task(binding.credential,binding.options)
        validate_credentials(config,task)
        return Target(binding,task,config,api,tasks.validate(task))

    def check(self,target,*,renew=False,threshold=1800,wait=15):
        config=target.config
        if renew:
            data=deepcopy(config.data)
            data.setdefault('settings',{})['refresh_before_seconds']=threshold
            config=Config(config.path,data,[])
        try:
            state=target.api.check_task(config,target.task,renew=renew,force=False,wait_seconds=wait)
            scope=state.get('scope_status','verified')
            if scope not in ('verified','unobserved_no_live_rooms'):scope='unverified'
            # Never return token, Cookie, expiry payload, or provider exceptions to logs.
            return {'code':0,'status':'session_valid','scope_status':scope}
        except Exception as error:return failure(error)

    def collect(self,target,window):
        try:
            result=target.api.collect_task(target.config,target.task,window)
            code=result.get('code')
            if isinstance(code,bool) or not isinstance(code,int) or code not in (0,2,3,4,5,6):
                raise ScheduleError('采集器返回无效退出码',4)
            if code:return failure(ScheduleError({2:'采集配置无效',3:'授权或权限异常',4:'来源采集失败',
                          5:'来源存储或审计失败',6:'采集范围或凭据被占用'}[code],code))
            rows=result.get('rows',0)
            if isinstance(rows,bool) or not isinstance(rows,int) or rows<0:
                raise ScheduleError('采集器返回无效行数',4)
            return {'code':0,'status':'success','rows':rows}
        except Exception as error:return failure(error)
