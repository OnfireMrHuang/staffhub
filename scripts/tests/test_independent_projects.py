import importlib
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('marketing', 'qianchuan', 'pingan', 'zhongan')

class IndependentProjects(unittest.TestCase):
    def test_collectors_do_not_need_business_ids(self):
        for source in SOURCES:
            module = importlib.import_module('scripts.' + source)
            kwargs = {'account_id':'123'} if source in SOURCES[:2] else {'options': {'channel':'demo'} if source=='pingan' else {'dy_no':'demo'}}
            task = module.task.make_task('default', **kwargs)
            self.assertFalse(hasattr(task,'product_id'))
            self.assertFalse(hasattr(task,'room_id'))

    def test_command_arguments_only_expose_used_inputs(self):
        for source in SOURCES:
            module = importlib.import_module('scripts.' + source + '.cli')
            parser = module.parser()
            for command in ('collect','check-auth','authorize'):
                result = subprocess.run([sys.executable,'-m','scripts.'+source,command,'--help'],cwd=ROOT.parent,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                for unused in ('--product-id','--room-id','--app-id','--account-scope','--metrics','--task-file'):
                    self.assertNotIn(unused,result.stdout)
                if command!='collect':
                    self.assertNotIn('--start',result.stdout)
                    self.assertNotIn('--end',result.stdout)
                if source=='zhongan':
                    self.assertNotIn('--start',result.stdout)
                    self.assertNotIn('--end',result.stdout)

    def test_all_fixed_columns_are_physical_columns(self):
        for source in SOURCES:
            definitions=json.loads((ROOT/source/'fields.json').read_text())['datasets']
            sql=(ROOT/source/'schema.sql').read_text()
            self.assertNotIn('product_id',sql)
            self.assertNotIn('room_id',sql)
            self.assertNotIn('live_ad_hourly',sql)
            for definition in definitions.values():
                self.assertIn('CREATE TABLE IF NOT EXISTS `'+definition['table']+'`',sql)
                for field in definition['fields']:
                    self.assertIn('`'+field['name']+'` '+field['sql_type'],sql)

    def test_each_source_owns_a_package_and_configuration(self):
        import tomllib
        for source in SOURCES:
            data=tomllib.loads((ROOT/source/'pyproject.toml').read_text())
            self.assertIn(source,data['project']['name'])
            self.assertTrue((ROOT/source/'config/example.toml').exists())
            self.assertIn(source,data['project']['scripts'])

    def test_pingan_display_fields_preserve_raw_and_null_denominators(self):
        from scripts.pingan.contracts import contract, project_fields, with_collection, clean_pingan_summary
        from scripts.utils.columns import values
        raw={'validPolicyCnt':3,'bindPolicyCnt':1,'allApplicantCnt':0,'multiApplicantCnt':0}
        derived=clean_pingan_summary(raw)
        payload=with_collection({'summary':[raw],'funnel':{'policyTransRate':'25.84','ctr':'12.5%'}},
                                {'startDate':'2026-10-20'},derived=derived)
        definition=contract('pingan_stats')
        actual=dict(zip([f['name'] for f in definition['fields']],values(definition,project_fields('pingan_stats',payload))))
        self.assertEqual(actual['calcBindCardRate'],'33.33%')
        self.assertIsNone(actual['multiApplicantPolRate'])
        self.assertEqual(actual['policyTransRate'],'25.84%')
        self.assertEqual(actual['ctr'],'12.5%')
        self.assertEqual(actual['orderCommitRate'],'/')
        self.assertEqual(actual['adSpend'],'-')
        self.assertEqual(payload['funnel']['ctr'],'12.5%')

    def test_zhongan_uses_one_day_and_rejects_future_date(self):
        from scripts.utils.model import DayWindow, ConfigError
        self.assertEqual(DayWindow.parse('2026-10-20').dates(),['2026-10-20'])
        with self.assertRaises(ConfigError):DayWindow.parse('2099-01-01')

    def test_spec_embeds_the_executable_source_ddl(self):
        spec=(ROOT/'SPEC.md').read_text()
        for source in SOURCES:self.assertIn((ROOT/source/'schema.sql').read_text(),spec)
