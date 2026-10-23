from dataclasses import dataclass
import re
from pathlib import Path
import tomllib
from .model import ConfigError, SOURCES


def validate_tables(tables, roles):
    """Bind source-owned roles to simple table names in the configured database."""
    if not isinstance(tables, dict) or set(tables) != set(roles):
        raise ConfigError('mysql.tables 必须且仅配置：' + '、'.join(roles))
    for name in tables.values():
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}', name):
            raise ConfigError('表名须为 1–64 位字母、数字或下划线，首位不能是数字；不含库名')
    if len({name.lower() for name in tables.values()}) != len(tables):
        raise ConfigError('同一来源的统计、订单、审计表不能使用相同表名')
    return dict(tables)


@dataclass
class Config:
    path: Path
    data: dict
    routes: list

    @classmethod
    def load(cls,path):
        path = Path(path).resolve()
        try:
            data = tomllib.loads(path.read_text())
        except (OSError,ValueError) as exc:
            raise ConfigError('无法读取 TOML 配置') from exc
        if 'routes' in data:
            raise ConfigError('routes 清单已移除，请配置 master_data 并使用 sync-sources 同步原表')
        routes = []
        if 'credentials' in data:
            raise ConfigError('每类脚本只使用一套授权，请将 credentials 配置改为 [auth]')
        auth = data.get('auth')
        if not isinstance(auth,dict) or auth.get('source') not in SOURCES:
            raise ConfigError('需要配置 [auth] 及本脚本的 source')
        settings=data.get('settings',{})
        if not isinstance(settings,dict) or not isinstance(data.get('mysql',{}),dict):
            raise ConfigError('settings / mysql 必须为配置表')
        if not isinstance(settings.get('alert_on_error',False),bool):
            raise ConfigError('alert_on_error 必须为布尔值')
        sms=data.get('sms',{})
        if not isinstance(sms,dict) or not isinstance(sms.get('enabled',False),bool):
            raise ConfigError('sms.enabled 必须为布尔值')
        if sms.get('enabled'):
            phones=sms.get('phone_numbers')
            if not isinstance(phones,list) or not 1<=len(phones)<=200 or any(not isinstance(p,str) or not re.fullmatch(r'\+[1-9][0-9]{6,14}',p) for p in phones) or len(set(phones))!=len(phones):
                raise ConfigError('短信号码必须为不重复的 E.164 数组')
            if any(not isinstance(sms.get(k),str) or not sms[k].strip() or 'REPLACE' in sms[k] for k in ('sdk_app_id','sign_name','template_id')):
                raise ConfigError('启用短信前需配置真实 sdk_app_id / sign_name / template_id')
            if not isinstance(sms.get('template_params',[]),list) or any(not isinstance(p,str) for p in sms.get('template_params',[])):
                raise ConfigError('短信 template_params 必须为字符串数组')
        if settings.get('on_error','continue') not in ('continue','skip-room','abort'):
            raise ConfigError('on_error 无效')
        for key,default in [('refresh_before_seconds',1800),('alert_cooldown_seconds',1800),('timeout_seconds',30),('max_pages',10000)]:
            v=settings.get(key,default)
            if isinstance(v,bool) or not isinstance(v,int) or v<=0:
                raise ConfigError(f'{key} 必须为正整数')
        return cls(path,data,routes)

    @property
    def auth(self): return self.data['auth']
    @property
    def settings(self): return self.data.get('settings',{})
    @property
    def state_dir(self): return self.resolve(self.settings.get('state_dir','../runtime'))
    def resolve(self,value):
        p=Path(value)
        return p.resolve() if p.is_absolute() else (self.path.parent/p).resolve()
    @property
    def state_path(self):
        return self.state_dir/self.auth['source']/'auth.json'
    @property
    def browser_dir(self):
        return self.state_dir/self.auth['source']/'browser'
    def database_tables(self, roles):
        return validate_tables(self.data.get('mysql', {}).get('tables'), roles)
    def database_kwargs(self):
        db=self.data.get('mysql',{})
        password=db.get('password')
        if not isinstance(password,str): raise ConfigError('请在 mysql.password 中配置字符串密码')
        return {'host':db.get('host','127.0.0.1'),'port':int(db.get('port',3306)), 'user':db.get('user','live_data'), 'password':password,'database':db.get('database','live_data'), 'charset':'utf8mb4','autocommit':False,'connect_timeout':10,'read_timeout':60,'write_timeout':60}
