"""Business ownership stays in the orchestration plan, outside source tasks."""
from dataclasses import dataclass, field
from scripts.utils.model import ConfigError

@dataclass(frozen=True)
class Route:
    route_id: str
    product_id: str
    room_id: str
    source: str
    credential: str
    account_id: str = ''
    options: dict = field(default_factory=dict)
    enabled: bool = True

    @property
    def task_id(self):
        return self.collector_task.task_id

    @property
    def collector_task(self):
        from registry import get
        module=get(self.source)
        # These labels are used by output columns, not query/business ownership.
        options={key:value for key,value in self.options.items()
                 if key not in ('expected_app_id','room_name')}
        if self.source=='qianchuan' and self.options.get('room_name') is not None:
            options['room_name']=self.options['room_name']
        if self.source in ('marketing','qianchuan'):
            return module.task.make_task(self.credential,self.account_id,options)
        options={k:v for k,v in options.items() if k in ('channel','dy_no','platform')}
        return module.task.make_task(self.credential,options)

    @classmethod
    def from_dict(cls,data):
        try:return cls(**data)
        except TypeError as exc:raise ConfigError('计划字段缺失或包含未知字段') from exc
