import importlib
import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from scripts.utils.model import AuthError, Batch, ConfigError, DataError, StorageError, Window


class Transport:
    def __init__(self, replies):
        self.replies = iter(replies)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return next(self.replies)


class Cursor:
    def __init__(self, connection): self.connection = connection
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, params=None):
        self.connection.statements.append((sql, params))
        if self.connection.fail and '_orders`' in sql:
            raise RuntimeError('synthetic failure')


class Connection:
    def __init__(self, fail=False):
        self.statements = []
        self.commits = self.rollbacks = 0
        self.fail = fail
    def cursor(self): return Cursor(self)
    def begin(self): pass
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1


class PolicyModules(unittest.TestCase):
    def module(self, source): return importlib.import_module('scripts.' + source)
    def task(self, source, **options):
        return self.module(source).task.make_task('credential', options=options)

    def test_each_module_owns_implementation(self):
        for source in ('pingan', 'zhongan'):
            module = self.module(source)
            for cls in (module.Collector, module.Auth, module.Repository):
                self.assertTrue(cls.__module__.startswith('scripts.' + source + '.'))
            schema = Path(module.__file__).with_name('schema.sql').read_text()
            self.assertIn(source+'_stats', schema)
            self.assertIn(source+'_orders', schema)
            self.assertNotIn("CREATE OR REPLACE VIEW", schema)
            self.assertNotIn('live_source_account', schema)

    def test_policy_tasks_disallow_ads_and_unrelated_parameters(self):
        for source, options in (('pingan', {'channel': ' ch '}), ('zhongan', {'dy_no': 'dy'})):
            module = self.module(source)
            with self.assertRaises(ConfigError):
                module.task.make_task('c', options={**options, 'advertise_id':'123'})
            with self.assertRaises(ConfigError):
                module.task.make_task('c', options={**options, 'account_scope': True})
            route = module.task.make_task('c', options=options)
            self.assertEqual(module.task.validate(route).selector, '*')

    def test_policy_identity_ignores_names_and_credential(self):
        module = self.module('pingan')
        a = module.task.make_task('a', options={'channel': ' channel '})
        b = module.task.make_task('b', options={'channel': 'channel'})
        self.assertEqual(a.task_id, b.task_id)
        self.assertEqual(module.task.validate(a).resource, ('pingan', 'channel'))

    def test_pingan_extract_uses_only_named_auth_cookie(self):
        auth = importlib.import_module('scripts.pingan.auth')
        state = {'cookies': [{'name': 'auth', 'value': 'safe', 'domain': 'open.health.pingan.com', 'expires': time.time()+600},
                             {'name': 'auth', 'value': 'unrelated', 'domain': 'example.com', 'expires': 1}]}
        self.assertEqual(auth.extract_session(state, {'token_key': 'auth'})['token'], 'safe')
        with self.assertRaises(AuthError): auth.extract_session(state, {'token_key': 'missing'})

    def test_zhongan_extract_requires_all_configured_cookie_names(self):
        auth = importlib.import_module('scripts.zhongan.auth')
        state = {'cookies': [{'name': 'session', 'value': 'safe', 'domain': '.zhongan.com', 'expires': -1}]}
        result = auth.extract_session(state, {'auth_cookie_names': ['session']})
        self.assertIsNone(result['expires_at'])
        with self.assertRaises(AuthError):
            auth.extract_session(state, {'auth_cookie_names': ['session', 'missing']})

    def test_pingan_incomplete_orders_prevent_batch(self):
        transport = Transport([{'code': 200, 'data': {}}, {'code': 200, 'data': [{}]},
                               {'code': 200, 'data': {}}, {'code': 200, 'data': {'totalCount': 2, 'totalPage': 1, 'orderInfoList': [{'postId': 'one'}]}}])
        route = self.task('pingan', channel='ch')
        window = Window.parse('2026-01-01T00:00:00', '2026-01-01T01:00:00')
        with self.assertRaisesRegex(DataError, '数量不完整'):
            self.module('pingan').Collector(transport).collect(route, window, {'token': 'token'})
        self.assertTrue(all('/web/merchant/board/' in call[1] for call in transport.calls))

    def test_zhongan_collects_all_sessions_without_inventing_hourly_grain(self):
        ok = lambda data: {'code': 200, 'data': data}
        transport = Transport([ok([{'dyNo': 'dy'}]), ok({'roomId': 'live', 'attributeOfflineDTOList': [{'roomId': 'prior'}]}),
                               ok({'amount': 1}), ok([]), ok({'amount': 2}), ok([])])
        route = self.task('zhongan', dy_no='dy')
        window = Window.parse('2026-01-01T00:00:00', '2026-01-01T01:00:00')
        batch = self.module('zhongan').Collector(transport).collect(route, window, {})
        self.assertEqual([row['session_id'] for row in batch.snapshots], ['live', 'prior'])
        self.assertEqual({row['grain'] for row in batch.snapshots}, {'session_cumulative'})
        self.assertTrue(all('/newdmapi/lre/dashboardLiveController/' in call[1] for call in transport.calls))

    def test_each_repository_writes_facts_and_audit_atomically(self):
        window = Window.parse('2026-01-01T00:00:00', '2026-01-01T01:00:00')
        for source, options in (('pingan', {'channel': 'ch'}), ('zhongan', {'dy_no': 'dy'})):
            module = self.module(source)
            route = self.task(source, **options)
            batch = Batch(orders=[{'order_id': 'order', 'session_id': '', 'date': '2026-01-01', 'payload': {'postId':'order','orderNo':'order','raw':1,'_collection':{'context':{'livePlatform':'DOUYIN','dyNo':'dy'}}}}])
            connection = Connection()
            module.Repository(connection).write(route, window, batch)
            self.assertEqual(connection.commits, 1)
            self.assertEqual(connection.rollbacks, 0)
            self.assertIn('collector_run', connection.statements[-1][0])
            self.assertNotIn('first_seen_at=VALUES', connection.statements[0][0])
            sql, params = connection.statements[0]
            self.assertEqual(sql.count('%s'), len(params))
            for removed in ('raw_payload', 'scope_key', 'scope_json', 'dimension_key'):
                self.assertNotIn('`'+removed+'`', sql)
            self.assertFalse(any(isinstance(value, str) and '"raw":' in value for value in params))
            failed = Connection(fail=True)
            with self.assertRaises(StorageError): module.Repository(failed).write(route, window, batch)
            self.assertEqual((failed.commits, failed.rollbacks), (0, 1))


if __name__ == '__main__': unittest.main()
