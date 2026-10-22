import io
import json
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from scripts.utils.model import AuthError, Batch, BusyError, ConfigError, DataError, StorageError, Window

from registry import get

def make_task(source, credential, account_id="", options=None):
    module=get(source)
    return module.task.make_task(credential,account_id,options) if source in ("marketing","qianchuan") else module.task.make_task(credential,options)

ROOT = Path(__file__).resolve().parents[1]


def task_lock_name(route):
    return get(route.source).Repository.lock_name(route)


class TaskTests(unittest.TestCase):
    def test_business_identity_ignores_metrics_app_and_credentials(self):
        one = make_task('marketing', 'c', '123', {'account_scope': True})
        two = make_task('marketing', 'other', '123', {
            'account_scope': True, 'version': 'smart',
            'account_name': '广告账户', 'account_type': '小店'})
        self.assertEqual(one.task_id, two.task_id)
        scoped = make_task('marketing', 'c', '123', {'aweme_id': 'abc'})
        self.assertNotEqual(one.task_id, scoped.task_id)
        self.assertEqual(task_lock_name(one), task_lock_name(scoped))
        self.assertLessEqual(len(task_lock_name(one)), 64)

    def test_policy_identity_defaults_and_whitespace_are_canonical(self):
        one = make_task('zhongan', 'c', options={'dy_no': '123'})
        two = make_task('zhongan', 'c', options={
            'dy_no': ' 123 ', 'platform': 'DOUYIN'})
        other = make_task('zhongan', 'c', options={'dy_no': '123'})
        self.assertEqual(one.task_id, two.task_id)
        self.assertEqual(task_lock_name(one), task_lock_name(other))

    def test_unknown_or_secret_options_and_ambiguous_scope_are_rejected(self):
        for options in ({'account_scope': True, 'access_token': 'secret'},
                        {'account_scope': True, 'aweme_id': 'a'},
                        {'account_scope': True, 'metrics': ['stat_cost', 'stat_cost']},
                        {'account_scope': True, 'expected_app_id': 'not-a-number'}):
            with self.subTest(options=options), self.assertRaises(ConfigError):
                make_task('marketing', 'c', '123', options)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.route = make_task('pingan', 'c', options={'channel': 'DEMO'})
        self.window = Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00')
        self.events = []
        events = self.events
        class Database:
            @staticmethod
            def lock_name(route): return task_lock_name(route)
            @contextmanager
            def lock(self, name='scheduler'):
                events.append(('lock', name)); yield; events.append(('unlock', name))
            def write(self, route, window, batch): events.append(('write', batch.count))
            def failure(self, route, window, error): events.append(('failure', error.code))
        self.store = Database()
        self.auth = Mock()
        self.auth.ensure.side_effect = lambda route: events.append(('auth', route.task_id)) or {}
        self.collector = Mock()
        self.collector.collect.side_effect = lambda *args: events.append(('collect',)) or Batch(orders=[{}])

    def service(self):
        from scripts.utils.runtime import CollectionService
        return CollectionService(self.store, self.auth, self.collector)

    def test_scope_lock_wraps_auth_collection_and_commit(self):
        result = self.service().execute(self.route, self.window)
        self.assertEqual([e[0] for e in self.events], ['lock', 'auth', 'collect', 'write', 'unlock'])
        self.assertEqual(result['rows'], 1)
        self.assertEqual(result['task_id'], self.route.task_id)
        self.assertEqual(result['code'], 0)

    def test_failed_source_is_audited_without_writing_partial_results(self):
        self.collector.collect.side_effect = DataError('分页不完整')
        result = self.service().execute(self.route, self.window)
        self.assertEqual(result['code'], 4)
        self.assertIn(('failure', 4), self.events)
        self.assertFalse(any(e[0] == 'write' for e in self.events))

    def test_storage_failure_is_not_audited_again(self):
        self.store.write = Mock(side_effect=StorageError('事务回滚'))
        self.store.failure = Mock()
        result = self.service().execute(self.route, self.window)
        self.assertEqual(result['code'], 5)
        self.store.failure.assert_not_called()

    def test_audit_failure_propagates_storage_status(self):
        self.auth.ensure.side_effect = AuthError('授权缺失')
        self.store.failure = Mock(side_effect=StorageError('失败审计不可写'))
        result = self.service().execute(self.route, self.window)
        self.assertEqual(result['code'], 5)
        self.assertTrue(result['audit_error'])

    def test_unknown_exception_does_not_leak_response_or_secret(self):
        self.collector.collect.side_effect = RuntimeError('access_token=VERY_SECRET')
        result = self.service().execute(self.route, self.window)
        self.assertEqual(result['code'], 4)
        self.assertEqual(result['error_type'], 'RuntimeError')
        self.assertNotIn('VERY_SECRET', json.dumps(result))


class ScriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Path(self.temp.name) / 'standalone.toml'
        self.config.write_text('''[credentials.ad]
source="marketing"
env_prefix="TEST_AD_"
[credentials.qc]
source="qianchuan"
env_prefix="TEST_QC_"
[credentials.pa]
source="pingan"
token_key="token"
[credentials.za]
source="zhongan"
''')

    def args(self, source, command='collect'):
        values = [command, '--config', str(self.config), '--credential', {'marketing': 'ad', 'qianchuan': 'qc', 'pingan': 'pa', 'zhongan': 'za'}[source]]
        if source in ('marketing', 'qianchuan'):
            values += ['--advertise-id', '123']
        elif source == 'pingan': values += ['--channel', 'PA-DEMO']
        else: values += ['--dy-no', 'ZA-DEMO']
        return values

    def test_all_four_scripts_preview_without_catalog_database_or_auth(self):
        for source in ('marketing', 'qianchuan', 'pingan', 'zhongan'):
            with (self.subTest(source=source), patch('scripts.utils.database.Database.connect', side_effect=AssertionError('DB')),
                  patch('httpx.Client', side_effect=AssertionError('network')),
                  redirect_stdout(io.StringIO()) as output):
                code = get(source).cli.main(self.args(source) + ['--dry-run'])
            self.assertEqual(code, 0, output.getvalue())
            self.assertEqual(json.loads(output.getvalue())['source'], source)

    def test_auth_commands_do_not_connect_to_database(self):
        for command in ('authorize', 'check-auth'):
            with (patch('scripts.utils.database.Database.connect', side_effect=AssertionError('DB')),
                  patch('scripts.pingan.cli.Auth.ensure', return_value={'scope_status': 'verified'}) as ensure,
                  redirect_stdout(io.StringIO()) as output):
                self.assertEqual(get('pingan').cli.main(self.args('pingan', command)), 0, output.getvalue())
                self.assertEqual(ensure.call_args.kwargs['renew'], command == 'authorize')

    def test_task_file_cannot_override_source_or_mix_explicit_fields(self):
        path = Path(self.temp.name) / 'task.json'
        path.write_text(json.dumps({'source': 'pingan', 'product_id': 'p', 'room_id': 'r',
                                    'credential': 'pa', 'options': {'channel': 'DEMO'}}))
        for args in ([ '--task-file', str(path)], ['--task-file', str(path), '--product-id', 'x']):
            with redirect_stdout(io.StringIO()) as output:
                code = get('marketing').cli.main(['collect', '--config', str(self.config), '--dry-run', *args])
            self.assertEqual(code, 2, output.getvalue())

    def test_cli_and_source_api_produce_same_scope_id(self):
        with redirect_stdout(io.StringIO()) as output:
            self.assertEqual(get('marketing').cli.main(self.args('marketing')+['--dry-run']),0)
        self.assertEqual(json.loads(output.getvalue())['task_id'],get('marketing').make_task('ad','123').task_id)

    def test_script_launch_works_from_unrelated_directory(self):
        result = subprocess.run([sys.executable, '-m', 'scripts.pingan',
            *self.args('pingan'), '--dry-run'], cwd=self.temp.name, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['code'], 0)
