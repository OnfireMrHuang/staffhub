"""Native advertiser-report parameters and their date/granularity rules.

Reference: https://open.oceanengine.com/labels/12/docs/1697466393573376
"""
from datetime import date, datetime, timedelta
import re

from scripts.utils.model import CHINA, ConfigError, Window, now

REPORT_URL = 'https://ad.oceanengine.com/open_api/v1.0/qianchuan/report/advertiser/get/'
HOURLY = 'TIME_GRANULARITY_HOURLY'
DAILY = 'TIME_GRANULARITY_DAILY'
GRANULARITIES = (HOURLY, DAILY)


def granularity(options):
    value = options.get('time_granularity', HOURLY)
    if value not in GRANULARITIES:
        raise ConfigError('time_granularity 仅支持 TIME_GRANULARITY_HOURLY / TIME_GRANULARITY_DAILY')
    return value


def date_window(start_date, end_date, grain):
    if grain not in GRANULARITIES:
        raise ConfigError('时间粒度无效')
    try:
        if any(not isinstance(v, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', v) for v in (start_date, end_date)):
            raise ValueError
        start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    except (TypeError, ValueError) as error:
        raise ConfigError('start_date / end_date 必须为 YYYY-MM-DD 日期') from error
    today = now().date()
    limit = 7 if grain == HOURLY else 30
    if start < today-timedelta(days=180) or start > end or end > today:
        raise ConfigError('千川日期需要在最近 180 天至今天之间，且开始不晚于结束')
    if (end-start).days+1 > limit:
        raise ConfigError(f'该时间粒度单次最多查询 {limit} 个日期（含首尾）')
    return Window(datetime.combine(start, datetime.min.time(), CHINA),
                  datetime.combine(end+timedelta(days=1), datetime.min.time(), CHINA))


def collection_window(task, window):
    grain = granularity(task.options)
    dates = window.dates()
    whole_days = date_window(dates[0], dates[-1], grain)
    return whole_days if grain == DAILY else window


def cli_window(start_date, end_date, grain):
    if bool(start_date) != bool(end_date):
        raise ConfigError('start-date 和 end-date 必须同时提供')
    if start_date:
        return date_window(start_date, end_date, grain)
    previous = Window.parse()
    if grain == DAILY:
        day = (now().date()-timedelta(days=1)).isoformat()
        return date_window(day, day, grain)
    return previous


def request_params(task, day, *, fields, page_size=100):
    """The fixed report is live-commerce data from Qianchuan PC."""
    filtering = {'marketing_goal': 'LIVE_PROM_GOODS', 'order_platform': 'QIANCHUAN'}
    if task.options.get('aweme_ids'):
        filtering['aweme_ids'] = [int(value) for value in task.options['aweme_ids']]
    return {'advertiser_id': int(task.account_id), 'start_date': day, 'end_date': day,
            'fields': list(fields), 'filtering': filtering,
            'time_granularity': granularity(task.options), 'page': 1, 'page_size': page_size}
