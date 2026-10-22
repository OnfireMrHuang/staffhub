from dataclasses import dataclass
import json
from .config import SOURCES
from .errors import ScheduleError


def required_text(value,name):
    if not isinstance(value,str) or not value.strip() or len(value.strip())>128:
        raise ScheduleError(f'计划 {name} 必须为 1–128 字符的文本')
    return value.strip()


@dataclass(frozen=True)
class Binding:
    product_id: str
    room_id: str
    source: str
    credential: str
    advertise_id: str
    options: dict

    @classmethod
    def parse(cls,row):
        if not isinstance(row,dict):raise ScheduleError('计划行必须为对象')
        names={'product_id','room_id','source','credential','advertise_id','options'}
        if set(row)-names:raise ScheduleError('计划投影包含未知列')
        source=required_text(row.get('source'),'source')
        if source not in SOURCES:raise ScheduleError('计划来源不受支持')
        options=row.get('options',{})
        if isinstance(options,str):
            try:options=json.loads(options)
            except ValueError as error:raise ScheduleError('计划 options 不是有效 JSON') from error
        if not isinstance(options,dict):raise ScheduleError('计划 options 必须为 JSON 对象')
        account=row.get('advertise_id') or ''
        if not isinstance(account,str):raise ScheduleError('advertise_id 必须通过 SQL 转换为字符串')
        return cls(required_text(row.get('product_id'),'product_id'),required_text(row.get('room_id'),'room_id'),
                   source,required_text(row.get('credential'),'credential'),account,options)

    @property
    def room_key(self):return self.product_id,self.room_id


@dataclass(frozen=True)
class Target:
    binding: Binding
    task: object
    config: object
    api: object
    scope: object

    @property
    def auth_key(self):
        return self.binding.source,str(self.config.path),self.binding.credential

    def summary(self):
        return {'product_id':self.binding.product_id,'room_id':self.binding.room_id,
                'source':self.binding.source,'credential':self.binding.credential,'task_id':self.task.task_id}
