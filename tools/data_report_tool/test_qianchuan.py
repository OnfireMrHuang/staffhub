"""Regression coverage for the documented advertiser report wire contract."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import httpx
import report_tool as tool


TODAY = date(2026, 10, 21)


def query():
    return {'advertiser_id': '9007199254740993', 'start_date': '2026-10-18',
            'end_date': '2026-10-18', 'fields': ['stat_cost', 'show_cnt', 'ecp_convert_cnt'],
            'filtering': {'marketing_goal': 'LIVE_PROM_GOODS', 'order_platform': 'QIANCHUAN'},
            'time_granularity': 'TIME_GRANULARITY_HOURLY', 'page': 1, 'page_size': 100}


class QianchuanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.params = self.root / 'params.json'
        self.params.write_text(json.dumps(query()))
        clock = patch('report_profiles.datetime')
        clock.start().now.return_value = datetime(2026, 10, 21, 12)
        self.addCleanup(clock.stop)

    def run_cli(self, extra=(), handler=None, source=None, command='report', env=None):
        if source is not None:
            self.params.write_text(json.dumps(source))
        args = [command, '--version', 'qianchuan', '--env', str(self.root/'missing.env')]
        if command == 'report':
            args += ['--params', str(self.params)]
        stdout, stderr = io.StringIO(), io.StringIO()
        client = httpx.Client(transport=httpx.MockTransport(handler or (lambda r: self.fail('Unexpected network'))))
        with patch.dict(os.environ, env or {}, clear=True), \
             patch.object(tool, 'create_client', return_value=client), \
             contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = tool.main([*args, *extra])
        client.close()
        return result, stdout.getvalue(), stderr.getvalue()

    def test_correct_host_path_and_nested_parameters_reach_wire_and_raw_response_is_saved(self):
        q = query(); q['filtering']['aweme_ids'] = ['9007199254740995']
        payload = {'code': 0, 'message': 'OK', 'request_id': 'qc-report', 'data': {
            'list': [{'advertiser_id': 9007199254740993, 'stat_datetime': '2026-10-18 10:00:00',
                      'stat_cost': 3.25, 'show_cnt': 100.0, 'ecp_convert_cnt': 2.0}],
            'page_info': {'page': 1, 'page_size': 100, 'total_number': 1, 'total_page': 1}}}
        calls = []
        def respond(request):
            calls.append(request.url.path)
            self.assertEqual(str(request.url).split('?')[0],
                             'https://ad.oceanengine.com/open_api/v1.0/qianchuan/report/advertiser/get/')
            self.assertEqual(request.method, 'GET')
            self.assertEqual(request.headers['Access-Token'], 'qc-token')
            self.assertEqual(request.url.params['advertiser_id'], '9007199254740993')
            self.assertEqual(json.loads(request.url.params['fields']), ['stat_cost', 'show_cnt', 'ecp_convert_cnt'])
            self.assertEqual(json.loads(request.url.params['filtering']), {
                'marketing_goal': 'LIVE_PROM_GOODS', 'order_platform': 'QIANCHUAN',
                'aweme_ids': [9007199254740995]})
            self.assertEqual(set(request.url.params), set(q))
            return httpx.Response(200, json=payload)
        output = self.root/'result.json'
        code, out, err = self.run_cli(['--output', str(output)], respond, q,
                                    env={'QIANCHUAN_ACCESS_TOKEN': 'qc-token', 'access_token': 'wrong'})
        self.assertEqual(code, 0, err)
        self.assertEqual(len(calls), 1)
        self.assertEqual(json.loads(out), payload)
        self.assertEqual(json.loads(output.read_text()), payload)

    def test_dry_run_and_stat_platform_context_do_not_authenticate(self):
        q = query(); q['_context'] = {'stat_platform': '巨量千川'}
        self.params.write_text(json.dumps(q))
        stdout = io.StringIO()
        with patch.object(tool, 'load_config', side_effect=AssertionError('No auth')), \
             patch.object(tool, 'create_client', side_effect=AssertionError('No network')), \
             contextlib.redirect_stdout(stdout):
            self.assertEqual(tool.main(['report', '--params', str(self.params), '--dry-run']), 0)
        p = json.loads(stdout.getvalue())
        self.assertEqual(p['url'], 'https://ad.oceanengine.com/open_api/v1.0/qianchuan/report/advertiser/get/')
        self.assertEqual(p['stat_platform'], '巨量千川')
        self.assertNotIn('_context', p['params'])
        self.assertNotIn('data_topic', p['params'])

    def test_phone_handle_resolves_all_pages_then_sets_single_aweme_filter(self):
        calls = []
        def respond(request):
            calls.append(request.url.path)
            if request.url.path.endswith('/aweme/authorized/get/'):
                page = int(request.url.params['page'])
                return httpx.Response(200, json={'code': 0, 'data': {
                    'aweme_id_list': [] if page == 1 else [{'aweme_id': 9007199254740995, 'aweme_show_id': 'host_1'}],
                    'page_info': {'page': page, 'total_page': 2}}})
            self.assertTrue(request.url.path.endswith('/report/advertiser/get/'))
            self.assertEqual(json.loads(request.url.params['filtering']), {
                'marketing_goal': 'LIVE_PROM_GOODS', 'order_platform': 'QIANCHUAN',
                'aweme_ids': [9007199254740995]})
            return httpx.Response(200, json={'code': 0, 'data': {'list': []}})
        code, _, err = self.run_cli(['--aweme-id', 'host_1'], respond, env={'QIANCHUAN_ACCESS_TOKEN': 'qc'})
        self.assertEqual(code, 0, err)
        self.assertEqual(calls, ['/open_api/v1.0/qianchuan/aweme/authorized/get/']*2 +
                         ['/open_api/v1.0/qianchuan/report/advertiser/get/'])

    def test_conflicting_or_unresolved_aweme_never_requests_report(self):
        for ids, rows, success in [
            (['7'], [{'aweme_id': 8, 'aweme_show_id': 'host'}], False),
            (['7', '8'], [{'aweme_id': 7, 'aweme_show_id': 'host'}], False),
            (None, [], False),
            (None, [{'aweme_id': 0, 'aweme_show_id': 'host'}], False),
            (None, [{'aweme_id': 7, 'aweme_show_id': 'host'}, {'aweme_id': 8, 'aweme_show_id': 'host'}], False),
            (['7'], [{'aweme_id': 7, 'aweme_show_id': 'host'}], True),
        ]:
            with self.subTest(ids=ids, rows=rows):
                q = query()
                if ids is not None: q['filtering']['aweme_ids'] = ids
                calls = []
                def respond(request):
                    calls.append(request.url.path)
                    if request.url.path.endswith('/aweme/authorized/get/'):
                        return httpx.Response(200, json={'code': 0, 'data': {
                            'aweme_id_list': rows, 'page_info': {'total_page': 1}}})
                    self.assertTrue(success, 'Must not query a broader report')
                    self.assertEqual(json.loads(request.url.params['filtering'])['aweme_ids'], [7])
                    return httpx.Response(200, json={'code': 0, 'data': {'list': []}})
                code, _, err = self.run_cli(['--room-id', 'host'], respond, q, env={'QIANCHUAN_ACCESS_TOKEN': 'qc'})
                self.assertEqual(code, 0 if success else 1, err)
                self.assertEqual(any(p.endswith('/report/advertiser/get/') for p in calls), success)

    def test_old_schema_and_irrelevant_options_fail_before_auth(self):
        for obsolete in ['dimensions', 'metrics', 'filters', 'data_topic', 'start_time', 'order_by']:
            q = query(); q[obsolete] = ['old']
            code, _, err = self.run_cli(['--dry-run'], source=q)
            self.assertEqual(code, 1)
            self.assertIn(obsolete, err)
        for extra, marker in [(['--data-topic', 'ECP_BASIC_DATA'], 'data-topic'),
                              (['--fields-config', 'missing.json'], 'fields-config')]:
            code, _, err = self.run_cli(['--dry-run', *extra], source=query())
            self.assertEqual(code, 1)
            self.assertIn(marker, err)

    def test_fields_returns_document_catalog_without_account_or_credentials(self):
        output = self.root/'fields.json'
        with patch.object(tool, 'load_config', side_effect=AssertionError('No auth')):
            code, out, err = self.run_cli(['--output', str(output)], command='fields')
        self.assertEqual(code, 0, err)
        catalog = json.loads(out)
        self.assertEqual(catalog['source'], 'official_document')
        self.assertFalse(catalog['account_verified'])
        self.assertEqual(len(catalog['metrics']), 96)
        self.assertEqual([r['field'] for r in catalog['dimensions']], ['advertiser_id', 'stat_datetime'])
        self.assertEqual(json.loads(output.read_text()), catalog)

    def test_invalid_query_cannot_reach_auth_or_network(self):
        cases = [
            ({'fields': []}, 'fields'), ({'fields': ['live_pay_order_gmv_alias']}, 'fields'),
            ({'filtering': {}}, 'marketing_goal'), ({'filtering': []}, 'filtering'),
            ({'filtering': {'marketing_goal': 'ALL', 'aweme_ids': []}}, 'aweme_ids'),
            ({'filtering': {'marketing_goal': 'ALL', 'aweme_ids': [True]}}, 'aweme_ids'),
            ({'filtering': {'marketing_goal': 'ALL', 'aweme_ids': ['phone_name']}}, 'aweme_ids'),
            ({'filtering': {'marketing_goal': 'ALL', 'unknown': 'x'}}, 'unknown'),
            ({'filtering': {'marketing_goal': ['ALL']}}, 'marketing_goal'),
            ({'filtering': {'marketing_goal': 'ALL', 'order_platform': 'ECP_AWEME', 'status': 'ALL'}}, 'status'),
            ({'filtering': {'marketing_goal': 'ALL', 'marketing_scene': 'SEARCH', 'smart_bid_type': 'SMART_BID_CUSTOM'}}, 'smart_bid_type'),
            ({'time_granularity': 'MONTHLY'}, 'time_granularity'),
            ({'start_date': '2026-02-30'}, 'start_date'),
            ({'end_date': '2026-10-17'}, 'end_date'),
            ({'page_size': 501}, 'page_size'), ({'page': True}, 'page'),
            ({'order_field': 'live_pay_order_gmv_alias'}, 'order_field'),
            ({'order_type': 'RANDOM'}, 'order_type'),
        ]
        for changes, marker in cases:
            with self.subTest(changes=changes):
                q = query(); q.update(changes)
                code, _, err = self.run_cli(['--dry-run'], source=q)
                self.assertEqual(code, 1, err)
                self.assertIn(marker, err)

    def test_interval_aggregation_and_date_boundaries(self):
        # Inclusive reporting days; fixed clock keeps the 180-day rule repeatable.
        from report_profiles import prepare_query
        for grain, limit in [('TIME_GRANULARITY_DAILY', 30), ('TIME_GRANULARITY_HOURLY', 7), (None, 180)]:
            for count, accepted in [(limit, True), (limit+1, False)]:
                q = query(); q['start_date'] = (TODAY-timedelta(days=count-1)).isoformat(); q['end_date'] = TODAY.isoformat()
                if grain is None: q.pop('time_granularity')
                else: q['time_granularity'] = grain
                with self.subTest(grain=grain, count=count):
                    if accepted:
                        _, params, _ = prepare_query('report', q, version='qianchuan', today=TODAY)
                        self.assertEqual('time_granularity' in params, grain is not None)
                        self.assertNotIn('dimensions', params)
                    else:
                        with self.assertRaises(tool.ToolError):
                            prepare_query('report', q, version='qianchuan', today=TODAY)
        q = query(); q['start_date'] = q['end_date'] = (TODAY-timedelta(days=181)).isoformat()
        with self.assertRaises(tool.ToolError):
            prepare_query('report', q, version='qianchuan', today=TODAY)

    def test_dry_run_phone_handle_needs_online_resolution_not_custom_metadata(self):
        code, _, err = self.run_cli(['--aweme-id', 'host_1', '--dry-run'])
        self.assertEqual(code, 1)
        self.assertIn('filtering.aweme_ids', err)


if __name__ == '__main__':
    unittest.main()
