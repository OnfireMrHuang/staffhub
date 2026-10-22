import json
import unittest
from datetime import datetime

import httpx
from scripts.utils.model import Route, Window, DataError
from scripts.marketing.collector import Collector as MarketingCollector
from scripts.qianchuan.collector import Collector as QianchuanCollector
from scripts.pingan.collector import Collector as PinganCollector
from scripts.zhongan.collector import Collector as ZhonganCollector
from scripts.utils.transport import Transport
from scripts.marketing.contracts import default_metrics


def route(source, **options):
    return Route('r1', 'p1', 'room1', source, 'cred1', '123' if source in ('marketing', 'qianchuan') else '', options)


class CollectorTests(unittest.TestCase):
    def transport(self, handler):
        def with_fields(req):
            if '/config/' in req.url.path:
                topic=json.loads(req.url.params['data_topics'])[0]
                return httpx.Response(200,json={'code':0,'data':{'list':[{'data_topic':topic,
                    'dimensions':[{'field':'stat_time_hour'}],
                    'metrics':[{'field':name} for name in default_metrics()]}]}})
            return handler(req)
        return Transport(httpx.Client(transport=httpx.MockTransport(with_fields)), retries=0)

    def test_marketing_paginates_and_keeps_hour_and_decimal(self):
        def respond(req):
            page = int(req.url.params['page'])
            self.assertEqual(req.url.host, 'api.oceanengine.com')
            self.assertEqual(json.loads(req.url.params['dimensions']), ['stat_time_hour'])
            return httpx.Response(200, json={'code': 0, 'data': {'rows': [{'dimensions': {'stat_time_hour': f'2026-10-20 {page+8:02d}:00:00'}, 'metrics': {'stat_cost': '1.23'}}], 'page_info': {'total_page': 2, 'total_number': 2}}})
        result = MarketingCollector(self.transport(respond)).collect(route('marketing', account_scope=True), Window.parse('2026-10-20T09:00:00', '2026-10-20T11:00:00'), {'access_token': 'test'})
        self.assertEqual(len(result.ads), 2)
        self.assertEqual(str(result.ads[0]['cost']), '1.23')
        self.assertEqual(result.ads[1]['hour'], '2026-10-20 10:00:00')

    def test_qianchuan_uses_stat_datetime_and_internal_ids(self):
        def respond(req):
            self.assertEqual(req.url.host, 'ad.oceanengine.com')
            self.assertEqual(req.url.params['time_granularity'], 'TIME_GRANULARITY_HOURLY')
            self.assertEqual(json.loads(req.url.params['filtering'])['aweme_ids'], [987])
            return httpx.Response(200, json={'code': 0, 'data': {'list': [{'advertiser_id': 123, 'stat_datetime': '2026-10-20 09:00:00', 'stat_cost': '2.00'}, {'advertiser_id': 123, 'stat_datetime': '2026-10-20 10:00:00', 'stat_cost': '3.00'}], 'page_info': {'total_page': 1, 'total_number': 2}}})
        result = QianchuanCollector(self.transport(respond)).collect(route('qianchuan', aweme_ids=['987']), Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'), {'access_token': 'test'})
        self.assertEqual(len(result.ads), 1)
        self.assertEqual(result.ads[0]['metrics']['stat_cost'], '2.00')

    def test_partial_page_and_daily_grain_are_rejected(self):
        for rows, info in [([{'dimensions': {'stat_time_day': '2026-10-20'}, 'metrics': {}}], {'total_page': 1, 'total_number': 1}), ([], {'total_page': 2, 'total_number': 20})]:
            tr = self.transport(lambda req: httpx.Response(200, json={'code': 0, 'data': {'rows': rows, 'page_info': info}}))
            with self.assertRaises(DataError):
                MarketingCollector(tr).collect(route('marketing', account_scope=True), Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'), {'access_token': 'test'})

    def test_ping_an_reads_all_orders_without_account_fanout(self):
        requests = []
        def respond(req):
            body = json.loads(req.content)['data']; endpoint = req.url.path.rsplit('/', 1)[-1]; requests.append((endpoint, body))
            data = {'obtainTikTokBoardTitle': {'title': 'room'}, 'queryCommonRealtimeTargets': [{'validPolicyCnt': 3}], 'obtainTikTokBoardFunnel': {'ctr': '2.5'}}.get(endpoint)
            if endpoint == 'orderInfo':
                page = body['pageIndex']; data = {'orderInfoList': [{'postId': str(page), 'actualAmount': 5}], 'totalCount': 2, 'totalPage': 2}
            return httpx.Response(200, json={'code': 200, 'data': data})
        batch = PinganCollector(self.transport(respond)).collect(route('pingan', channel='TEST'), Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'), {'token': 'test'})
        self.assertEqual([x['order_id'] for x in batch.orders], ['1', '2'])
        self.assertEqual(batch.snapshots[0]['grain'], 'day_cumulative')
        order_body = next(body for ep, body in requests if ep == 'orderInfo')
        self.assertEqual(order_body['toTime'], '2026-10-20 09:59:59')
        self.assertIn(99, order_body['orderStatusList'])

    def test_zhongan_all_sessions_and_cursor(self):
        def respond(req):
            body = json.loads(req.content); endpoint = req.url.path.rsplit('/', 1)[-1]
            if endpoint == 'getLiveDy': data = [{'dyNo': 'abc'}]
            elif endpoint == 'getLiveAttribute': data = {'roomId': 's1', 'attributeOfflineDTOList': [{'roomId': 's2'}]}
            elif endpoint == 'getDashboardAggregate': data = {'orderCnt': 2}
            elif endpoint == 'getOrderList':
                s = body['roomIdList'][0]
                data = [{'orderNo': s + ('b' if 'nextPage' in body else 'a'), 'nextPage': None if 'nextPage' in body else 'cursor'}]
            return httpx.Response(200, json={'success': True, 'data': data})
        batch = ZhonganCollector(self.transport(respond)).collect(route('zhongan', dy_no='abc'), Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'), {'cookies': [{'name': 'sid', 'value': 'test', 'domain': 'adagent.zhongan.com', 'path': '/', 'expires': -1}], 'origins': []})
        self.assertEqual(len(batch.snapshots), 2)
        self.assertEqual(len(batch.orders), 4)
        self.assertTrue(all(s['grain'] == 'session_cumulative' for s in batch.snapshots))

    def test_zhongan_repeated_order_is_failure(self):
        def respond(req):
            ep = req.url.path.rsplit('/', 1)[-1]
            data = {'getLiveDy': [{'dyNo': 'abc'}], 'getLiveAttribute': {'roomId': 's1'}, 'getDashboardAggregate': {'count': 1}, 'getOrderList': [{'orderNo': '1', 'nextPage': 'same'}]}[ep]
            return httpx.Response(200, json={'code': '200', 'data': data})
        with self.assertRaises(DataError):
            ZhonganCollector(self.transport(respond)).collect(route('zhongan', dy_no='abc'), Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'), {'cookies': [], 'origins': []})

    def test_missing_total_count_with_empty_final_page_never_commits_partial_batch(self):
        def respond(req):
            rows=[{'dimensions':{'stat_time_hour':'2026-10-20 09:00:00'},'metrics':{'stat_cost':'1.00'}}] if req.url.params['page']=='1' else []
            return httpx.Response(200,json={'code':0,'data':{'rows':rows,'page_info':{'total_page':2}}})
        with self.assertRaises(DataError):
            MarketingCollector(self.transport(respond)).collect(route('marketing',account_scope=True),Window.parse('2026-10-20T09:00:00','2026-10-20T11:00:00'),{'access_token':'t'})

    def test_zhongan_auth_does_not_claim_missing_room_scope_is_valid(self):
        tr=self.transport(lambda req:httpx.Response(200,json={'success':True,'data':[{'dyNo':'another-room'}]}))
        with self.assertRaises(DataError): ZhonganCollector(tr).check(route('zhongan',dy_no='target'),{'cookies':[],'origins':[]})

    def test_zhongan_no_live_rooms_is_session_valid_but_scope_unknown(self):
        tr=self.transport(lambda req:httpx.Response(200,json={'success':True,'data':[]}))
        self.assertEqual(ZhonganCollector(tr).check(route('zhongan',dy_no='target'),{'cookies':[],'origins':[]}),'unobserved_no_live_rooms')
