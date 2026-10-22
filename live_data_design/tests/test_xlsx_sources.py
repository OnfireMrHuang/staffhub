import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from xml.sax.saxutils import escape
from zipfile import ZipFile

from scripts.utils.model import ConfigError
from scripts.catalog.xlsx_sources import read_workbook

ROOT = Path(__file__).resolve().parents[1]


def workbook(path, accounts=None, merges=None, backend_url=None):
    """Synthetic source layout; no production credentials in tests."""
    accounts = accounts or [
        ['保险产品', '直播间', '保费看板地址', '账户ID', '账户名称', '账户类型', '账户平台'],
        ['产品A', '房间A', 'https://open.health.pingan.com/v2/home?merchantChannel=PA-DEMO', '123', '账户A', '直投', '巨量营销-智擎版'],
        ['', '', '', '124', '账户B', '视频', '巨量营销-智擎版'],
        ['', '', '', '', '', '', '   '],
    ]
    apps = [['巨量营销应用（仅数报表权限）', 'app_id', '100'], ['', 'secret', 'forbidden-secret'], ['', 'token示例', 'forbidden-token']]
    backends = [['组名可以不同', '看板地址', backend_url or 'https://open.health.pingan.com/v2/home?merchantChannel=PA-DEMO'], ['', '看板密码', 'forbidden-password'], ['', '登录手机号', 'forbidden-phone']]
    names = ['产品账户信息', '巨量引擎应用信息', '产品统计后台信息']
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    with ZipFile(path, 'w') as z:
        z.writestr('xl/workbook.xml', '<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i,name in enumerate(names,1))+'</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{i}" Target="worksheets/sheet{i}.xml"/>' for i in range(1,4))+'</Relationships>')
        for i, rows in enumerate((accounts,apps,backends),1):
            regions = (['A2:A3','B2:B3','C2:C3'] if merges is None else merges) if i==1 else ['A1:A3']
            body=''.join('<row r="'+str(r)+'">'+''.join(f'<c r="{chr(65+c)}{r}" t="inlineStr"><is><t>{escape(str(v))}</t></is></c>' for c,v in enumerate(row))+'</row>' for r,row in enumerate(rows,1))
            z.writestr(f'xl/worksheets/sheet{i}.xml',f'<worksheet xmlns="{ns}"><sheetData>{body}</sheetData><mergeCells>'+''.join(f'<mergeCell ref="{m}"/>' for m in regions)+'</mergeCells></worksheet>')


class WorkbookTests(unittest.TestCase):
    def test_real_merges_and_vertical_groups_without_secret_values(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a.xlsx'; workbook(p)
            tables=read_workbook(p,{})
        self.assertEqual(len(tables['accounts']['values']),3)
        rows=[dict(zip(tables['accounts']['values'][0],r)) for r in tables['accounts']['values'][1:]]
        self.assertEqual(rows[0]['room_id'],rows[1]['room_id'])
        self.assertTrue(all(r['account_scope'] for r in rows))
        self.assertEqual(rows[0]['product_name'],'产品A')
        self.assertEqual(len(tables['backends']['values']),2)
        self.assertNotIn('forbidden',json.dumps(tables))
        self.assertEqual(len({t['revision'] for t in tables.values()}),1)

    def test_ordinary_blank_not_forward_filled(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a.xlsx'; workbook(p,merges=[])
            with self.assertRaises(ConfigError): read_workbook(p,{})

    def test_backend_identity_requires_supported_host_and_exact_selector(self):
        for url in ('https://evil.example/?merchantChannel=PA-DEMO','https://open.health.pingan.com/v2/home?merchantChannel=OTHER','https://open.health.pingan.com/v2/home?merchantChannel=PA-DEMO&merchantChannel=OTHER'):
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/'a.xlsx'; workbook(p,backend_url=url)
                with self.assertRaises(ConfigError): read_workbook(p,{})

    def test_shared_account_without_explicit_room_filters_rejected(self):
        rows=[['保险产品','直播间','保费看板地址','账户ID','账户名称','账户类型','账户平台'],
              ['产品A','房间A','https://open.health.pingan.com/v2/home?merchantChannel=PA-DEMO','123','账户A','直投','巨量营销-智擎版'],
              ['产品A','房间B','https://open.health.pingan.com/v2/home?merchantChannel=PA-DEMO','123','账户A','直投','巨量营销-智擎版']]
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a.xlsx'; workbook(p,accounts=rows,merges=[])
            with self.assertRaises(ConfigError): read_workbook(p,{})

    def test_present_but_blank_app_id_is_not_inferred(self):
        rows=[['保险产品','直播间','保费看板地址','账户ID','账户名称','账户类型','账户平台','应用ID'],
              ['产品A','房间A','https://open.health.pingan.com/v2/home?merchantChannel=PA-DEMO','123','账户A','直投','巨量营销-智擎版','']]
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a.xlsx'; workbook(p,accounts=rows,merges=[])
            with self.assertRaises(ConfigError): read_workbook(p,{})

    def test_real_workbook_read_only_counts_and_account_scope(self):
        path=ROOT/'第一期试点直播间产品.xlsx'
        if not path.exists(): self.skipTest('source workbook not available')
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        tables=read_workbook(path,{})
        accounts=[dict(zip(tables['accounts']['values'][0],r)) for r in tables['accounts']['values'][1:]]
        self.assertEqual((len(accounts),len({r['product_id'] for r in accounts}),len({r['room_id'] for r in accounts})),(16,3,4))
        self.assertEqual((len(tables['applications']['values'])-1,len(tables['backends']['values'])-1),(2,4))
        self.assertTrue(all(r['account_scope'] and not r.get('aweme_id') for r in accounts))
        self.assertEqual(before,hashlib.sha256(path.read_bytes()).hexdigest())
