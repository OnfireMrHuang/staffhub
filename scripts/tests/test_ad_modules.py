"""Regression boundaries for independently owned advertising collectors."""
import ast
import importlib
from datetime import datetime
from pathlib import Path
import unittest
from unittest.mock import patch
from scripts.utils.model import CHINA

ROOT = Path(__file__).resolve().parents[1]


def setUpModule():
    clock = patch('scripts.qianchuan.parameters.now', return_value=datetime(2026, 10, 23, tzinfo=CHINA))
    clock.start()
    unittest.addModuleCleanup(clock.stop)


class AdModuleTests(unittest.TestCase):
    def test_each_source_owns_collector_repository_and_contract(self):
        for source in ('marketing', 'qianchuan'):
            with self.subTest(source=source):
                collector = importlib.import_module(f'scripts.{source}.collector').Collector
                repository = importlib.import_module(f'scripts.{source}.repository').Repository
                contract = importlib.import_module(f'scripts.{source}.contracts').contract()
                self.assertEqual(collector.__module__, f'scripts.{source}.collector')
                self.assertEqual(repository.write.__module__, f'scripts.{source}.repository')
                self.assertEqual(contract['source'], source)
                self.assertTrue(contract['fields'])

    def test_ad_packages_have_no_live_data_dependency(self):
        for source in ('marketing', 'qianchuan'):
            paths = list((ROOT.parent / 'scripts' / source).glob('*.py'))
            self.assertTrue(paths, source)
            for path in paths:
                tree = ast.parse(path.read_text())
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        self.assertFalse(any(n.name.startswith('live_data') for n in node.names), str(path))
                    if isinstance(node, ast.ImportFrom):
                        self.assertFalse((node.module or '').startswith('live_data'), str(path))

    def test_task_identity_is_shared_but_source_scope_rules_are_owned(self):
        for source in ('marketing', 'qianchuan'):
            tasks = importlib.import_module(f'scripts.{source}.task')
            one = tasks.make_task('00123', {'account_scope': True})
            two = tasks.make_task('123', {
                'account_scope': True, 'account_name': 'display'})
            self.assertEqual(one.task_id, two.task_id)
            self.assertEqual(tasks.validate(one).resource[:2], (source, '123'))

