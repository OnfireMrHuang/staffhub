import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
from scripts.utils.config import Config
from scripts.utils.model import Route, AuthError, AlertError
from scripts.marketing.auth import Auth as MarketingAuth
from scripts.qianchuan.auth import Auth as QianchuanAuth
from scripts.utils.auth import private_json
from scripts.pingan.auth import extract_session as extract_pingan_session
from scripts.zhongan.auth import extract_session as extract_zhongan_session
from scripts.utils.notify import Notifier

class AuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.config=Config(Path(self.tmp.name)/'config.toml',{'settings':{'state_dir':'runtime'},'credentials':{'m':{'source':'marketing','env_prefix':'TEST_M_'},'q':{'source':'qianchuan','env_prefix':'TEST_Q_'}}},[])
        self.route=Route('r','p','room','marketing','m','123',{'account_scope':True})
    def test_refresh_at_exact_threshold_and_preserve_rotated_token(self):
        path=self.config.credential_path('m'); private_json(path,{'app_id':'1','access_token':'old','refresh_token':'refresh','expires_at':2800})
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
        path=self.config.credential_path('m'); old={'app_id':'1','access_token':'old','refresh_token':'refresh','expires_at':1}; private_json(path,old)
        manager=MarketingAuth(self.config,httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'code':400,'message':'secret'}))),probe=lambda r,s: True)
        with patch.dict('os.environ',{'TEST_M_APP_ID':'1','TEST_M_APP_SECRET':'secret','TEST_M_AUTH_CODE':'newcode'},clear=True), self.assertRaises(AuthError): manager.ensure(self.route,renew=True)
        self.assertEqual(json.loads(path.read_text()),old)
    def test_qianchuan_does_not_use_marketing_environment(self):
        manager=QianchuanAuth(self.config,probe=lambda r,s:True)
        r=Route('q','p','room','qianchuan','q','1',{'account_scope':True})
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

class NotifyTests(unittest.TestCase):
    def test_failed_recipient_is_not_marked_sent_and_retry_then_cooldown(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg=Config(Path(tmp)/'c.toml',{'settings':{'state_dir':'runtime'},'sms':{'enabled':True,'phone_numbers':['+8613800000000'],'template_params':['{source}','{minutes}']}},[])
            calls=[]
            def sender(body):
                calls.append(body)
                return {'SendStatusSet':[{'Code':'FailedOperation' if len(calls)==1 else 'Ok','PhoneNumber':'+8613800000000'}]}
            n=Notifier(cfg,sender=sender)
            with self.assertRaises(AlertError): n.send('marketing','m','auth_required')
            self.assertEqual(n.send('marketing','m','auth_required'),'sent')
            self.assertEqual(n.send('marketing','m','auth_required'),'cooldown')
            self.assertEqual(len(calls),2)
            self.assertEqual(calls[0]['TemplateParamSet'],['巨量营销','30'])

class SavedStateTests(unittest.TestCase):
    def test_source_changed_under_existing_credential_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg=Config(Path(tmp)/'c.toml',{'settings':{'state_dir':'runtime'},'credentials':{'m':{'source':'marketing','env_prefix':'M_'}}},[])
            private_json(cfg.credential_path('m'),{'source':'qianchuan','app_id':'1','access_token':'q','refresh_token':'r','expires_at':time.time()+9000})
            manager=MarketingAuth(cfg,probe=lambda r,s:True)
            with patch.dict('os.environ',{'M_APP_ID':'1'}),self.assertRaises(AuthError):
                manager.ensure(Route('r','p','room','marketing','m','1',{}))

class SourceApplicationTests(unittest.TestCase):
    def test_synced_application_must_match_actual_oauth_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg=Config(Path(tmp)/'c.toml',{'settings':{'state_dir':'runtime'},'credentials':{'m':{'source':'marketing','env_prefix':'M_'}}},[])
            private_json(cfg.credential_path('m'),{'source':'marketing','app_id':'1','access_token':'x','expires_at':time.time()+9000})
            manager=MarketingAuth(cfg,probe=lambda r,s:True)
            route=Route('r','p','room','marketing','m','123',{'expected_app_id':'2'})
            with patch.dict('os.environ',{'M_APP_ID':'1'}),self.assertRaises(AuthError): manager.ensure(route)
