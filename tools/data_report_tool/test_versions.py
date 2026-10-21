import contextlib
import copy
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import report_tool as tool


def field_config(topic='BASIC_DATA', field='aweme_id', qianchuan=False):
    return {'code': 0, 'data': {'custom_config_datas' if qianchuan else 'list': [{
        'data_topic': topic,
        'dimensions': [
            {'field': 'stat_time_day', 'name': '日期'},
            {'field': field, 'name': '抖音号',
             'filterable' if qianchuan else 'filter_able': True,
             'filter_config': {'operator': 7, 'type': 2, 'value_limit': 100}},
        ],
        'metrics': [{'field': 'stat_cost', 'name': '消耗'}],
    }]}, 'request_id': 'config-test'}


class VersionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.params = self.root / 'params.json'
        self.params.write_text(json.dumps({'advertiser_id': '111', 'data_topic': 'BASIC_DATA',
            'dimensions': ['stat_time_day'], 'metrics': ['stat_cost'], 'filters': [],
            'start_time': '2026-10-18 00:00:00', 'end_time': '2026-10-18 23:59:59',
            'order_by': [], 'page': 1, 'page_size': 100}))

    def run_cli(self, args, handler=None, env=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        client = httpx.Client(transport=httpx.MockTransport(handler or (lambda r: self.fail('Unexpected network'))))
        with patch.dict(os.environ, env or {}, clear=True), patch.object(tool, 'create_client', return_value=client):
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                try:
                    result = tool.main(args)
                except SystemExit as error:
                    result = error.code
        client.close()
        return result, stdout.getvalue(), stderr.getvalue()

    def test_versions_route_report_and_replace_stale_file_topic(self):
        for version, path, topic in [
            ('巨量营销-智擎版', '/open_api/v3.0/report/custom/get/', 'BASIC_DATA'),
            ('巨量营销-旧版', '/open_api/v3.0/report/custom/get/', 'STD_BASIC_DATA'),
            ('巨量千川', '/open_api/v1.0/qianchuan/report/custom/get/', 'ECP_BASIC_DATA'),
        ]:
            with self.subTest(version=version):
                code, out, err = self.run_cli(['report', '--params', str(self.params), '--version', version,
                    '--advertiser-id', '9007199254740993', '--dry-run'])
                self.assertEqual(code, 0, err)
                request = json.loads(out)
                self.assertTrue(request['url'].endswith(path))
                self.assertEqual(request['params']['data_topic'], topic)
                self.assertEqual(request['params']['advertiser_id'], '9007199254740993')

    def test_fields_can_be_requested_without_params_and_topic_is_overrideable(self):
        code, out, err = self.run_cli(['fields', '--version', 'qianchuan', '--advertiser-id', '123',
                                     '--data-topic', 'SITE_PROMOTION_POST_DATA_LIVE', '--dry-run'])
        self.assertEqual(code, 0, err)
        request = json.loads(out)
        self.assertTrue(request['url'].endswith('/qianchuan/report/custom/config/get/'))
        self.assertEqual(request['params'], {'advertiser_id':'123', 'data_topics':['SITE_PROMOTION_POST_DATA_LIVE']})

    def test_qianchuan_credentials_never_fall_back_to_marketing(self):
        env = self.root / '.env'
        env.write_text('app_id=1\naccess_token=marketing\nqianchuan_app_id=2\nqianchuan_access_token=qc-file\n')
        with patch.dict(os.environ, {'ACCESS_TOKEN':'marketing-env', 'QIANCHUAN_ACCESS_TOKEN':'qc-env'}, clear=True):
            config = tool.load_config(env, 'qianchuan')
        self.assertEqual(config, {'app_id':'2', 'access_token':'qc-env'})
        env.write_text('app_id=1\napp_secret=s\naccess_token=marketing\n')
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(tool.load_config(env, 'qianchuan'), {})
        self.assertEqual(tool.token_cache_path(env, 'smart'), tool.token_cache_path(env, 'legacy'))
        self.assertNotEqual(tool.token_cache_path(env, 'smart'), tool.token_cache_path(env, 'qianchuan'))

    def test_dry_run_uses_config_metadata_to_add_aweme_filter_and_keep_other_filters(self):
        params = json.loads(self.params.read_text())
        params['filters'] = [{'field':'stat_cost','type':3,'operator':4,'values':['0']}]
        self.params.write_text(json.dumps(params))
        config = self.root/'fields.json'; config.write_text(json.dumps(field_config()))
        code, out, err = self.run_cli(['report','--params',str(self.params),'--version','smart',
            '--room-id','abc_123','--fields-config',str(config),'--dry-run'])
        self.assertEqual(code,0,err)
        self.assertEqual(json.loads(out)['params']['filters'], [
            {'field':'stat_cost','type':3,'operator':4,'values':['0']},
            {'field':'aweme_id','type':2,'operator':7,'values':['abc_123']},
        ])
        self.assertNotIn('room_id', json.loads(out)['params'])

    def test_qianchuan_uses_its_token_config_shape_and_display_id_filter(self):
        paths=[]
        def respond(request):
            paths.append(request.url.path)
            self.assertEqual(request.headers['Access-Token'],'qc-token')
            self.assertEqual(request.url.params['advertiser_id'],'111')
            if request.url.path.endswith('/config/get/'):
                self.assertEqual(json.loads(request.url.params['data_topics']), ['ECP_BASIC_DATA'])
                return httpx.Response(200,json=field_config('ECP_BASIC_DATA','anchor_show_id',True))
            self.assertEqual(json.loads(request.url.params['filters']),[
                {'field':'anchor_show_id','type':2,'operator':7,'values':['66160988329']}])
            return httpx.Response(200,json={'code':0,'data':{'rows':[]},'request_id':'report-test'})
        code,out,err=self.run_cli(['report','--params',str(self.params),'--version','qianchuan',
            '--aweme-id','66160988329'],respond,{'access_token':'marketing-token','QIANCHUAN_ACCESS_TOKEN':'qc-token'})
        self.assertEqual(code,0,err)
        self.assertEqual(paths,['/open_api/v1.0/qianchuan/report/custom/config/get/', '/open_api/v1.0/qianchuan/report/custom/get/'])
        self.assertEqual(json.loads(out)['request_id'],'report-test')

    def test_filter_cannot_silently_expand_scope_on_missing_or_conflicting_metadata(self):
        cases=[]
        missing=field_config();missing['data']['list'][0]['dimensions'].pop();cases.append(missing)
        blocked=field_config();blocked['data']['list'][0]['dimensions'][1]['filter_able']=False;cases.append(blocked)
        excluded=field_config();excluded['data']['list'][0]['dimensions'][1]['exclusion_metrics']=['stat_cost'];cases.append(excluded)
        missing_metric=field_config();missing_metric['data']['list'][0]['metrics']=[];cases.append(missing_metric)
        wrong_operator=field_config();wrong_operator['data']['list'][0]['dimensions'][1]['filter_config']['operator']=8;cases.append(wrong_operator)
        for data in cases:
            with self.subTest(data=data):
                f=self.root/'fields.json';f.write_text(json.dumps(data))
                code,out,err=self.run_cli(['report','--params',str(self.params),'--aweme-id','abc',
                    '--fields-config',str(f),'--dry-run'])
                self.assertEqual(code,1,err)
                self.assertEqual(out,'')

    def test_dry_run_with_aweme_requires_metadata_without_network(self):
        code,out,err=self.run_cli(['report','--params',str(self.params),'--aweme-id','abc','--dry-run'])
        self.assertEqual(code,1)
        self.assertIn('--fields-config',err)

    def test_conflicting_aweme_filter_fails_and_identical_filter_is_not_duplicated(self):
        f=self.root/'fields.json';f.write_text(json.dumps(field_config()))
        for value,expected in [('other',1),('abc',0)]:
            params=json.loads(self.params.read_text())
            params['filters']=[{'field':'aweme_id','type':2,'operator':7,'values':[value]}]
            self.params.write_text(json.dumps(params))
            code,out,err=self.run_cli(['report','--params',str(self.params),'--aweme-id','abc','--fields-config',str(f),'--dry-run'])
            self.assertEqual(code,expected,err)
            if code==0:self.assertEqual(len(json.loads(out)['params']['filters']),1)

    def test_json_context_selects_version_and_is_removed_from_wire(self):
        params=json.loads(self.params.read_text())
        params['_context']={'version':'巨量营销-旧版'}
        self.params.write_text(json.dumps(params))
        code,out,err=self.run_cli(['report','--params',str(self.params),'--dry-run'])
        self.assertEqual(code,0,err)
        self.assertEqual(json.loads(out)['params']['data_topic'],'STD_BASIC_DATA')
        self.assertNotIn('_context',json.loads(out)['params'])

    def test_invalid_version_and_identifier_fail_before_auth(self):
        for args in [ ['--version','unknown'], ['--advertiser-id','1e16'], ['--advertiser-id','0'] ]:
            code,out,err=self.run_cli(['report','--params',str(self.params),'--dry-run',*args])
            self.assertNotEqual(code,0)
            self.assertEqual(out,'')


if __name__=='__main__': unittest.main()
