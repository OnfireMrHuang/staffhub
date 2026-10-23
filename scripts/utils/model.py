from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CHINA = ZoneInfo('Asia/Shanghai')
SOURCES = ('marketing', 'qianchuan', 'pingan', 'zhongan')

class LiveError(Exception):
    code = 4
class ConfigError(LiveError):
    code = 2
class AuthError(LiveError):
    code = 3
class DataError(LiveError):
    code = 4
class StorageError(LiveError):
    code = 5
class BusyError(LiveError):
    code = 6
class AlertError(LiveError):
    code = 7

def now():
    return datetime.now(CHINA)

def parse_time(value):
    try:
        dt = datetime.fromisoformat(value)
        return dt.replace(tzinfo=CHINA) if dt.tzinfo is None else dt.astimezone(CHINA)
    except (ValueError, TypeError) as exc:
        raise ConfigError('时间必须为有效 ISO 日期时间') from exc

def timestamp(dt):
    return dt.astimezone(CHINA).strftime('%Y-%m-%d %H:%M:%S')

@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime

    @classmethod
    def parse(cls, start=None, end=None):
        if bool(start) != bool(end):
            raise ConfigError('start 和 end 必须同时提供')
        limit = now().replace(minute=0, second=0, microsecond=0)
        a, b = (parse_time(start), parse_time(end)) if start else (limit-timedelta(hours=1), limit)
        if a >= b or b > limit or any(x.minute or x.second or x.microsecond for x in (a,b)):
            raise ConfigError('需要过去的整小时半开区间，start < end <= 当前整点')
        if b-a > timedelta(days=7):
            raise ConfigError('单次区间不得超过7天；长区间请分批回补')
        return cls(a,b)

    def dates(self):
        a, b = self.start.date(), (self.end-timedelta(seconds=1)).date()
        return [(a+timedelta(days=i)).isoformat() for i in range((b-a).days+1)]

    def contains(self, value):
        return self.start <= parse_time(value) < self.end

@dataclass(frozen=True)
class Task:
    task_id: str
    source: str
    account_id: str = ''
    options: dict = field(default_factory=dict)


@dataclass(frozen=True)
class DayWindow(Window):
    """Date-only backends must not advertise an unused hour interval."""
    @classmethod
    def parse(cls, value=None):
        from datetime import date
        try:
            day = date.fromisoformat(value) if value else now().date()
        except (ValueError, TypeError) as exc:
            raise ConfigError('date 必须为 YYYY-MM-DD') from exc
        if day > now().date():
            raise ConfigError('date 不得晚于今天')
        start = datetime.combine(day, datetime.min.time(), CHINA)
        return cls(start, start + timedelta(days=1))

@dataclass
class Batch:
    ads: list = field(default_factory=list)
    snapshots: list = field(default_factory=list)
    orders: list = field(default_factory=list)
    observed_at: str = field(default_factory=lambda: timestamp(now()))

    @property
    def count(self):
        return len(self.ads)+len(self.snapshots)+len(self.orders)


@dataclass(frozen=True)
class Scope:
    """Normalized resource selection supplied by an individual collector module."""
    resource: tuple
    selector: str = "*"
    namespace: str = ""
