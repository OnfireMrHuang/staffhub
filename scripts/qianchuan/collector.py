"""Qianchuan hourly reports requested by day, then cropped to the task window."""
import json
from decimal import Decimal, InvalidOperation

from scripts.utils.legacy import reports
from scripts.utils.model import AuthError, DataError, parse_time, timestamp
from .models import ReportBatch
from .contracts import default_metrics, with_collection
from .task import validate


class Collector:
    def __init__(self, transport, max_pages=10000):
        self.transport, self.max_pages = transport, max_pages

    def query(self, command, params, token):
        body = self.transport.request(**reports().request_parts(command, params, token, 'qianchuan'))
        if body.get('code') != 0:
            if str(body.get('code')) in {'401', '40100', '40102', '40105', '40106'}:
                raise AuthError('千川访问令牌无效，请维护授权')
            raise DataError('千川业务请求失败；请检查应用权限及字段配置')
        return body

    def collect(self, route, window, session):
        validate(route)
        tool = reports()
        options = route.options
        token = session['access_token']
        batch = ReportBatch()
        seen_rows = set()
        filtering = {'marketing_goal': 'LIVE_PROM_GOODS', 'order_platform': 'QIANCHUAN'}
        if options.get('aweme_ids'):
            filtering['aweme_ids'] = [int(value) for value in options['aweme_ids']]
        try:
            for day in window.dates():
                request = {
                    'advertiser_id': route.account_id, 'fields': options.get('metrics', default_metrics()),
                    'filtering': dict(filtering), 'start_date': day, 'end_date': day,
                    'time_granularity': 'TIME_GRANULARITY_HOURLY', 'page': 1, 'page_size': 100,
                }
                _, params, _ = tool.prepare_query('report', request, version='qianchuan')
                if options.get('aweme_id'):
                    # The legacy adapter resolves the user-facing Douyin ID to Qianchuan's internal ID.
                    params = tool.scoped_report(params, None, str(options['aweme_id']), 'qianchuan',
                                                self.transport.client, token)
                ids = params.get('filtering', {}).get('aweme_ids', [])
                if options.get('aweme_id') or options.get('aweme_ids'):
                    if len(ids) != 1 or not str(ids[0]).isascii() or not str(ids[0]).isdigit() or int(ids[0]) <= 0:
                        raise DataError('千川主播筛选必须解析为一个有效内部 ID')
                    aweme_id = str(int(ids[0]))
                else:
                    aweme_id = ''
                if batch.aweme_id is not None and batch.aweme_id != aweme_id:
                    raise DataError('采集期间主播内部 ID 发生变化')
                batch.aweme_id = aweme_id
                self._collect_day(route, window, params, token, batch, seen_rows)
        except tool.ToolError as exc:
            raise DataError('千川请求配置或主播筛选失败，请核对账户字段及授权范围') from exc
        return batch

    def _collect_day(self, route, window, params, token, batch, seen_rows):
        total = expected = None
        fingerprints = set()
        count = 0
        for page in range(1, self.max_pages + 1):
            payload = self.query('report', {**params, 'page': page}, token)
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
                self._append_hour(route, window, params, page, row, batch, seen_rows)
            if page >= total:
                if count != expected:
                    raise DataError('千川数据条数不完整')
                break
        else:
            raise DataError('千川报表超过最大页数')

    @staticmethod
    def _append_hour(route, window, params, page, row, batch, seen_rows):
        dimensions = {'stat_datetime': row.get('stat_datetime'),
                      'advertiser_id': str(row.get('advertiser_id', route.account_id))}
        metrics = {key: value for key, value in row.items() if key not in dimensions}
        if dimensions['advertiser_id'] != route.account_id:
            raise DataError('千川响应账户与请求不一致')
        hour = dimensions['stat_datetime']
        if not isinstance(hour, str):
            raise DataError('来源未返回小时维度，禁止将日总写入小时表')
        try:
            dt = parse_time(hour)
        except Exception as exc:
            raise DataError('来源小时格式无效') from exc
        if dt.minute or dt.second or dt.microsecond:
            raise DataError('来源时间不是整小时')
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
            'stat_time_hour': timestamp(dt), 'stat_time_day': dt.date().isoformat(),
            'stat_time_month': dt.strftime('%Y-%m'), 'start_date': params.get('start_date'),
            'end_date': params.get('end_date'), 'time_granularity': params.get('time_granularity'),
            'stats_authority': 'CURRENT',
            'aweme_id': str(int(internal_ids[0])) if len(internal_ids) == 1 else '',
            'aweme_show_id': options.get('aweme_id'),
            'room_name': options.get('room_name'),
        }
        metrics = with_collection(metrics, context, raw_row=row,
                                  source_context={'request': {**params, 'page': page}})
        batch.ads.append({'hour': timestamp(dt), 'dimensions': dimensions, 'metrics': metrics, 'cost': cost})
