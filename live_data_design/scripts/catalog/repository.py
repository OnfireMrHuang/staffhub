"""SQL for source mirrors, business catalog and consistent task reads only."""
import json
from pathlib import Path

from scripts.utils.database import Database, encode
from scripts.utils.model import ConfigError, StorageError
from .entities import CATALOG_TABLES, normalize_catalog
from .validation import validate_routes


class CatalogRepository(Database):
    def init_schema(self):
        self.apply_schema(Path(__file__).with_name('schema.sql'))

    def routes(self, credentials):
        """Both task views must observe one fully committed catalog version."""
        from scripts.registry import make_task
        try:
            with self.connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
                cursor.execute('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
                cursor.execute('SELECT product_id,room_id,source,credential,advertiser_id,scope_json,'
                               'version,app_id,account_name,account_type,room_name FROM v_live_ad_task '
                               'ORDER BY product_id,room_id,source,advertiser_id')
                ads = cursor.fetchall()
                cursor.execute('SELECT product_id,room_id,source,credential,selector,platform,room_name '
                               'FROM v_live_policy_task ORDER BY product_id,room_id,source')
                policies = cursor.fetchall()
            routes = []
            for product, room, source, credential, account, scope, version, app_id, account_name, account_type, room_name in ads:
                options = json.loads(scope) if isinstance(scope, (str, bytes)) else dict(scope)
                if source == 'marketing': options['version'] = version
                options.update(expected_app_id=app_id, account_name=account_name,
                               account_type=account_type, room_name=room_name)
                routes.append(make_task(source, product, room, credential, account, options))
            for product, room, source, credential, selector, platform, room_name in policies:
                options = {'channel': selector} if source == 'pingan' else {'dy_no': selector, 'platform': platform}
                options['room_name'] = room_name
                routes.append(make_task(source, product, room, credential, options=options))
            ad_rooms = {(r.product_id, r.room_id) for r in routes if r.source in ('marketing', 'qianchuan')}
            policy_rooms = {(r.product_id, r.room_id) for r in routes if r.source in ('pingan', 'zhongan')}
            if ad_rooms != policy_rooms:
                raise ConfigError('业务目录的启用账户和保单后台关联不完整')
            validate_routes(routes, credentials)
            self.connection.commit()
            return sorted(routes, key=lambda r: (r.product_id, r.room_id,
                                                r.source not in ('marketing', 'qianchuan'),
                                                r.source, r.account_id, r.route_id))
        except ConfigError:
            self.connection.rollback()
            raise
        except Exception as exc:
            self.connection.rollback()
            raise StorageError('读取业务目录失败，请先 init-db 和 sync-sources') from exc

    def sync_sources(self, snapshot):
        """Publish all mirrors and relational entities as a single atomic catalog."""
        catalog = normalize_catalog(snapshot)
        try:
            with self.transaction() as cursor:
                for table, _ in reversed(list(CATALOG_TABLES.values())):
                    cursor.execute('DELETE FROM ' + table)
                for table in ('live_source_account', 'live_source_backend', 'live_source_app'):
                    cursor.execute('DELETE FROM ' + table)
                for row in snapshot['applications']:
                    cursor.execute('INSERT INTO live_source_app (row_key,app_id,source,enabled,record_json) '
                                   'VALUES (%s,%s,%s,%s,%s)',
                                   (row['row_key'], row['app_id'], row['source'], row['enabled'], encode(row)))
                for row in snapshot['accounts']:
                    cursor.execute('INSERT INTO live_source_account (row_key,product_id,room_id,app_key,enabled,record_json) '
                                   'VALUES (%s,%s,%s,%s,%s,%s)',
                                   (row['row_key'], row['product_id'], row['room_id'], row['app_key'], row['enabled'], encode(row)))
                for row in snapshot['backends']:
                    cursor.execute('INSERT INTO live_source_backend (row_key,product_id,room_id,enabled,record_json) '
                                   'VALUES (%s,%s,%s,%s,%s)',
                                   (row['row_key'], row['product_id'], row['room_id'], row['enabled'], encode(row)))
                for name, (table, columns) in CATALOG_TABLES.items():
                    statement = ('INSERT INTO ' + table + ' (' + ','.join(columns) + ') VALUES ('
                                 + ','.join(['%s'] * len(columns)) + ')')
                    for row in catalog[name]:
                        cursor.execute(statement, tuple(encode(row[c]) if c == 'scope_json' else row[c] for c in columns))
        except Exception as exc:
            raise StorageError('原表和业务目录同步失败，整个发布事务已回滚') from exc
