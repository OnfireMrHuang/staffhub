"""Only scheduler settings; collector credentials remain in their own TOML files."""
from dataclasses import dataclass
from pathlib import Path
import tomllib
from .errors import ScheduleError

SOURCES = ('marketing','qianchuan','pingan','zhongan')


def integer(value, name, low=1, high=86400):
    if isinstance(value,bool) or not isinstance(value,int) or not low<=value<=high:
        raise ScheduleError(f'{name} 必须为 {low}–{high} 的整数')
    return value


@dataclass(frozen=True)
class Settings:
    path: Path
    data: dict

    @classmethod
    def load(cls, path):
        path=Path(path).resolve()
        try:
            data=tomllib.loads(path.read_text(encoding='utf-8'))
        except (OSError,ValueError) as error:
            raise ScheduleError('无法读取调度 TOML 配置') from error
        for name in ('runtime','plan','mysql','sources','authorization','collection','sms'):
            if not isinstance(data.get(name,{}),dict): raise ScheduleError(f'{name} 必须为配置表')
        if data.get('collection',{}).get('on_error','continue') not in ('continue','skip-room','abort'):
            raise ScheduleError('collection.on_error 无效')
        integer(data.get('authorization',{}).get('refresh_before_seconds',1800),'refresh_before_seconds')
        integer(data.get('authorization',{}).get('wait_seconds',15),'wait_seconds',high=1800)
        integer(data.get('plan',{}).get('max_rows',10000),'max_rows',high=100000)
        for section,field in [('sms','enabled'),('collection','notify_on_error')]:
            if not isinstance(data.get(section,{}).get(field,False),bool):
                raise ScheduleError(f'{section}.{field} 必须为布尔值')
        for source,settings in data.get('sources',{}).items():
            if source not in SOURCES or not isinstance(settings,dict) or not isinstance(settings.get('config'),str):
                raise ScheduleError('sources 仅接受四个来源的 config 文件路径')
        return cls(path,data)

    def resolve(self, value):
        if not isinstance(value,str) or not value.strip(): raise ScheduleError('配置路径不能为空')
        path=Path(value)
        return path.resolve() if path.is_absolute() else (self.path.parent/path).resolve()

    @property
    def runtime_dir(self):
        return self.resolve(self.data.get('runtime',{}).get('directory','../runtime'))

    @property
    def max_rows(self):
        return self.data.get('plan',{}).get('max_rows',10000)

    def source_path(self,source):
        try:return self.resolve(self.data['sources'][source]['config'])
        except KeyError as error:raise ScheduleError('未配置任务来源的独立配置文件') from error
