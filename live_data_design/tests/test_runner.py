import unittest
from unittest.mock import Mock, patch
from live_data.runner import Runner
from live_data.dispatch import Dispatcher
from scripts.utils.model import Route, Window, AuthError

WINDOW = Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00')


class Dispatch:
    def __init__(self):
        self.saved, self.checks = [], []
        self.failure_code = 3

    def collect(self, route, window):
        if route.route_id == 'bad':
            return {'code': self.failure_code, 'status': 'failed', 'route_id': route.route_id}
        self.saved.append(route.route_id)
        return {'code': 0, 'status': 'success', 'route_id': route.route_id}

    def ensure(self, route, **options):
        self.checks.append((route.route_id, options))
        if route.route_id == 'bad':
            raise AuthError('failed')
        return {}


class RunnerTests(unittest.TestCase):
    def test_partial_failure_not_reported_success_and_strategies(self):
        routes = [Route('bad','p','a','marketing','c'), Route('next-account','p','a','marketing','c'),
                  Route('other-room','p','b','marketing','c')]
        for policy, want in [('continue',['next-account','other-room']), ('skip-room',['other-room']), ('abort',[])]:
            dispatch = Dispatch()
            result = Runner(dispatch, on_error=policy).collect(routes, WINDOW)
            self.assertEqual(dispatch.saved, want)
            self.assertEqual(result['code'], 3)
            self.assertEqual(result['results'][0]['status'], 'failed')

    def test_skip_room_does_not_skip_same_room_label_in_other_product(self):
        routes = [Route('bad','a','room','marketing','c'), Route('next-account','b','room','marketing','c')]
        dispatch = Dispatch()
        Runner(dispatch, on_error='skip-room').collect(routes, WINDOW)
        self.assertEqual(dispatch.saved, ['next-account'])

    def test_ad_accounts_finish_before_single_policy_task(self):
        routes = [Route('a-policy','p','room','pingan','c'), Route('z-account-2','p','room','marketing','c','2'),
                  Route('y-account-1','p','room','marketing','c','1')]
        dispatch = Dispatch()
        Runner(dispatch).collect(routes, WINDOW)
        self.assertEqual(dispatch.saved, ['y-account-1','z-account-2','a-policy'])

    def test_dispatcher_calls_owning_module_public_api(self):
        route = Route('one','p','r','marketing','c')
        config = object()
        module = Mock()
        module.cli.collect_task.return_value = {'code': 0}
        module.cli.check_task.return_value = {'scope_status': 'verified'}
        with patch('live_data.dispatch.get', return_value=module) as lookup:
            dispatcher = Dispatcher(config)
            self.assertEqual(dispatcher.collect(route, WINDOW), {'code': 0})
            dispatcher.ensure(route, renew=True)
            self.assertEqual(lookup.call_args_list[0].args, ('marketing',))
        module.cli.collect_task.assert_called_once_with(config, route, WINDOW)
        module.cli.check_task.assert_called_once_with(config, route, renew=True)

    def test_storage_failure_always_stops_remaining_tasks(self):
        dispatch = Dispatch()
        dispatch.failure_code = 5
        result = Runner(dispatch).collect([Route('bad','a','r','marketing','c'),
                                           Route('next','b','r','marketing','c')], WINDOW)
        self.assertEqual(dispatch.saved, [])
        self.assertEqual(result['results'][1]['status'], 'skipped')
        self.assertEqual(result['code'], 5)

    def test_authorize_and_maintenance_renew_once_then_check_every_scope(self):
        routes = [Route('one','p','r','marketing','c'), Route('two','p','r','marketing','c')]
        for method in ('maintain', 'check'):
            dispatch = Dispatch()
            runner = Runner(dispatch)
            result = runner.maintain(routes) if method == 'maintain' else runner.check(routes, authorize=True)
            self.assertEqual(result['code'], 0)
            self.assertEqual([r for r, _ in dispatch.checks], ['one', 'two'])
            self.assertTrue(dispatch.checks[0][1]['renew'])
            self.assertFalse(dispatch.checks[1][1].get('renew', False))
