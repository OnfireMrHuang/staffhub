import copy
import unittest
from scripts.catalog import normalize_catalog, catalog_routes
from scripts.catalog.master_data import map_tables, build_routes
from scripts.utils.model import ConfigError
from test_master_data import fixtures


class CatalogTests(unittest.TestCase):
    def test_eight_relational_entities_and_one_backend_per_room(self):
        data,cfg=fixtures(); snapshot=map_tables(data,cfg)
        catalog=normalize_catalog(snapshot)
        self.assertEqual(set(catalog),{'products','rooms','ad_platforms','policy_platforms','applications','accounts','room_accounts','room_backends'})
        self.assertEqual(len(catalog['products']),2)
        self.assertEqual(len(catalog['rooms']),2)
        self.assertEqual(len(catalog['room_accounts']),3)
        self.assertEqual(len(catalog['room_backends']),2)
        self.assertEqual({r.route_id for r in catalog_routes(catalog,cfg['credentials'])},{r.route_id for r in build_routes(snapshot,cfg['credentials'])})
        self.assertFalse(any('raw_data' in row for table in catalog.values() for row in table))

    def test_room_id_cannot_belong_to_two_products(self):
        data,cfg=fixtures(); snapshot=map_tables(data,cfg)
        snapshot['accounts'][2]['room_id']=snapshot['accounts'][0]['room_id']
        snapshot['backends'][1]['room_id']=snapshot['accounts'][0]['room_id']
        with self.assertRaises(ConfigError): normalize_catalog(snapshot)

    def test_normalization_rejects_conflicting_account_application(self):
        data,cfg=fixtures(); snapshot=map_tables(data,cfg)
        other=copy.deepcopy(snapshot['accounts'][0]); other['app_key']='unknown'
        other['room_id']='other'; snapshot['accounts'].append(other)
        with self.assertRaises(ConfigError): normalize_catalog(snapshot)

    def test_name_changes_do_not_mutate_explicit_ids(self):
        data,cfg=fixtures(); snapshot=map_tables(data,cfg)
        for row in snapshot['accounts']+snapshot['backends']:
            row['product_name']='中文产品'; row['room_name']=row['room_id']+'直播间'
        catalog=normalize_catalog(snapshot)
        self.assertEqual({p['product_id'] for p in catalog['products']},{a['product_id'] for a in snapshot['accounts']})
        self.assertTrue(all(p['name']=='中文产品' for p in catalog['products']))

    def test_workbook_catalog_has_twenty_tasks_matching_explicit_identity(self):
        from pathlib import Path
        from scripts.utils.config import Config
        from scripts.catalog.master_data import read_sources
        from scripts.registry import make_task
        root=Path(__file__).resolve().parents[1]
        cfg=Config.load(root/'config/workbook.example.toml')
        if not cfg.resolve(cfg.data['master_data']['workbook_file']).exists():
            self.skipTest('private source workbook not available')
        tables=read_sources(cfg,None)
        catalog=normalize_catalog(map_tables(tables,cfg.data))
        tasks=catalog_routes(catalog,cfg.credentials)
        self.assertEqual((len(catalog['products']),len(catalog['rooms']),len(catalog['accounts']),len(catalog['applications']),len(catalog['room_backends']),len(tasks)),(3,4,16,2,4,20))
        for task in tasks:
            options={k:v for k,v in task.options.items() if k not in ('account_name','account_type','room_name')}
            explicit=make_task(task.source,task.product_id,task.room_id,task.credential,task.account_id,options)
            self.assertEqual(explicit.route_id,task.route_id)
        self.assertEqual(sum(task.source in ('pingan','zhongan') for task in tasks),4)
