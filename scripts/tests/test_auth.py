import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import httpx
from scripts.utils.config import Config
from scripts.utils.model import Task as Route, AuthError, ConfigError
from scripts.marketing.auth import Auth as MarketingAuth
from scripts.qianchuan.auth import Auth as QianchuanAuth
from scripts.utils.auth import private_json
from scripts.pingan.auth import extract_session as extract_pingan_session
from scripts.zhongan.auth import extract_session as extract_zhongan_session

class AuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.config=Config(Path(self.tmp.name)/'config.toml',{'settings':{'state_dir':'runtime'},'auth':{'source':'marketing','env_prefix':'TEST_M_'}},[])
        self.route=Route('r','marketing','123',{'account_scope':True})
    def test_refresh_at_exact_threshold_and_preserve_rotated_token(self):
        path=self.config.state_path; private_json(path,{'app_id':'1','access_token':'old','refresh_token':'refresh','expires_at':2800})
        def handle(req):
            self.assertTrue(req.url.path.endswith('/refresh_token/'))
            body=json.loads(req.content); self.assertEqual(body['refresh_token'],'refresh'); self.assertEqual(body['app_id'],1)
            return httpx.Response(200,json={'code':0,'data':{'access_token':'new','refresh_token':'rotated','expires_in':7200}})
        manager=MarketingAuth(self.config,httpx.Client(transport=httpx.MockTransport(handle)),probe=lambda r,s: True)
        with patch.dict('os.environ',{'TEST_M_APP_ID':'1','TEST_M_APP_SECRET':'secret'},clear=True), patch('scripts.utils.auth.time.time',return_value=1000):
            state=manager.ensure(self.route,renew=True)
        self.assertEqual(state['access_token'],'new')
        self.assertEqual(json.loads(path.read_text())['refresh_token'],'rotated')
        self.assertEqual(path.stat().st_mode & 0o777,0o600)
    def test_refresh_failure_does_not_overwrite_or_exchange_code(self):
        path=self.config.state_path; old={'app_id':'1','access_token':'old','refresh_token':'refresh','expires_at':1}; private_json(path,old)
        manager=MarketingAuth(self.config,httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'code':400,'message':'secret'}))),probe=lambda r,s: True)
        with patch.dict('os.environ',{'TEST_M_APP_ID':'1','TEST_M_APP_SECRET':'secret','TEST_M_AUTH_CODE':'newcode'},clear=True), self.assertRaises(AuthError): manager.ensure(self.route,renew=True)
        self.assertEqual(json.loads(path.read_text()),old)
    def test_qianchuan_does_not_use_marketing_environment(self):
        config=Config(self.config.path,{'settings':self.config.settings,'auth':{'source':'qianchuan','env_prefix':'TEST_Q_'}},[])
        manager=QianchuanAuth(config,probe=lambda r,s:True)
        r=Route('q','qianchuan','1',{'account_scope':True})
        with patch.dict('os.environ',{'TEST_M_APP_ID':'1','TEST_M_APP_SECRET':'secret'},clear=True), self.assertRaises(AuthError): manager.ensure(r,renew=True)
    def test_browser_only_uses_configured_auth_cookie_and_domain(self):
        state={'cookies':[{'name':'access','value':'bad','domain':'attacker.example','expires':time.time()+8000},{'name':'access','value':'good','domain':'open.health.pingan.com','expires':time.time()+8000},{'name':'tracker','value':'x','domain':'open.health.pingan.com','expires':1}], 'origins':[]}
        result=extract_pingan_session(state,{'token_key':'access','token_storage':'cookie'})
        self.assertEqual(result['token'],'good')
        self.assertGreater(result['expires_at'],time.time())
        state['cookies'][1]['expires']=1
        with self.assertRaises(AuthError): extract_pingan_session(state,{'token_key':'access','token_storage':'cookie'})
    def test_expiry_unknown_is_not_invented(self):
        state={'cookies':[{'name':'sid','value':'opaque','domain':'adagent.zhongan.com','path':'/','expires':-1}], 'origins':[]}
        self.assertIsNone(extract_zhongan_session(state,{'auth_cookie_names':['sid']})['expires_at'])

