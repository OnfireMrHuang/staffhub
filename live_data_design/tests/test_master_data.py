import copy
import json
import unittest
from pathlib import Path
from scripts.catalog.master_data import map_tables, build_routes, FeishuReader
from scripts.utils.model import ConfigError, DataError
import httpx

ROOT=Path(__file__).resolve().parents[1]

def fixtures():
    import tomllib
    config=tomllib.loads((ROOT/'config/example.toml').read_text())
    data=json.loads((ROOT/'config/master.example.json').read_text())
    return data,config

class MasterDataTests(unittest.TestCase):
    def test_source_tables_join_one_policy_per_room_and_no_user_route_id(self):
        data,cfg=fixtures(); snapshot=map_tables(data,cfg)
        routes=build_routes(snapshot,cfg['credentials'])
        self.assertEqual(sorted(r.source for r in routes),['marketing','marketing','pingan','qianchuan','zhongan'])
        self.assertEqual(len({r.route_id for r in routes}),5)
        self.assertTrue(all(r.route_id.startswith('task-') for r in routes))
        self.assertNotIn('routes',cfg)
        self.assertNotIn('not-a-real-secret',json.dumps(snapshot))

    def test_missing_app_and_backend_abort_instead_of_guessing(self):
        for target in ('applications','backends'):
            data,cfg=fixtures(); data[target]['values']=data[target]['values'][:1]
            with self.assertRaises(ConfigError): map_tables(data,cfg)

    def test_ambiguous_app_without_foreign_key_rejected(self):
        data,cfg=fixtures()
        # Same platform, different app, no explicit app column on accounts.
        del cfg['master_data']['tables']['accounts']['columns']['app_id']
        data['applications']['values'].append(['999','巨量营销','not-a-real-secret'])
        cfg['master_data']['application_credentials']['marketing:999']='marketing_app'
        with self.assertRaises(ConfigError): map_tables(data,cfg)

    def test_record_reorder_and_credential_rotation_do_not_change_identity(self):
        data,cfg=fixtures(); before=build_routes(map_tables(data,cfg),cfg['credentials'])
        data['accounts']['values'][1:]=list(reversed(data['accounts']['values'][1:]))
        cfg['credentials']['new_marketing']=cfg['credentials']['marketing_app']
        cfg['master_data']['application_credentials']['marketing:100']='new_marketing'
        after=build_routes(map_tables(data,cfg),cfg['credentials'])
        self.assertEqual({r.route_id for r in before},{r.route_id for r in after})

    def test_missing_or_duplicate_headers_fail_closed(self):
        for headers in [['not-the-product-column'],['产品','产品']]:
            data,cfg=fixtures(); data['accounts']['values'][0]=headers
            with self.assertRaises(ConfigError): map_tables(data,cfg)

    def test_feishu_revision_changes_abort_complete_fetch(self):
        calls=[]
        def handler(request):
            calls.append(request)
            if request.url.path.endswith('/sheets/query'):
                return httpx.Response(200,json={'code':0,'data':{'sheets':[{'sheet_id':'a','title':'accounts','grid_properties':{'row_count':3,'column_count':2}}]}})
            count=sum('/values/' in r.url.path for r in calls)
            return httpx.Response(200,json={'code':0,'data':{'revision':1 if count==1 else 2,'spreadsheetToken':'book','valueRange':{'majorDimension':'ROWS','range':request.url.path.split('/values/')[1],'values':[['product','room']]}}})
        reader=FeishuReader('book','secret',httpx.Client(transport=httpx.MockTransport(handler)))
        with self.assertRaises(DataError): reader.read({'accounts':{'title':'accounts'}},chunk_size=2)

class SourceStorageTests(unittest.TestCase):
    def test_sync_failure_rolls_back_all_three_source_tables(self):
        from scripts.catalog.repository import CatalogRepository as Store
        from scripts.utils.model import StorageError
        class Database:
            commits=0
            rollbacks=0
            def begin(self): pass
            def cursor(self): return self
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def execute(self,sql,args=None):
                if sql.startswith('INSERT INTO live_source_backend'): raise RuntimeError('write failed')
            def commit(self): self.commits+=1
            def rollback(self): self.rollbacks+=1
        data,cfg=fixtures(); db=Database()
        with self.assertRaises(StorageError): Store(db).sync_sources(map_tables(data,cfg))
        self.assertEqual(db.commits,0)
        self.assertEqual(db.rollbacks,1)

    def test_runtime_reads_two_task_views_in_one_consistent_snapshot(self):
        from scripts.catalog.repository import CatalogRepository as Store
        data,cfg=fixtures(); tasks=build_routes(map_tables(data,cfg),cfg['credentials'])
        class Database:
            def __init__(self): self.calls=[]; self.commits=0
            def cursor(self): return self
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def execute(self,sql,args=None): self.calls.append(sql)
            def fetchall(self):
                if 'v_live_ad_task' in self.calls[-1]:
                    return [(t.product_id,t.room_id,t.source,t.credential,t.account_id,json.dumps({k:v for k,v in t.options.items() if k in ('account_scope','aweme_id')}),t.options.get('version',''),t.options['expected_app_id'],t.options['account_name'],t.options['account_type'],t.options['room_name']) for t in tasks if t.source in ('marketing','qianchuan')]
                return [(t.product_id,t.room_id,t.source,t.credential,t.options.get('channel',t.options.get('dy_no')),t.options.get('platform','DOUYIN'),t.options['room_name']) for t in tasks if t.source in ('pingan','zhongan')]
            def commit(self): self.commits+=1
            def rollback(self): pass
        db=Database(); routes=Store(db).routes(cfg['credentials'])
        self.assertEqual({t.route_id for t in routes},{t.route_id for t in tasks})
        self.assertIn('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',db.calls)
        self.assertIn('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',db.calls)
        self.assertFalse(any('live_source_' in s or 'live_route' in s for s in db.calls))
        self.assertEqual(db.commits,1)

    def test_sync_publishes_all_eight_entities_with_source_mirrors(self):
        from scripts.catalog.repository import CatalogRepository as Store
        from scripts.catalog import CATALOG_TABLES
        data,cfg=fixtures()
        class Database:
            def __init__(self): self.calls=[]; self.commits=0
            def begin(self): pass
            def cursor(self): return self
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def execute(self,sql,args=None): self.calls.append(sql)
            def commit(self): self.commits+=1
            def rollback(self): pass
        db=Database(); Store(db).sync_sources(map_tables(data,cfg))
        for table,_ in CATALOG_TABLES.values():
            self.assertTrue(any(s.startswith('INSERT INTO '+table+' ') for s in db.calls),table)
        self.assertEqual(db.commits,1)

