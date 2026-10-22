import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
class CLITests(unittest.TestCase):
    def run_cli(self,*args): return subprocess.run([sys.executable,'-m','scripts.manage',*args],cwd=ROOT,capture_output=True,text=True)
    def test_validate_example_and_dry_run_work_without_secrets_or_database(self):
        for command in [('validate-config',),('sync-sources','--dry-run')]:
            result=self.run_cli(*command,'--config','config/example.toml')
            self.assertEqual(result.returncode,0,result.stderr+result.stdout)
            data=json.loads(result.stdout); self.assertEqual(data['code'],0)
    def test_inspect_sources_does_not_print_business_rows_or_secrets(self):
        result=self.run_cli('inspect-sources','--config','config/example.toml')
        self.assertEqual(result.returncode,0,result.stdout)
        self.assertNotIn('not-a-real-secret',result.stdout)
        self.assertNotIn('10001',result.stdout)
        self.assertIn('表头',result.stdout)

    def test_source_wrappers_help(self):
        for source in ('marketing','qianchuan','pingan','zhongan'):
            result=subprocess.run([sys.executable,source+'.py','--help'],cwd=ROOT,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)

    def test_old_sync_routes_command_is_rejected(self):
        result=self.run_cli('sync-routes','--config','config/example.toml')
        self.assertEqual(result.returncode,2)

    def test_auth_maintenance_does_not_hold_scheduler_lock(self):
        from unittest.mock import patch
        from contextlib import contextmanager
        from live_data.cli import execute, parser
        from scripts.utils.model import Route
        names=[]
        class Database:
            @contextmanager
            def lock(self,name='scheduler'):
                names.append(name); yield
            def routes(self,credentials): return [Route('task','p','r','pingan','pingan_login',options={'channel':'DEMO'})]
            def close(self): pass
        with patch('live_data.cli.CatalogRepository.connect',return_value=Database()), \
             patch('live_data.cli.Runner.maintain',return_value={'code':0,'results':[]}):
            result=execute(parser().parse_args(['auth-maintain','--config',str(ROOT/'config/example.toml')]))
        self.assertEqual(result['code'],0)
        self.assertEqual(names,[])

    def test_sync_preview_explains_source_rows_and_business_entities(self):
        result=self.run_cli('sync-sources','--dry-run','--config','config/example.toml')
        self.assertEqual(result.returncode,0,result.stdout)
        data=json.loads(result.stdout)
        self.assertEqual(data['catalog_counts']['products'],2)
        self.assertEqual(data['catalog_counts']['rooms'],2)
        self.assertEqual(data['catalog_counts']['accounts'],3)
        self.assertEqual(data['derived_tasks'],5)
