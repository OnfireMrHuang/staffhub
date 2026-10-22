import unittest
from scripts.utils.database import Database
from scripts.marketing.repository import Repository as MarketingRepository
from scripts.zhongan.repository import Repository as ZhonganRepository
from scripts.catalog.repository import CatalogRepository
from scripts.utils.model import Batch, Route, Window, StorageError

class Connection:
    def __init__(self,fail=False): self.calls=[]; self.commits=0; self.rollbacks=0; self.fail=fail
    def begin(self): pass
    def cursor(self): return self
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def execute(self,sql,args=None):
        self.calls.append((sql,args))
        if self.fail and 'INSERT INTO live_ad_hourly' in sql: raise RuntimeError('db refused')
    def commit(self): self.commits+=1
    def rollback(self): self.rollbacks+=1

class StoreTests(unittest.TestCase):
    def test_complete_batch_replaces_only_requested_route_window(self):
        c=Connection(); store=MarketingRepository(c); r=Route('r','p','room','marketing','c','123',{})
        w=Window.parse('2026-10-20T09:00:00','2026-10-20T10:00:00')
        store.write(r,w,Batch())
        delete=next(x for x in c.calls if x[0].startswith('DELETE'))
        self.assertEqual(delete[1],('r','2026-10-20 09:00:00','2026-10-20 10:00:00'))
        self.assertEqual(c.commits,1)
    def test_failed_insert_rolls_back_delete_and_audit(self):
        c=Connection(fail=True); store=MarketingRepository(c)
        b=Batch(ads=[{'hour':'2026-10-20 09:00:00','dimensions':{},'metrics':{},'cost':None}])
        with self.assertRaises(StorageError): store.write(Route('r','p','room','marketing','c','1',{}),Window.parse('2026-10-20T09:00:00','2026-10-20T10:00:00'),b)
        self.assertEqual(c.rollbacks,1); self.assertEqual(c.commits,0)
    def test_policy_snapshot_uses_observation_hour_not_backfill_hour(self):
        c=Connection(); b=Batch(snapshots=[{'date':'2026-10-20','session_id':'s','grain':'session_cumulative','metrics':{'count':3}}],observed_at='2026-10-21 14:12:00')
        ZhonganRepository(c).write(Route('r','p','room','zhongan','c','',{'dy_no':'test-room'}),Window.parse('2026-10-20T09:00:00','2026-10-20T10:00:00'),b)
        sql,args=next(x for x in c.calls if 'INSERT INTO live_policy_snapshot' in x[0])
        self.assertIn('2026-10-21 14:00:00',args)
        self.assertIn('2026-10-21 14:12:00',args)

    def test_database_lock_failure_is_storage_error(self):
        class Broken(Connection):
            def execute(self,*args): raise RuntimeError('connection lost')
        with self.assertRaises(StorageError):
            with Database(Broken()).lock(): pass

    def test_named_locks_are_parameterized_and_bounded(self):
        class Named(Connection):
            def fetchone(self): return (1,)
        c=Named()
        for name in ('scheduler','catalog-import','scope-'+'x'*100):
            with Database(c).lock(name): pass
        obtains=[args[0] for sql,args in c.calls if 'GET_LOCK' in sql]
        releases=[args[0] for sql,args in c.calls if 'RELEASE_LOCK' in sql]
        self.assertEqual(obtains,releases)
        self.assertEqual(len(set(obtains)),3)
        self.assertTrue(all(len(name)<=64 for name in obtains))

    def test_catalog_read_rolls_back_instead_of_leaving_snapshot_open(self):
        class BrokenRead(Connection):
            def execute(self,sql,args=None):
                self.calls.append((sql,args))
                if 'v_live_policy_task' in sql: raise RuntimeError('read failed')
            def fetchall(self): return []
        c=BrokenRead()
        with self.assertRaises(StorageError): CatalogRepository(c).routes({})
        self.assertEqual((c.commits,c.rollbacks),(0,1))

    def test_business_directory_insert_failure_rolls_back_the_entire_publication(self):
        from scripts.catalog.master_data import map_tables
        from test_master_data import fixtures
        class BrokenCatalog(Connection):
            def execute(self,sql,args=None):
                self.calls.append((sql,args))
                if sql.startswith('INSERT INTO live_room_ad_account '): raise RuntimeError('write failed')
        data,cfg=fixtures(); c=BrokenCatalog()
        with self.assertRaises(StorageError): CatalogRepository(c).sync_sources(map_tables(data,cfg))
        self.assertTrue(any('INSERT INTO live_source_app ' in sql for sql,args in c.calls))
        self.assertTrue(any('INSERT INTO live_product ' in sql for sql,args in c.calls))
        self.assertEqual((c.commits,c.rollbacks),(0,1))
