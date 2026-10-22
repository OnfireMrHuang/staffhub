"""Architecture regressions: source packages must work without the scheduler."""
import ast
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('marketing', 'qianchuan', 'pingan', 'zhongan')


class ModuleBoundaryTests(unittest.TestCase):
    def test_sources_never_import_scheduler(self):
        offenders = []
        for path in (ROOT.parent / 'scripts').rglob('*.py'):
            if any(part in ('.venv','build') for part in path.parts): continue
            for node in ast.walk(ast.parse(path.read_text())):
                names = [a.name for a in node.names] if isinstance(node, ast.Import) else (
                    [node.module or ''] if isinstance(node, ast.ImportFrom) else [])
                if any(n == 'live_data' or n.startswith('live_data.') for n in names):
                    offenders.append(str(path.relative_to(ROOT.parent)))
        self.assertEqual(offenders, [])

    def test_scheduler_contains_only_orchestration_modules(self):
        allowed = {'__init__.py', '__main__.py', 'cli.py', 'runner.py', 'dispatch.py'}
        actual = {p.name for p in (ROOT / 'live_data').rglob('*.py')}
        self.assertLessEqual(actual, allowed)

    def test_source_types_and_fact_writes_belong_to_each_package(self):
        from registry import get
        for source in SOURCES:
            with self.subTest(source=source):
                module = get(source)
                for name in ('Auth', 'Collector', 'Repository'):
                    self.assertEqual(getattr(module, name).__module__.rsplit('.', 1)[0], 'scripts.' + source)
                tree = ast.parse((ROOT.parent / 'scripts' / source / 'repository.py').read_text())
                write = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'write')
                self.assertTrue(any(isinstance(n, ast.Constant) and isinstance(n.value, str)
                    and 'INSERT INTO `' in n.value for n in ast.walk(tree)))

    def test_each_source_runs_with_live_data_imports_blocked(self):
        flags = {
            'marketing': ['--advertise-id', '123'],
            'qianchuan': ['--advertise-id', '456'],
            'pingan': ['--channel', 'demo'], 'zhongan': ['--dy-no', 'demo'],
        }
        creds = {'marketing': 'marketing_app', 'qianchuan': 'qianchuan_app',
                 'pingan': 'pingan_login', 'zhongan': 'zhongan_login'}
        for source in SOURCES:
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                args = ['collect', '--config', str(ROOT / 'config/example.toml'), '--credential', creds[source], '--dry-run', *flags[source]]
                program = '''import importlib.abc,sys
class BlockScheduler(importlib.abc.MetaPathFinder):
 def find_spec(self, fullname, path=None, target=None):
  if fullname == "live_data" or fullname.startswith("live_data."):
   raise AssertionError("source depends on scheduler")
sys.meta_path.insert(0, BlockScheduler())
sys.path.insert(0, sys.argv[1])
from importlib import import_module
module = import_module("scripts." + sys.argv[2] + ".cli")
raise SystemExit(module.main(sys.argv[3:]))
'''
                run = subprocess.run([sys.executable, '-c', program, str(ROOT), source, *args],
                                     cwd=directory, text=True, capture_output=True)
                self.assertEqual(run.returncode, 0, run.stderr + run.stdout)
                self.assertTrue(json.loads(run.stdout)['dry_run'])

    def test_utils_has_no_dependency_on_source_modules_or_registry(self):
        for path in (ROOT.parent / 'scripts/utils').glob('*.py'):
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node, ast.ImportFrom):
                    name = node.module or ''
                    self.assertFalse(any(name.startswith('scripts.' + src) for src in SOURCES), path)
                    self.assertNotIn('registry', name, path)
