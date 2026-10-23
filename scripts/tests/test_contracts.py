import json
from decimal import Decimal
from pathlib import Path
import unittest

import httpx

from importlib import import_module

def source_module(name):
    return import_module("scripts."+name)
from scripts.pingan.contracts import clean_pingan_summary
from scripts.marketing.collector import Collector as MarketingCollector
from scripts.pingan.collector import Collector as PinganCollector
from scripts.zhongan.collector import Collector as ZhonganCollector
from scripts.utils.model import Task as Route, Window, DataError
from scripts.utils.transport import Transport


def contract(dataset):
    return source_module(dataset.split('_', 1)[0]).contracts.contract(dataset)


def default_metrics(source, version=None):
    module = source_module(source).contracts
    return module.default_metrics(version) if version is not None else module.default_metrics()


def project_fields(dataset, payload, context=None):
    source = dataset.split('_', 1)[0]
    module = source_module(source).contracts
    if source in ('marketing', 'qianchuan'):
        return module.project_fields(payload, context)
    return module.project_fields(dataset, payload, context)



class FieldContractTests(unittest.TestCase):
    def test_defaults_cover_dictionary_metrics_without_metadata(self):
        self.assertEqual(len(default_metrics('marketing', 'smart')), 35)
        self.assertEqual(len(default_metrics('qianchuan', 'qianchuan')), 96)
        for source in ('marketing', 'qianchuan'):
            metrics = default_metrics(source)
            self.assertNotIn('account_name', metrics)
            self.assertNotIn('advertiser_id', metrics)
            self.assertNotIn('stat_time_hour', metrics)
        self.assertIn('premium_payment_count', default_metrics('marketing'))
        self.assertIn('all_order_pay_gmv_7days', default_metrics('qianchuan'))

    def test_every_field_has_workbook_trace_and_explicit_mapping_status(self):
        counts = {'marketing_stats': 42, 'qianchuan_stats': 111,
                  'pingan_stats': 20, 'pingan_orders': 12,
                  'zhongan_stats': 49, 'zhongan_orders': 32}
        for dataset, count in counts.items():
            fields = contract(dataset)['fields']
            self.assertEqual(len(fields), count, dataset)
            self.assertEqual(len({f['name'] for f in fields}), count)
            for field in fields:
                self.assertTrue(field['name_zh'])
                self.assertGreater(field['workbook_row'], 1)
                self.assertIn('source_path', field)
                self.assertIn('storage_path', field)
                self.assertIn(field['status'], {'mapped', 'derived', 'context', 'raw_untyped', 'unsupported'})
                self.assertNotIn('sample_value', field)

    def test_pingan_rates_keep_missing_zero_denominator_and_amount_precision(self):
        raw = {'bindPolicyCnt': 0, 'validPolicyCnt': 3, 'surrenderPolicyCnt': 1,
               'annualPolicyCnt': 1, 'multiApplicantCnt': 1, 'allApplicantCnt': 0,
               'annualPremium': '153260.28', 'undwrtPremium': '18222.190001'}
        original = dict(raw)
        clean = clean_pingan_summary(raw)
        self.assertEqual(raw, original)
        self.assertEqual(clean['calcBindCardRate'], '0')
        self.assertEqual(Decimal(clean['annualPolRate']), Decimal(100) / Decimal(3))
        self.assertIsNone(clean['multiApplicantPolRate'])
        self.assertEqual(clean['annualPremium'], '153260.28')
        self.assertEqual(clean['undwrtPremium'], '18222.190001')
        self.assertIsNone(clean_pingan_summary({})['calcBindCardRate'])
        self.assertIsNone(clean_pingan_summary({'bindPolicyCnt': 'bad', 'validPolicyCnt': 1})['calcBindCardRate'])

    def test_projection_uses_nested_paths_and_retains_arrays_and_nulls(self):
        raw = {'orderNo': '9007199254740995', 'holderInfo': {'name': '脱敏', 'age': '30-40'},
               'orderAmount': '0.12345678901234567890', 'insuredInfoList': [{'age': '1'}],
               'orderDetailList': [], 'orderStatus': 'unexpected'}
        result = project_fields('zhongan_orders', raw, {'dyNo': 'room-x'})
        self.assertEqual(result['holderInfo.name'], '脱敏')
        self.assertEqual(result['orderNo'], '9007199254740995')
        self.assertEqual(result['orderAmount'], Decimal('0.12345678901234567890'))
        self.assertEqual(result['insuredInfoList'], [{'age': '1'}])
        self.assertEqual(result['orderDetailList'], [])
        self.assertIsNone(result['paidCnt'])
        self.assertEqual(result['orderStatus'], 'unexpected')
        self.assertEqual(result['dyNo'], 'room-x')
        result = project_fields('zhongan_stats', {'cost': 'not numeric', 'roi': {'unknown': True}})
        self.assertIsNone(result['cost'])
        self.assertEqual(result['roi'], {'unknown': True})

    def test_unknown_mapping_and_ambiguous_pingan_summary_are_null(self):
        result = project_fields('pingan_stats', {'summary': [{'validPolicyCnt': 1}, {'validPolicyCnt': 2}], 'funnel': {}})
        self.assertIsNone(result['validPolicyCnt'])
        self.assertIsNone(result['adSpend'])
        self.assertIsNone(project_fields('pingan_orders', {'applicant': {'ageGroup': '30-40'}})['applicant_age_group'])
        self.assertIsNone(project_fields('qianchuan_stats', {}, {'aweme_nick_name': 'unverified'})['aweme_nick_name'])

    def test_blank_text_and_lossy_numeric_values_are_null_without_raw_changes(self):
        raw = {'orderNo': '', 'orderAmount': '1.1234567890123456789012345678901',
               'paidCnt': True, 'orderStatus': '   '}
        original = dict(raw)
        values = project_fields('zhongan_orders', raw)
        for name in raw:
            self.assertIsNone(values[name], name)
        self.assertEqual(raw, original)

    def test_marketing_missing_fields_fail_instead_of_reducing_defaults(self):
        seen = []
        def respond(req):
            seen.append(req.url.path)
            topic=json.loads(req.url.params['data_topics'])[0]
            return httpx.Response(200, json={'code':0,'data':{'list':[{
                'data_topic':topic,'dimensions':[{'field':'stat_time_hour'}],
                'metrics':[{'field':'stat_cost'},{'field':'click_cnt'},{'field':'show_cnt'}]}]}})
        for version in ('smart', 'legacy'):
            transport = Transport(httpx.Client(transport=httpx.MockTransport(respond)), retries=0)
            task = Route('r','marketing','123',{'version':version,'account_scope':True})
            with self.assertRaisesRegex(DataError,'缺少请求字段'):
                MarketingCollector(transport).collect(task, Window.parse('2026-10-20T09:00:00','2026-10-20T10:00:00'),{'access_token':'test'})
        self.assertTrue(all('/config/' in path for path in seen))

    def test_pingan_collector_stores_raw_values_and_derived_nulls(self):
        def respond(req):
            endpoint=req.url.path.rsplit('/',1)[-1]
            data={'obtainTikTokBoardTitle':{},
                  'queryCommonRealtimeTargets':[{'annualPremium':'153260.28','validPolicyCnt':0,'bindPolicyCnt':0}],
                  'obtainTikTokBoardFunnel':{'policyTransRate':'25.84'},
                  'orderInfo':{'orderInfoList':[],'totalCount':0,'totalPage':0}}[endpoint]
            return httpx.Response(200,json={'code':200,'data':data})
        transport=Transport(httpx.Client(transport=httpx.MockTransport(respond)),retries=0)
        task=Route('r','pingan','',{'channel':'test'})
        batch=PinganCollector(transport).collect(task,Window.parse('2026-10-20T09:00:00','2026-10-20T10:00:00'),{})
        metrics=batch.snapshots[0]['metrics']
        self.assertEqual(metrics['summary'][0]['annualPremium'],'153260.28')
        self.assertIsNone(metrics['_collection']['derived']['calcBindCardRate'])
        self.assertEqual(project_fields('pingan_stats',metrics)['policyTransRate'],'25.84')

    def test_checked_in_ddl_contains_every_typed_field(self):
        for source in ('marketing','qianchuan','pingan','zhongan'):
            path=Path(__file__).resolve().parents[2]/'scripts'/source
            sql=(path/'schema.sql').read_text()
            definitions=json.loads((path/'fields.json').read_text())['datasets']
            for dataset,definition in definitions.items():
                self.assertIn('CREATE TABLE IF NOT EXISTS `'+dataset+'`',sql)
                for field in definition['fields']:
                    self.assertIn('`'+field['name']+'` '+field['sql_type'],sql)
            self.assertNotIn('CREATE OR REPLACE VIEW',sql)
            for removed in ('raw_payload','scope_key','scope_json','dimension_key'):
                self.assertNotIn('`'+removed+'`',sql)
            if source == 'marketing':
                self.assertIn('UNIQUE KEY `uk_account_hour` (`advertiser_id`,`stat_time_hour`)',sql)
            if source == 'qianchuan':
                self.assertIn("`aweme_id` VARCHAR(128) NOT NULL DEFAULT ''",sql)
                self.assertIn('UNIQUE KEY `uk_account_grain_time_aweme` (`advertiser_id`,`time_granularity`,`stat_datetime`,`aweme_id`)',sql)

    def test_collectors_request_full_defaults_and_keep_request_context(self):
        for source in ('marketing', 'qianchuan'):
            requested = []
            def respond(req):
                if '/config/' in req.url.path:
                    return httpx.Response(200, json={'code': 0, 'data': {'list': [{
                        'data_topic': 'BASIC_DATA', 'dimensions': [{'field': 'stat_time_hour'}],
                        'metrics': [{'field': f} for f in default_metrics('marketing')]}]}})
                requested.extend(json.loads(req.url.params['fields' if source == 'qianchuan' else 'metrics']))
                row = {'stat_datetime': '2026-10-20 09:00:00', 'stat_cost': '1.23001', 'new_metric': 7} if source == 'qianchuan' else {'dimensions': {'stat_time_hour': '2026-10-20 09:00:00'}, 'metrics': {'stat_cost': '1.23001', 'new_metric': 7}}
                return httpx.Response(200, json={'code': 0, 'data': {'list' if source == 'qianchuan' else 'rows': [row], 'page_info': {'total_page': 1, 'total_number': 1}}})
            transport = Transport(httpx.Client(transport=httpx.MockTransport(respond)), retries=0)
            route = Route('r', source, '123', {'account_scope': True})
            batch = source_module(source).Collector(transport).collect(route, Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'), {'access_token': 'test'})
            self.assertEqual(requested, default_metrics(source))
            self.assertEqual(batch.ads[0]['metrics']['new_metric'], 7)
            self.assertEqual(batch.ads[0]['metrics']['_collection']['context']['advertiser_id'], '123')

    def test_zhongan_collection_preserves_cursor_and_session_context(self):
        def respond(req):
            endpoint = req.url.path.rsplit('/', 1)[-1]
            data = {'getLiveDy': [{'dyNo': 'abc', 'anchorNick': '房间', 'agentLiveName': '机构'}],
                    'getLiveAttribute': {'roomId': 'session', 'startTime': '2026-10-20 08:05:00'},
                    'getDashboardAggregate': {'cost': '1.001', 'unknown': {'x': 1}},
                    'getOrderList': [{'orderNo': 'o1', 'nextPage': None}]}[endpoint]
            return httpx.Response(200, json={'success': True, 'data': data})
        transport = Transport(httpx.Client(transport=httpx.MockTransport(respond)), retries=0)
        route = Route('r', 'zhongan', '', {'dy_no': 'abc'})
        batch = ZhonganCollector(transport).collect(route, Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'), {})
        self.assertIn('nextPage', batch.orders[0]['payload'])
        self.assertEqual(batch.snapshots[0]['metrics']['unknown'], {'x': 1})
        for payload in (batch.snapshots[0]['metrics'], batch.orders[0]['payload']):
            context = payload['_collection']['context']
            self.assertEqual(context['roomId'], 'session')
            self.assertEqual(context['anchorNick'], '房间')
            self.assertEqual(context['startTime'], '2026-10-20 08:05:00')


if __name__ == '__main__':
    unittest.main()
