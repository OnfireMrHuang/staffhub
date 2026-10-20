import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

import report_tool as tool


class ReportToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / '.env'
        self.env.write_text('app_id=123\napp_secret="secret#value"\nauth_code=code\n')

    def client(self, handler):
        client = httpx.Client(transport=httpx.MockTransport(handler))
        self.addCleanup(client.close)
        return client

    def test_env_supports_quotes_uppercase_and_environment_precedence(self):
        with patch.dict(os.environ, {'APP_ID': '456'}, clear=True):
            config = tool.load_config(self.env)
        self.assertEqual(config['app_id'], '456')
        self.assertEqual(config['app_secret'], 'secret#value')

    def test_get_encodes_nested_json_and_preserves_large_ids(self):
        def respond(request):
            self.assertEqual(request.method, 'GET')
            self.assertEqual(request.url.path, '/open_api/v3.0/report/custom/get/')
            self.assertEqual(request.headers['Access-Token'], 'test-token')
            self.assertEqual(request.url.params['advertiser_id'], '9007199254740993')
            self.assertEqual(request.url.params['dimensions'], '["stat_time_day"]')
            self.assertEqual(json.loads(request.url.params['filters']), [
                {'field': 'ad_name', 'operator': 'EQUALS', 'values': ['测试 & +']}])
            self.assertNotIn('unused', request.url.params)
            return httpx.Response(200, json={'code': 0, 'data': {'rows': []}, 'request_id': 'r1'})
        params = {'advertiser_id': 9007199254740993, 'dimensions': ['stat_time_day'],
                  'filters': [{'field': 'ad_name', 'operator': 'EQUALS', 'values': ['测试 & +']}],
                  'unused': None}
        result = tool.api_request(self.client(respond), 'report', params, 'test-token')
        self.assertEqual(result['request_id'], 'r1')

    def test_exchange_maps_secret_and_caches_without_printing_tokens(self):
        def respond(request):
            self.assertEqual(request.url.path, '/open_api/oauth2/access_token/')
            self.assertEqual(request.method, 'POST')
            self.assertEqual(json.loads(request.content), {
                'app_id': 123, 'secret': 'secret#value', 'auth_code': 'code'})
            return httpx.Response(200, json={'code': 0, 'data': {
                'access_token': 'access-private', 'refresh_token': 'refresh-private',
                'expires_in': 7200, 'refresh_token_expires_in': 2592000}})
        cache = self.root / 'cache.json'
        with patch.dict(os.environ, {}, clear=True):
            manager = tool.TokenManager(tool.load_config(self.env), cache, self.client(respond))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            token = manager.exchange()
        self.assertEqual(token, 'access-private')
        saved = json.loads(cache.read_text())
        self.assertEqual(saved['app_id'], '123')
        self.assertEqual(saved['refresh_token'], 'refresh-private')
        self.assertEqual(cache.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('access-private', output.getvalue())
        self.assertEqual(manager.get(), 'access-private')

    def test_expired_token_refreshes_and_persists_rotated_refresh_token(self):
        cache = self.root / 'cache.json'
        cache.write_text(json.dumps({'app_id': '123', 'access_token': 'old',
                                     'expires_at': 1, 'refresh_token': 'refresh-old'}))
        def respond(request):
            self.assertEqual(request.url.path, '/open_api/oauth2/refresh_token/')
            self.assertEqual(json.loads(request.content), {
                'app_id': 123, 'secret': 's', 'refresh_token': 'refresh-old'})
            return httpx.Response(200, json={'code': 0, 'data': {
                'access_token': 'new', 'refresh_token': 'refresh-new', 'expires_in': 7200}})
        manager = tool.TokenManager({'app_id': '123', 'app_secret': 's'}, cache, self.client(respond))
        self.assertEqual(manager.get(), 'new')
        self.assertEqual(json.loads(cache.read_text())['refresh_token'], 'refresh-new')

    def test_cache_for_another_app_is_not_reused(self):
        cache = self.root / 'cache.json'
        cache.write_text(json.dumps({'app_id': '999', 'access_token': 'wrong', 'expires_at': 9999999999}))
        manager = tool.TokenManager({'app_id': '123'}, cache, self.client(lambda r: self.fail('network')))
        with self.assertRaises(tool.ToolError):
            manager.get()

    def test_business_error_preserves_request_id(self):
        client = self.client(lambda r: httpx.Response(200, json={
            'code': 40000, 'message': 'invalid metrics', 'request_id': 'trace-123'}))
        with self.assertRaises(tool.ToolError) as caught:
            tool.api_request(client, 'report', {}, 'token')
        self.assertIn('40000', str(caught.exception))
        self.assertIn('trace-123', str(caught.exception))
        self.assertEqual(caught.exception.response['message'], 'invalid metrics')

    def test_http_non_json_and_network_failures_are_actionable(self):
        for status, body in [(429, 'rate limited'), (200, '<html>bad gateway</html>')]:
            with self.subTest(status=status):
                with self.assertRaises(tool.ToolError):
                    tool.api_request(self.client(lambda r: httpx.Response(status, text=body)), 'fields', {}, 't')
        def timeout(request):
            raise httpx.ReadTimeout('timed out', request=request)
        with self.assertRaises(tool.ToolError):
            tool.api_request(self.client(timeout), 'fields', {}, 't')

    def test_dry_run_needs_no_env_or_network_and_keeps_json_arrays(self):
        params = self.root / 'params.json'
        params.write_text('{"advertiser_id":123,"data_topics":["BASIC_DATA"]}')
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), patch.object(httpx.Client, 'send', side_effect=AssertionError('network')):
            with contextlib.redirect_stdout(output):
                code = tool.main(['fields', '--params', str(params), '--env', str(self.root / 'missing'), '--dry-run'])
        self.assertEqual(code, 0)
        preview = json.loads(output.getvalue())
        self.assertEqual(preview['method'], 'GET')
        self.assertEqual(preview['params']['data_topics'], ['BASIC_DATA'])
        self.assertEqual(preview['headers']['Access-Token'], '***')

    def test_invalid_json_fails_before_auth(self):
        for content in ['[]', '{bad', '{"page": NaN}']:
            params = self.root / 'params.json'
            params.write_text(content)
            with self.subTest(content=content), self.assertRaises(tool.ToolError):
                tool.read_json(params)

    def test_cli_writes_full_response_and_returns_nonzero_on_api_error(self):
        params = self.root / 'params.json'
        params.write_text('{"advertiser_id":123,"data_topics":["BASIC_DATA"]}')
        for code in [0, 40000]:
            response = {'code': code, 'message': 'test', 'data': {'list': []}, 'request_id': 'r2'}
            client = self.client(lambda r: httpx.Response(200, json=response))
            output = self.root / f'output-{code}.json'
            with patch.dict(os.environ, {'access_token': 'test'}, clear=True), patch.object(tool, 'create_client', return_value=client):
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    result = tool.main(['fields', '--params', str(params), '--output', str(output)])
            self.assertEqual(result, 0 if code == 0 else 1)
            self.assertEqual(json.loads(output.read_text()), response)


if __name__ == '__main__':
    unittest.main()
