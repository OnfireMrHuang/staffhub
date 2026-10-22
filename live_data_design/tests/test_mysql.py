"""Opt in only against an isolated, disposable MySQL schema; never the production DSN."""
import json
import os
import unittest
import uuid
from scripts.utils.model import Batch, Task as Route, Window, StorageError
from scripts.utils.database import Database
from catalog.repository import CatalogRepository
import registry

@unittest.skipUnless(os.getenv('LIVE_TEST_MYSQL_SOCKET'),'set LIVE_TEST_MYSQL_SOCKET for an isolated MySQL instance')
class MySQLTests(unittest.TestCase):
    def setUp(self):
        import pymysql
        self.db='live_test_'+uuid.uuid4().hex
        self.conn=pymysql.connect(unix_socket=os.environ['LIVE_TEST_MYSQL_SOCKET'],user='root',charset='utf8mb4',autocommit=True)
        with self.conn.cursor() as c:
            c.execute('CREATE DATABASE '+self.db)
            c.execute('USE '+self.db)
        self.conn.autocommit(False)
        self.database=Database(self.conn)
        self.catalog=CatalogRepository(self.conn); self.catalog.init_schema()
        self.repositories={source:registry.get(source).Repository(self.conn)
                           for source in ('marketing','qianchuan','pingan','zhongan')}
        for repository in self.repositories.values(): repository.init_schema()
        self.r=Route('r','marketing','m','123',{'account_scope':True})
        self.w=Window.parse('2026-10-20T09:00:00','2026-10-20T10:00:00')
    def tearDown(self):
        self.conn.rollback()
        with self.conn.cursor() as c: c.execute('DROP DATABASE '+self.db)
        self.conn.close()
    def rows(self,table):
        with self.conn.cursor() as c: c.execute('SELECT * FROM '+table); return c.fetchall()
    def test_real_mysql_rerun_updates_and_failed_insert_restores_prior_data(self):
        row={'hour':'2026-10-20 09:00:00','dimensions':{'stat_time_hour':'2026-10-20 09:00:00'},
             'metrics':{'stat_cost':'1.25','_collection':{'context':{'advertiser_id':'123'}}},'cost':'1.25'}
        b=Batch(ads=[row])
        self.repositories['marketing'].write(self.r,self.w,b)
        self.repositories['marketing'].write(self.r,self.w,b)
        self.assertEqual(len(self.rows('marketing_hourly')),1)
        # Two identical dimension keys cause a real unique constraint failure after DELETE.
        with self.assertRaises(StorageError):
            self.repositories['marketing'].write(self.r,self.w,Batch(ads=[row,row]))
        with self.conn.cursor() as c:
            c.execute('SELECT stat_cost FROM marketing_hourly')
            from decimal import Decimal
            self.assertEqual(c.fetchone()[0],Decimal('1.25'))
        self.assertEqual(len(self.rows('collector_run')),2)
        self.repositories['marketing'].write(self.r,self.w,Batch())
        self.assertEqual(self.rows('marketing_hourly'),())

    def test_real_mysql_policy_upsert_preserves_first_seen_and_actual_snapshot_hour(self):
        r=Route('policy','zhongan','z','',{'dy_no':'abc'})
        context={'livePlatform':'DOUYIN','dyNo':'abc','roomId':'s','startDate':'2026-10-20'}
        b=Batch(snapshots=[{'metrics':{'cost':'1','_collection':{'context':context}}}],
                orders=[{'payload':{'orderNo':'000000123456789012345','orderStatus':'1',
                                    '_collection':{'context':context}}}],observed_at='2026-10-21 14:05:00')
        self.repositories['zhongan'].write(r,self.w,b)
        b.observed_at='2026-10-21 14:45:00'; b.orders[0]['payload']['orderStatus']='2'
        self.repositories['zhongan'].write(r,self.w,b)
        with self.conn.cursor() as c:
            c.execute('SELECT observed_hour FROM zhongan_stats')
            rows=c.fetchall(); self.assertEqual(len(rows),1)
            self.assertEqual(str(rows[0][0]),'2026-10-21 14:00:00')
            c.execute('SELECT orderNo,first_seen_at,orderStatus FROM zhongan_orders')
            rows=c.fetchall(); self.assertEqual(len(rows),1)
            self.assertEqual(rows[0][0],'000000123456789012345')
            self.assertEqual(str(rows[0][1]),'2026-10-21 14:05:00')
            self.assertEqual(rows[0][2],'2')

    def test_advisory_lock_excludes_another_connection(self):
        import pymysql
        from scripts.utils.model import BusyError
        other=Database(pymysql.connect(unix_socket=os.environ['LIVE_TEST_MYSQL_SOCKET'],user='root',database=self.db))
        try:
            with self.database.lock():
                with other.lock('catalog-import'): pass
                with self.assertRaises(BusyError):
                    with other.lock(): pass
        finally: other.close()

    def test_real_source_mirrors_join_and_full_snapshot_replacement(self):
        from test_master_data import fixtures
        from catalog.master_data import map_tables
        data,cfg=fixtures()
        snapshot=map_tables(data,cfg)
        self.catalog.sync_sources(snapshot)
        self.assertEqual(len(self.catalog.routes(cfg['credentials'])),5)
        self.assertEqual(len(self.rows('live_product')),2)
        self.assertEqual(len(self.rows('live_room')),2)
        self.assertEqual(len(self.rows('live_ad_account')),3)
        self.assertEqual(len(self.rows('live_room_policy_backend')),2)
        self.assertEqual(len(self.rows('v_live_room_sources')),3)
        # Source row removal deactivates that task, while business history is untouched.
        data['accounts']['values'].pop(2)
        self.catalog.sync_sources(map_tables(data,cfg))
        self.assertEqual(len(self.catalog.routes(cfg['credentials'])),4)
        self.assertEqual(len(self.rows('live_source_account')),2)

    def test_catalog_reads_consistent_generation_during_concurrent_publish(self):
        import pymysql
        from test_master_data import fixtures
        from catalog.master_data import map_tables
        data,cfg=fixtures(); self.catalog.sync_sources(map_tables(data,cfg))
        # Remove the second product and room from the next published generation.
        data['accounts']['values'].pop(3)
        data['backends']['values'].pop(2)
        replacement=map_tables(data,cfg)
        writer=CatalogRepository(pymysql.connect(unix_socket=os.environ['LIVE_TEST_MYSQL_SOCKET'],user='root',database=self.db,autocommit=False,charset='utf8mb4'))
        connection=self.conn
        class Cursor:
            def __init__(self): self.inner=connection.cursor(); self.sql=''
            def __enter__(self): self.inner.__enter__(); return self
            def __exit__(self,*args): return self.inner.__exit__(*args)
            def execute(self,sql,args=None): self.sql=sql; return self.inner.execute(sql,args)
            def fetchall(self):
                rows=self.inner.fetchall()
                if 'v_live_ad_task' in self.sql: writer.sync_sources(replacement)
                return rows
        class Reader:
            def cursor(self): return Cursor()
            def commit(self): connection.commit()
            def rollback(self): connection.rollback()
        try:
            # The first view was already read when another connection publishes.
            self.assertEqual(len(CatalogRepository(Reader()).routes(cfg['credentials'])),5)
            self.assertEqual(len(self.catalog.routes(cfg['credentials'])),3)
        finally: writer.close()
