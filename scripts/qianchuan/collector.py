"""Qianchuan native hourly/daily advertiser reports with complete pagination."""
import json
from decimal import Decimal, InvalidOperation

from scripts.utils.model import AuthError, DataError, parse_time, timestamp
from .models import ReportBatch
from .contracts import default_metrics, with_collection
from .task import validate
from .parameters import DAILY, HOURLY, REPORT_URL, collection_window, request_params


class Collector:
    def __init__(self, transport, max_pages=10000):
        self.transport, self.max_pages = transport, max_pages

    def query(self, params, token):
        body = self.transport.request('GET', REPORT_URL, headers={'Access-Token': token},
            params={key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
                    for key, value in params.items()})
        if body.get('code') != 0:
            if str(body.get('code')) in {'401', '40100', '40102', '40105', '40106'}:
                raise AuthError('千川访问令牌无效，请维护授权')
            raise DataError('千川业务请求失败；请检查应用权限及字段配置')
        return body

    def collect(self, route, window, session):
        validate(route)
        window = collection_window(route, window)
        token = session['access_token']
        ids = route.options.get('aweme_ids', [])
        batch = ReportBatch(aweme_id=str(int(ids[0])) if ids else '')
        seen_rows = set()
        for day in window.dates():
            params = request_params(route, day, fields=default_metrics())
            self._collect_day(route, window, params, token, batch, seen_rows)
        return batch

    def _collect_day(self, route, window, params, token, batch, seen_rows):
        total = expected = None
        fingerprints = set()
        count = 0
        for page in range(1, self.max_pages + 1):
            payload = self.query({**params, 'page': page}, token)
            data = payload.get('data')
            if not isinstance(data, dict):
                raise DataError('千川报表缺少数据对象')
            rows = data.get('list')
            info = data.get('page_info')
            if not isinstance(info, dict):
                raise DataError('千川报表缺少完整分页信息')
            pages, size = info.get('total_page'), info.get('total_number')
            if (not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows)
                    or isinstance(pages, bool) or not isinstance(pages, int) or pages < 0):
                raise DataError('千川报表缺少行数据或完整分页信息')
            if isinstance(size, bool) or not isinstance(size, int) or size < 0:
                raise DataError('千川缺少有效 total_number，无法证明采集完整')
            if total is None:
                total, expected = pages, size
            elif total != pages or expected != size:
                raise DataError('采集期间分页总数变化')
            fingerprint = json.dumps(rows, sort_keys=True)
            if rows and fingerprint in fingerprints:
                raise DataError('千川分页重复')
            fingerprints.add(fingerprint)
            count += len(rows)
            if (not rows and total > 1) or (rows and total == 0):
                raise DataError('千川分页提前结束')
            for row in rows:
                self._append_row(route, window, params, page, row, batch, seen_rows)
            if page >= total:
                if count != expected:
                    raise DataError('千川数据条数不完整')
                break
        else:
            raise DataError('千川报表超过最大页数')

    @staticmethod
    def _append_row(route, window, params, page, row, batch, seen_rows):
        dimensions = {'stat_datetime': row.get('stat_datetime'),
                      'advertiser_id': str(row.get('advertiser_id', route.account_id))}
        metrics = {key: value for key, value in row.items() if key not in dimensions}
        if dimensions['advertiser_id'] != route.account_id:
            raise DataError('千川响应账户与请求不一致')
        hour = dimensions['stat_datetime']
        if not isinstance(hour, str):
            raise DataError('来源未返回 stat_datetime，禁止将区间合计当作时间分桶写入')
        try:
            dt = parse_time(hour)
        except Exception as exc:
            raise DataError('来源统计时间格式无效') from exc
        grain = params['time_granularity']
        if dt.minute or dt.second or dt.microsecond or (grain == DAILY and dt.hour):
            raise DataError('来源 stat_datetime 不符合请求的时间粒度')
        if not window.contains(hour):
            return
        key = timestamp(dt), json.dumps(dimensions, sort_keys=True)
        if key in seen_rows:
            raise DataError('千川数据出现重复维度')
        seen_rows.add(key)
        try:
            cost = Decimal(str(metrics['stat_cost'])) if metrics.get('stat_cost') is not None else None
            if cost is not None and not cost.is_finite():
                raise InvalidOperation
        except (InvalidOperation, ValueError) as exc:
            raise DataError('金额不是有限数值') from exc
        options = route.options
        internal_ids = params.get('filtering', {}).get('aweme_ids', [])
        context = {
            'advertiser_id': route.account_id, 'account_name': options.get('account_name'),
            'account_type': options.get('account_type'), 'stat_platform': '巨量千川',
            'stat_time_hour': timestamp(dt) if grain == HOURLY else None, 'stat_time_day': dt.date().isoformat(),
            'stat_time_month': dt.strftime('%Y-%m'), 'start_date': params.get('start_date'),
            'end_date': params.get('end_date'), 'time_granularity': params.get('time_granularity'),
            'stats_authority': 'CURRENT',
            'aweme_id': str(int(internal_ids[0])) if len(internal_ids) == 1 else '',
            'aweme_show_id': None,
            'room_name': options.get('room_name'),
        }
        metrics = with_collection(metrics, context, raw_row=row,
                                  source_context={'request': {**params, 'page': page}})
        batch.ads.append({'hour': timestamp(dt), 'dimensions': dimensions, 'metrics': metrics, 'cost': cost})