class AdBehaviorTests(unittest.TestCase):
    def transport(self, source, responder, available=None):
        import httpx
        from scripts.utils.transport import Transport
        from scripts.marketing.contracts import default_metrics

        def respond(request):
            if source == 'marketing' and '/config/' in request.url.path:
                import json
                topic = json.loads(request.url.params['data_topics'])[0]
                fields = default_metrics() if available is None else available
                return httpx.Response(200, json={'code': 0, 'data': {'list': [{
                    'data_topic': topic, 'dimensions': [{'field': 'stat_time_hour'}],
                    'metrics': [{'field': field} for field in fields]}]}})
            return responder(request)
        return Transport(httpx.Client(transport=httpx.MockTransport(respond)), retries=0)

    def test_marketing_field_permission_failure_never_requests_report(self):
        from scripts.marketing import Collector, make_task
        from scripts.utils.model import DataError, Window
        task = make_task('123', {'account_scope': True})
        transport = self.transport('marketing', lambda request: self.fail('report must not run'), available=[])
        with self.assertRaises(DataError):
            Collector(transport).collect(task, Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'),
                                         {'access_token': 'test'})

    def test_qianchuan_day_requests_are_cropped_to_requested_hour_window(self):
        import httpx
        from scripts.qianchuan import Collector, make_task
        from scripts.utils.model import Window
        calls = []
        def respond(request):
            day = request.url.params['start_date']
            self.assertEqual(day, request.url.params['end_date'])
            calls.append(day)
            rows = [{'advertiser_id': 123, 'stat_datetime': day + f' {hour}:00:00', 'stat_cost': '1.2300'}
                    for hour in ('00', '23')]
            return httpx.Response(200, json={'code': 0, 'data': {'list': rows,
                                               'page_info': {'total_page': 1, 'total_number': 2}}})
        task = make_task('123', {'aweme_ids': ['00987']})
        batch = Collector(self.transport('qianchuan', respond)).collect(
            task, Window.parse('2026-10-19T23:00:00', '2026-10-20T01:00:00'), {'access_token': 'test'})
        self.assertEqual(calls, ['2026-10-19', '2026-10-20'])
        self.assertEqual([row['hour'] for row in batch.ads], ['2026-10-19 23:00:00', '2026-10-20 00:00:00'])
        self.assertEqual(str(batch.ads[0]['cost']), '1.2300')
        self.assertEqual(task.options['aweme_ids'], [987])

    def test_each_collector_rejects_missing_pagination_totals(self):
        import httpx
        from scripts.utils.model import DataError, Window
        window = Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00')
        for source in ('marketing', 'qianchuan'):
            package = importlib.import_module('scripts.' + source)
            task = package.make_task('123', {'account_scope': True})
            key = 'rows' if source == 'marketing' else 'list'
            transport = self.transport(source, lambda request, key=key: httpx.Response(
                200, json={'code': 0, 'data': {key: [], 'page_info': {'total_page': 1}}}))
            with self.subTest(source=source), self.assertRaises(DataError):
                package.Collector(transport).collect(task, window, {'access_token': 'test'})

    def test_each_source_owns_atomic_fact_and_audit_transaction(self):
        from unittest.mock import Mock
        from scripts.utils.model import Batch, StorageError, Window
        window = Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00')
        for source in ('marketing', 'qianchuan'):
            package = importlib.import_module('scripts.' + source)
            route = package.make_task('123', {'account_scope': True})
            for fail in (False, True):
                with self.subTest(source=source, fail=fail):
                    connection, cursor = Mock(), Mock()
                    connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
                    connection.cursor.return_value.__exit__ = Mock(return_value=False)
                    if fail:
                        cursor.execute.side_effect = [None, RuntimeError('sql failed')]
                    repository = package.Repository(connection, {'stats':source+'_stats','audit':'collector_run'})
                    batch = Batch(ads=[{'hour': '2026-10-20 09:00:00', 'dimensions': {'stat_time_hour':'2026-10-20 09:00:00','stat_datetime':'2026-10-20 09:00:00'}, 'metrics': {'_collection':{'context':{'advertiser_id':'123','time_granularity':'TIME_GRANULARITY_HOURLY','stat_datetime':'2026-10-20 09:00:00'}}}, 'cost': None}])
                    if fail:
                        with self.assertRaises(StorageError):
                            repository.write(route, window, batch)
                        connection.rollback.assert_called_once()
                        connection.commit.assert_not_called()
                    else:
                        repository.write(route, window, batch)
                        statements = [call.args[0] for call in cursor.execute.call_args_list]
                        self.assertEqual(len(statements), 3)
                        self.assertTrue(statements[0].startswith('DELETE FROM `'+source+'_stats`'))
                        self.assertTrue(statements[1].startswith('INSERT INTO `'+source+'_stats`'))
                        self.assertTrue(statements[2].startswith('INSERT INTO `collector_run`'))
                        self.assertIn('123', cursor.execute.call_args_list[1].args[1])
                        connection.commit.assert_called_once()
                        connection.rollback.assert_not_called()

    def test_authorization_error_retains_explicit_task_identity(self):
        import io
        import json
        from contextlib import redirect_stdout
        from unittest.mock import patch
        from scripts.utils.model import AuthError
        for source in ('marketing', 'qianchuan'):
            cli = importlib.import_module('scripts.' + source + '.cli')
            args = ['check-auth', '--config', str(ROOT / source / 'config/example.toml'),
                    '--advertise-id', '123']
            with (self.subTest(source=source), patch.object(cli, 'check_task', side_effect=AuthError('失效')),
                  redirect_stdout(io.StringIO()) as output):
                self.assertEqual(cli.main(args), 3)
                result = json.loads(output.getvalue())
                self.assertTrue(result['task_id'].startswith('task-'))
                self.assertEqual(result['source'], source)

class MalformedAdResponseTests(unittest.TestCase):
    transport = AdBehaviorTests.transport

    def test_each_collector_reports_malformed_data_as_domain_error(self):
        import httpx
        from scripts.utils.model import DataError, Window
        window = Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00')
        for source in ('marketing', 'qianchuan'):
            module = importlib.import_module('scripts.' + source)
            task = module.make_task('123', {'account_scope': True})
            for data in (None, [], {'page_info': None}):
                transport = self.transport(source, lambda request, data=data: httpx.Response(200, json={'code': 0, 'data': data}))
                with self.subTest(source=source, data=data), self.assertRaises(DataError):
                    module.Collector(transport).collect(task, window, {'access_token': 't'})


if __name__ == '__main__':
    unittest.main()
