"""Marketing smart/legacy hourly reports and advertiser field permissions."""
from datetime import timedelta
from decimal import Decimal, InvalidOperation
import json

from scripts.utils.legacy import reports
from scripts.utils.model import AuthError, Batch, DataError, parse_time, timestamp
from .contracts import default_metrics, with_collection
from .task import validate


class Collector:
    def __init__(self, transport, max_pages=10000):
        self.transport = transport
        self.max_pages = max_pages

    def query(self, command, params, token, version='smart'):
        body = self.transport.request(**reports().request_parts(command, params, token, version))
        if body.get('code') != 0:
            if str(body.get('code')) in {'401', '40100', '40102', '40105', '40106'}:
                raise AuthError('营销访问令牌无效，请维护授权')
            raise DataError('营销业务请求失败；请检查应用权限及字段配置')
        return body

    def _prepare(self, route, window, token):
        tool = reports()
        options = route.options
        version = options.get('version', 'smart')
        raw = {
            'advertiser_id': route.account_id, 'dimensions': ['stat_time_hour'],
            'metrics': options.get('metrics', default_metrics(version)), 'filters': [],
            'start_time': timestamp(window.start),
            'end_time': timestamp(window.end - timedelta(seconds=1)),
            'page': 1, 'page_size': 100,
        }
        _, params, _ = tool.prepare_query('report', raw, version=version)
        fields = self.query('fields', {
            'advertiser_id': route.account_id, 'data_topics': [params['data_topic']]
        }, token, version)
        available = tool.get_topic_config(fields, params['data_topic'])
        for key in ('dimensions', 'metrics'):
            known = {entry['field'] for entry in available[key]}
            missing = set(params[key]) - known
            if missing:
                raise DataError('营销账户/版本缺少请求字段：' + ', '.join(sorted(missing)) +
                                '；请显式配置已确认的 metrics，不自动删减')
        return version, params

    def _pages(self, params, token, version):
        total = expected = None
        fingerprints = set()
        count = 0
        for page in range(1, self.max_pages + 1):
            payload = self.query('report', {**params, 'page': page}, token, version)
            data = payload.get('data')
            if not isinstance(data, dict):
                raise DataError('营销报表缺少数据对象')
            rows, info = data.get('rows'), data.get('page_info')
            if not isinstance(info, dict):
                raise DataError('营销报表缺少完整分页信息')
            pages, size = info.get('total_page'), info.get('total_number')
            if (not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows)
                    or isinstance(pages, bool) or not isinstance(pages, int) or pages < 0):
                raise DataError('营销报表缺少行数据或完整分页信息')
            if isinstance(size, bool) or not isinstance(size, int) or size < 0:
                raise DataError('营销报表缺少有效 total_number，无法证明采集完整')
            if total is None:
                total, expected = pages, size
            elif total != pages or expected != size:
                raise DataError('采集期间营销分页总数变化')
            fingerprint = json.dumps(rows, sort_keys=True)
            if rows and fingerprint in fingerprints:
                raise DataError('营销分页重复')
            fingerprints.add(fingerprint)
            count += len(rows)
            if (not rows and total > 1) or (rows and total == 0):
                raise DataError('营销分页提前结束')
            yield page, rows
            if page >= total:
                if count != expected:
                    raise DataError('营销数据条数不完整')
                return
        raise DataError('营销报表超过最大页数')

    def collect(self, route, window, session):
        validate(route)
        tool = reports()
        batch = Batch()
        seen_rows = set()
        token = session['access_token']
        try:
            version, params = self._prepare(route, window, token)
            for page, rows in self._pages(params, token, version):
                for row in rows:
                    dimensions, metrics = row.get('dimensions'), row.get('metrics')
                    if not isinstance(dimensions, dict) or not isinstance(metrics, dict):
                        raise DataError('营销报表行结构变化')
                    hour = dimensions.get('stat_time_hour')
                    if not isinstance(hour, str):
                        raise DataError('来源未返回小时维度，禁止将日总写入小时表')
                    try:
                        instant = parse_time(hour)
                    except Exception as exc:
                        raise DataError('来源小时格式无效') from exc
                    if instant.minute or instant.second or instant.microsecond:
                        raise DataError('来源时间不是整小时')
                    if not window.contains(hour):
                        continue
                    identity = (timestamp(instant), json.dumps(dimensions, sort_keys=True))
                    if identity in seen_rows:
                        raise DataError('营销数据出现重复维度')
                    seen_rows.add(identity)
                    try:
                        cost = Decimal(str(metrics['stat_cost'])) if metrics.get('stat_cost') is not None else None
                        if cost is not None and not cost.is_finite():
                            raise InvalidOperation
                    except (InvalidOperation, ValueError) as exc:
                        raise DataError('金额不是有限数值') from exc
                    options = route.options
                    context = {
                        'advertiser_id': route.account_id, 'account_name': options.get('account_name'),
                        'account_type': options.get('account_type'),
                        'stat_platform': '巨量营销-旧版' if version == 'legacy' else '巨量营销-智擎版',
                        'stat_time_hour': timestamp(instant), 'stat_time_day': instant.date().isoformat(),
                        'stat_time_month': instant.strftime('%Y-%m'),
                    }
                    metrics = with_collection(metrics, context, raw_row=row,
                                              source_context={'request': {**params, 'page': page}})
                    batch.ads.append({'hour': timestamp(instant), 'dimensions': dimensions,
                                      'metrics': metrics, 'cost': cost})
        except tool.ToolError as exc:
            raise DataError('营销请求配置失败，请核对账户字段及授权范围') from exc
        return batch