class MasterIdentityTests(unittest.TestCase):
    def test_two_applications_cannot_share_one_env_credential_alias(self):
        data,cfg=fixtures()
        data['applications']['values'].append(['999','巨量营销','not-a-real-secret'])
        cfg['master_data']['application_credentials']['marketing:999']='marketing_app'
        with self.assertRaises(ConfigError): map_tables(data,cfg)

    def test_derived_ad_task_carries_expected_app_id(self):
        data,cfg=fixtures(); tasks=build_routes(map_tables(data,cfg),cfg['credentials'])
        self.assertEqual(next(r for r in tasks if r.source=='marketing').options['expected_app_id'],'100')

class SourceIntegrityTests(unittest.TestCase):
    def test_wrong_workbook_range_or_dimension_rejected(self):
        base={'spreadsheetToken':'book','revision':1,'valueRange':{
            'majorDimension':'ROWS','range':'a!A1:B4','values':[['product','room'],['p','r']]}}
        for change in ('range','sheet','book','dimension','wide','missing_range'):
            data=copy.deepcopy(base)
            if change=='range': data['valueRange']['range']='a!A1:B3'
            elif change=='sheet': data['valueRange']['range']='b!A1:B4'
            elif change=='book': data['spreadsheetToken']='other'
            elif change=='dimension': data['valueRange']['majorDimension']='COLUMNS'
            elif change=='wide': data['valueRange']['values']=[['a','b','c']]
            else: del data['valueRange']['range']
            with self.subTest(change=change):
                client=httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'code':0,'data':data})))
                with self.assertRaises(DataError): FeishuReader('book','secret',client).values('a',1,4,2)

    def test_full_range_allows_trailing_empty_rows(self):
        data={'spreadsheetToken':'book','revision':1,'valueRange':{
            'majorDimension':'ROWS','range':'a!A1:B4','values':[['p','r']]}}
        client=httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(200,json={'code':0,'data':data})))
        self.assertEqual(FeishuReader('book','secret',client).values('a',1,4,2),([['p','r']],'1'))

    def test_lock_preserves_source_error_classification(self):
        from scripts.catalog.repository import CatalogRepository as Store
        from scripts.utils.model import AuthError
        class Database:
            def cursor(self): return self
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def execute(self,*args): pass
            def fetchone(self): return (1,)
            def commit(self): pass
        for error in (DataError('changed revision'),AuthError('expired token')):
            with self.assertRaises(type(error)):
                with Store(Database()).lock(): raise error

class AppForeignKeyTests(unittest.TestCase):
    def test_mapped_app_id_cannot_be_blank(self):
        data,cfg=fixtures()
        data['accounts']['values'][1][-1]=''
        with self.assertRaises(ConfigError): map_tables(data,cfg)

    def test_unmapped_app_column_can_use_unique_platform_application(self):
        data,cfg=fixtures()
        del cfg['master_data']['tables']['accounts']['columns']['app_id']
        self.assertEqual(len(map_tables(data,cfg)['accounts']),3)

class FeishuSnapshotTests(unittest.TestCase):
    def test_complete_paginated_workbook_generates_tasks(self):
        data,cfg=fixtures()
        by_id={t['sheet_id']:t for t in data.values()}
        sheets=[{'sheet_id':t['sheet_id'],'title':t['title'],'grid_properties':{
            'row_count':len(t['values'])+3,'column_count':len(t['values'][0])}} for t in data.values()]
        def handler(request):
            if request.url.path.endswith('/sheets/query'):
                return httpx.Response(200,json={'code':0,'data':{'sheets':sheets}})
            ref=request.url.path.split('/values/')[1]
            sid,span=ref.split('!')
            import re
            match=re.fullmatch(r'A(\d+):[A-Z]+(\d+)',span)
            start,end=map(int,match.groups())
            return httpx.Response(200,json={'code':0,'data':{'spreadsheetToken':'book','revision':9,
                'valueRange':{'range':ref,'majorDimension':'ROWS','values':by_id[sid]['values'][start-1:end]}}})
        client=httpx.Client(transport=httpx.MockTransport(handler))
        result=FeishuReader('book','secret',client).read(cfg['master_data']['tables'],chunk_size=2)
        snapshot=map_tables(result,cfg)
        self.assertEqual(len(build_routes(snapshot,cfg['credentials'])),5)
        self.assertEqual([r['source_row'] for r in snapshot['accounts']],[2,3,4])

class SourceProvenanceTests(unittest.TestCase):
    def test_explicit_source_row_positions_must_cover_every_input_row(self):
        data,cfg=fixtures()
        data['accounts']['row_numbers']=[2]
        with self.assertRaises(ConfigError): map_tables(data,cfg)
