"""Native request contract, date bounds and configurable hourly/daily behavior."""
from datetime import datetime, timedelta
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import httpx

from scripts.qianchuan.cli import parser, read_task
from scripts.qianchuan.collector import Collector
from scripts.qianchuan.contracts import default_metrics, project_fields
from scripts.qianchuan.parameters import DAILY, HOURLY, REPORT_URL, cli_window, date_window
from scripts.qianchuan.task import make_task
from scripts.utils.config import Config
from scripts.utils.model import CHINA, ConfigError, DataError, Window
from scripts.utils.transport import Transport


class QianchuanParametersTests(unittest.TestCase):
    def setUp(self):
        self.today = datetime(2026, 10, 23, 11, 30, tzinfo=CHINA)
        for location in ('scripts.qianchuan.parameters.now', 'scripts.utils.model.now'):
            clock = patch(location, return_value=self.today)
            clock.start()
            self.addCleanup(clock.stop)

    def collector(self, handler):
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        return Collector(Transport(client, retries=0))

    def test_both_granularities_use_native_get_parameters_and_full_pagination(self):
        for grain, times in ((HOURLY, ('09', '10')), (DAILY, ('00',))):
            requests = []
            def respond(request):
                self.assertEqual(str(request.url).split('?')[0], REPORT_URL)
                self.assertEqual(request.method, 'GET')
                self.assertEqual(request.headers['Access-Token'], 'cached-token')
                params = request.url.params
                self.assertEqual(set(params), {'advertiser_id', 'start_date', 'end_date', 'fields',
                                              'filtering', 'time_granularity', 'page', 'page_size'})
                self.assertEqual(params['advertiser_id'], '123')
                self.assertEqual(params['start_date'], '2026-10-20')
                self.assertEqual(params['end_date'], '2026-10-20')
                self.assertEqual(params['time_granularity'], grain)
                self.assertEqual(json.loads(params['fields']), default_metrics())
                self.assertEqual(json.loads(params['filtering']), {
                    'marketing_goal': 'LIVE_PROM_GOODS', 'order_platform': 'QIANCHUAN', 'aweme_ids': [987]})
                page = int(params['page'])
                requests.append(page)
                return httpx.Response(200, json={'code': 0, 'data': {
                    'list': [{'advertiser_id': 123, 'stat_datetime': f'2026-10-20 {times[page-1]}:00:00', 'stat_cost': 5}],
                    'page_info': {'total_page': len(times), 'total_number': len(times)}}})
            task = make_task('123', {'time_granularity': grain, 'aweme_ids': ['987']})
            batch = self.collector(respond).collect(task, date_window('2026-10-20', '2026-10-20', grain),
                                                    {'access_token': 'cached-token'})
            self.assertEqual(requests, list(range(1, len(times)+1)))
            self.assertEqual(batch.count, len(times))

    def test_daily_expands_scheduler_hour_window_and_does_not_invent_an_hour(self):
        response = {'code': 0, 'data': {'list': [
            {'advertiser_id': 123, 'stat_datetime': '2026-10-20 00:00:00', 'stat_cost': 11}],
            'page_info': {'total_page': 1, 'total_number': 1}}}
        collector = self.collector(lambda request: httpx.Response(200, json=response))
        batch = collector.collect(make_task('123', {'time_granularity': DAILY}),
                                  Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'),
                                  {'access_token': 'cached-token'})
        self.assertEqual(batch.count, 1)
        row = project_fields(batch.ads[0])
        self.assertEqual(row['stat_datetime'], '2026-10-20 00:00:00')
        self.assertEqual(row['stat_time_day'], '2026-10-20')
        self.assertIsNone(row['stat_time_hour'])
        self.assertEqual(row['time_granularity'], DAILY)

    def test_daily_rejects_hourly_rows_and_missing_time(self):
        for value in ('2026-10-20 09:00:00', None):
            response = {'code': 0, 'data': {'list': [{'stat_datetime': value}],
                                          'page_info': {'total_page': 1, 'total_number': 1}}}
            with self.subTest(value=value), self.assertRaises(DataError):
                self.collector(lambda request: httpx.Response(200, json=response)).collect(
                    make_task('123', {'time_granularity': DAILY}),
                    date_window('2026-10-20', '2026-10-20', DAILY), {'access_token': 'cached-token'})

    def test_inclusive_date_limits_and_180_day_lookback(self):
        today = self.today.date()
        for grain, maximum in ((HOURLY, 7), (DAILY, 30)):
            first = today-timedelta(days=maximum-1)
            self.assertEqual(len(date_window(first.isoformat(), today.isoformat(), grain).dates()), maximum)
            with self.assertRaises(ConfigError):
                date_window((first-timedelta(days=1)).isoformat(), today.isoformat(), grain)
            oldest = today-timedelta(days=180)
            self.assertEqual(date_window(oldest.isoformat(), oldest.isoformat(), grain).dates(), [oldest.isoformat()])
            with self.assertRaises(ConfigError):
                date_window((oldest-timedelta(days=1)).isoformat(), oldest.isoformat(), grain)
        for start, end in (('2026-10-20T00:00:00', '2026-10-20'), ('2026-10-20', '2026-10-24'),
                           ('2026-10-23', '2026-10-22'), ('2026-02-30', '2026-03-01')):
            with self.subTest(start=start, end=end), self.assertRaises(ConfigError): date_window(start, end, DAILY)

    def test_defaults_and_cli_config_precedence(self):
        args = parser().parse_args(['collect', '--advertiser-id', '123'])
        config = Config(Path('/tmp/unused.toml'), {'report': {'time_granularity': DAILY}}, [])
        self.assertEqual(read_task(args, config).options['time_granularity'], DAILY)
        config.data['accounts'] = {'123': {'time_granularity': HOURLY}}
        self.assertEqual(read_task(args, config).options['time_granularity'], HOURLY)
        explicit = parser().parse_args(['collect', '--advertiser-id', '123', '--time-granularity', DAILY])
        self.assertEqual(read_task(explicit, config).options['time_granularity'], DAILY)
        self.assertEqual(make_task('123').options['time_granularity'], HOURLY)
        self.assertEqual(cli_window(None, None, DAILY).dates(), ['2026-10-22'])
        self.assertEqual(cli_window(None, None, HOURLY).start.hour, 10)
        with self.assertRaises(ConfigError): cli_window('2026-10-20', None, DAILY)
        for grain in ('daily', '', None):
            with self.subTest(grain=grain), self.assertRaises(ConfigError): make_task('123', {'time_granularity': grain})

    def test_only_internal_single_anchor_is_accepted_and_granularity_separates_tasks(self):
        for options in ({'aweme_id': 'display'}, {'aweme_ids': [1, 2]}, {'aweme_ids': ['display']}):
            with self.subTest(options=options), self.assertRaises(ConfigError): make_task('123', options)
        self.assertEqual(make_task('123', {'aweme_ids': ['00987']}).options['aweme_ids'], [987])
        with self.assertRaises(ConfigError):
            parser().parse_args(['collect', '--advertiser-id', '123', '--aweme-id', '987'])
        self.assertNotEqual(make_task('123').task_id, make_task('123', {'time_granularity': DAILY}).task_id)


if __name__ == '__main__':
    unittest.main()
