import json
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from scripts.utils.auth import BrowserAuth, OAuthAuth, private_json
from scripts.utils.config import Config
from scripts.utils.database import Database
from scripts.utils.model import AuthError, Batch, ConfigError, Task as Route, Scope, StorageError, Window
from scripts.utils.runtime import CollectionService


class Cursor:
    def __init__(self): self.statements = []
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, params=None): self.statements.append((sql, params))


class Connection:
    def __init__(self): self.events = []; self.cur = Cursor()
    def begin(self): self.events.append('begin')
    def cursor(self): return self.cur
    def commit(self): self.events.append('commit')
    def rollback(self): self.events.append('rollback')


class CommonDatabaseTests(unittest.TestCase):
    def test_policy_schema_comments_are_not_executed_as_sql(self):
        root = Path(__file__).resolve().parents[1]
        for source in ('pingan', 'zhongan'):
            with self.subTest(source=source):
                connection = Connection()
                Database(connection).init_schema_files(root.parent / 'scripts' / source / 'schema.sql')
                statements = ['\n'.join(line for line in sql.splitlines()
                                        if not line.lstrip().startswith('--')).strip()
                              for sql, _ in connection.cur.statements]
                self.assertEqual(len(statements), 2, 'two typed source tables')
                self.assertTrue(all(sql.startswith('CREATE ') for sql in statements), statements)
                self.assertEqual(connection.events, ['commit'])

    def test_schema_execution_and_rollback_failure_stay_storage_errors(self):
        class FailedCursor(Cursor):
            def execute(self, sql, params=None): raise RuntimeError('driver schema details')
        class FailedConnection(Connection):
            def __init__(self): super().__init__(); self.cur = FailedCursor()
            def rollback(self): raise RuntimeError('driver rollback details')
        with self.assertRaises(StorageError) as caught:
            Database(FailedConnection()).init_schema_files(
                Path(__file__).resolve().parents[2] / 'scripts/utils/audit.sql')
        self.assertNotIn('driver', str(caught.exception))

    def test_transaction_commits_only_after_body(self):
        connection = Connection()
        with Database(connection).transaction() as cursor:
            cursor.execute('INSERT synthetic')
            self.assertEqual(connection.events, ['begin'])
        self.assertEqual(connection.events, ['begin', 'commit'])

    def test_transaction_rolls_back_original_failure(self):
        connection = Connection()
        with self.assertRaises(StorageError):
            with Database(connection).transaction():
                raise ValueError('bad batch')
        self.assertEqual(connection.events, ['begin', 'rollback'])

    def test_transaction_preserves_classified_error(self):
        connection = Connection()
        with self.assertRaisesRegex(AuthError, 'token missing'):
            with Database(connection).transaction():
                raise AuthError('token missing')
        self.assertEqual(connection.events, ['begin', 'rollback'])

    def test_commit_and_rollback_failures_stay_storage_errors(self):
        class FailedCommit(Connection):
            def commit(self): raise RuntimeError('driver credentials must not escape')
            def rollback(self): raise RuntimeError('driver rollback details')
        with self.assertRaises(StorageError) as caught:
            with Database(FailedCommit()).transaction(): pass
        self.assertNotIn('driver', str(caught.exception))

    def test_failure_audit_does_not_write_facts(self):
        connection = Connection()
        Database(connection).failure(Route('r', 'marketing', 'm'),
                                     Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00'),
                                     AuthError('授权缺失'))
        sql, params = connection.cur.statements[0]
        self.assertIn('INSERT INTO collector_run', sql)
        self.assertEqual(params[6:8], (3, 0))
        self.assertEqual(connection.events, ['begin', 'commit'])


class GenericAuthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.config = Config(Path(self.directory.name) / 'c.toml', {
            'settings': {'state_dir': 'runtime'},
            'credentials': {'m': {'source': 'marketing', 'env_prefix': 'TEST_'},
                            'p': {'source': 'pingan'}}}, [])
        self.route = Route('r', 'marketing', 'm', '1', {'account_scope': True})
        class Auth(OAuthAuth): source = 'marketing'
        self.Auth = Auth

    def test_source_subclass_cannot_use_other_profile(self):
        wrong = Route('r', 'pingan', 'p')
        with self.assertRaises(AuthError): self.Auth(self.config, probe=lambda *_: True).ensure(wrong)
        wrong = Route('r', 'marketing', 'p')
        with self.assertRaises(AuthError): self.Auth(self.config, probe=lambda *_: True).ensure(wrong)

    def test_rotation_is_saved_before_source_probe(self):
        path = self.config.credential_path('m')
        private_json(path, {'source': 'marketing', 'app_id': '1', 'access_token': 'old',
                            'refresh_token': 'old-refresh', 'expires_at': 1})
        client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(
            200, json={'code': 0, 'data': {'access_token': 'new', 'refresh_token': 'rotated', 'expires_in': 7200}})))
        def denied(*args): raise AuthError('scope denied')
        with patch.dict('os.environ', {'TEST_APP_ID': '1', 'TEST_APP_SECRET': 'secret'}), self.assertRaises(AuthError):
            self.Auth(self.config, client=client, probe=denied).ensure(self.route, renew=True)
        self.assertEqual(json.loads(path.read_text())['refresh_token'], 'rotated')
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_expected_application_checked_before_probe(self):
        self.config.credentials['m']['app_id']='2'
        route = self.route
        with patch.dict('os.environ', {'TEST_APP_ID': '1'}), self.assertRaises(AuthError):
            self.Auth(self.config, probe=lambda *_: self.fail('must not probe')).ensure(route)

    def test_browser_uses_injected_capture_and_source_probe(self):
        calls = []
        class Auth(BrowserAuth):
            source = 'pingan'
            def _capture(self, *args): raise AssertionError('injected capture takes precedence')
        def capture(config, route, profile, wait, validate):
            state = {'source': 'pingan', 'token': 'opaque', 'expires_at': None}
            validate(state); return state
        route = Route('r', 'pingan', 'p')
        state = Auth(self.config, capture=capture, probe=lambda r, s: calls.append(r.source) or 'verified').ensure(route, renew=True)
        self.assertEqual(state['scope_status'], 'verified')
        self.assertEqual(calls, ['pingan', 'pingan'])

    def test_source_profile_fields_are_not_required_by_general_config(self):
        path = Path(self.directory.name) / 'settings.toml'
        path.write_text('[credentials.p]\nsource="pingan"\n[credentials.m]\nsource="marketing"\n')
        config = Config.load(path)
        self.assertEqual(set(config.credentials), {'p', 'm'})
        with self.assertRaises(AuthError):
            self.Auth(config, probe=lambda *_: True).ensure(self.route, renew=True)


class SharedValidationTests(unittest.TestCase):
    def test_scope_conflicts_are_generic(self):
        from catalog.validation import validate_routes
        from catalog.model import Route as Plan
        routes = [Plan('a','p','r1','marketing','m','1',{'aweme_id':'abc'}),
                  Plan('b','p','r2','marketing','m','1',{'account_scope':True})]
        with self.assertRaises(ConfigError): validate_routes(routes, {'m': {'source':'marketing'}})

    def test_nonempty_scope_namespaces_cannot_mix(self):
        from catalog.validation import validate_routes
        from catalog.model import Route as Plan
        routes = [Plan('a','p','r1','qianchuan','q','1',{'aweme_id':'abc'}),
                  Plan('b','p','r2','qianchuan','q','1',{'aweme_ids':['2']})]
        with self.assertRaises(ConfigError): validate_routes(routes, {'q': {'source':'qianchuan'}})


class RuntimeTests(unittest.TestCase):
    def test_runtime_uses_concrete_collector_and_repository_lock(self):
        calls = []
        class Repository:
            def lock_name(self, route): return 'source-lock'
            @contextmanager
            def lock(self, name): calls.append(name); yield
            def write(self, *args): calls.append('write')
            def failure(self, *args): calls.append('failure')
        route = Route('r', 'marketing', 'm')
        auth = SimpleNamespace(ensure=lambda route: {'token': 'safe'})
        collector = SimpleNamespace(collect=lambda route, window, state: Batch())
        result = CollectionService(Repository(), auth, collector).execute(route, None)
        self.assertEqual(result['code'], 0)
        self.assertEqual(calls, ['source-lock', 'write'])


if __name__ == '__main__': unittest.main()