class SavedStateTests(unittest.TestCase):
    def test_source_changed_in_cached_auth_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg=Config(Path(tmp)/'c.toml',{'settings':{'state_dir':'runtime'},'auth':{'source':'marketing','env_prefix':'M_'}},[])
            private_json(cfg.state_path,{'source':'qianchuan','app_id':'1','access_token':'q','refresh_token':'r','expires_at':time.time()+9000})
            manager=MarketingAuth(cfg,probe=lambda r,s:True)
            with patch.dict('os.environ',{'M_APP_ID':'1'}),self.assertRaises(AuthError):
                manager.ensure(Route('r','marketing','1',{}))

    def test_one_oauth_cache_is_reused_and_rotated_once_for_multiple_accounts(self):
        from scripts.marketing.task import make_task
        with tempfile.TemporaryDirectory() as tmp:
            cfg=Config(Path(tmp)/'c.toml',{'settings':{'state_dir':'runtime'},
                       'auth':{'source':'marketing','env_prefix':'M_'}},[])
            private_json(cfg.state_path,{'source':'marketing','app_id':'1','access_token':'old',
                                        'refresh_token':'refresh','expires_at':1})
            probe=Mock(return_value=True)
            with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200,json={
                    'code':0,'data':{'access_token':'new','refresh_token':'rotated','expires_in':7200}}))) as client:
                manager=MarketingAuth(cfg,client,probe=probe)
                with patch.dict('os.environ',{'M_APP_ID':'1','M_APP_SECRET':'secret'},clear=True), \
                     patch.object(manager,'exchange',wraps=manager.exchange) as exchange:
                    for account in ('123','456'):
                        self.assertEqual(manager.ensure(make_task(account),renew=True)['access_token'],'new')
                    exchange.assert_called_once()
            self.assertEqual([call.args[0].account_id for call in probe.call_args_list],['123','456'])
            self.assertEqual([p.resolve() for p in (Path(tmp)/'runtime').rglob('auth.json')],[cfg.state_path])

    def test_sources_are_isolated_under_shared_state_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths=[]
            for source in ('marketing','qianchuan','pingan','zhongan'):
                cfg=Config(Path(tmp)/'c.toml',{'settings':{'state_dir':'runtime'},'auth':{'source':source}},[])
                paths.append(cfg.state_path)
                self.assertEqual(cfg.browser_dir,(Path(tmp)/'runtime'/source/'browser').resolve())
            self.assertEqual(len(set(paths)),4)

    def test_browser_collectors_reuse_cached_cookie_state_without_opening_browser(self):
        from scripts.pingan.auth import Auth as PinganAuth
        from scripts.zhongan.auth import Auth as ZhonganAuth
        for source,manager_type,profile,session in (
            ('pingan',PinganAuth,{'token_key':'access'},{'token':'cookie-token'}),
            ('zhongan',ZhonganAuth,{'auth_cookie_names':['sid']},{'cookies':[{'name':'sid','value':'cached'}]})):
            with self.subTest(source=source),tempfile.TemporaryDirectory() as tmp:
                cfg=Config(Path(tmp)/'c.toml',{'settings':{'state_dir':'runtime'},
                           'auth':{'source':source,**profile}},[])
                state={'source':source,'expires_at':None,**session}
                private_json(cfg.state_path,state)
                capture=Mock(return_value=state)
                probe=Mock(return_value=True)
                with httpx.Client() as client:
                    manager=manager_type(cfg,client,probe=probe,capture=capture)
                    self.assertEqual(manager.ensure(Route('t',source))['source'],source)
                    capture.assert_not_called()
                    manager.ensure(Route('t',source),renew=True,force=True)
                capture.assert_called_once()
                self.assertEqual(json.loads(cfg.state_path.read_text()),state)
                self.assertEqual(cfg.state_path.stat().st_mode & 0o777,0o600)

    def test_legacy_alias_config_fails_with_explicit_migration_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'c.toml'
            path.write_text('[credentials.default]\nsource="marketing"\n')
            with self.assertRaisesRegex(ConfigError,r'\[auth\]'):Config.load(path)

class SourceApplicationTests(unittest.TestCase):
    def test_synced_application_must_match_actual_oauth_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg=Config(Path(tmp)/'c.toml',{'settings':{'state_dir':'runtime'},'auth':{'source':'marketing','env_prefix':'M_'}},[])
            private_json(cfg.state_path,{'source':'marketing','app_id':'1','access_token':'x','expires_at':time.time()+9000})
            manager=MarketingAuth(cfg,probe=lambda r,s:True)
            cfg.auth['app_id']='2'
            route=Route('r','marketing','123',{'account_scope':True})
            with patch.dict('os.environ',{'M_APP_ID':'1'}),self.assertRaises(AuthError): manager.ensure(route)
