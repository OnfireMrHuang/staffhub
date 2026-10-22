"""Qianchuan owns hourly replacement SQL and its fact-table projection."""
from pathlib import Path

from scripts.utils.database import Database, digest, encode
from scripts.utils.model import ConfigError, StorageError, timestamp
from scripts.utils.tasks import hash_value


class Repository(Database):
    @staticmethod
    def lock_name(route):
        return 'scope-' + hash_value(['qianchuan', route.account_id])[:48]

    def init_schema(self):
        self.init_schema_files(Path(__file__).parents[1] / 'utils' / 'audit.sql',
                               Path(__file__).with_name('schema.sql'))

    def write(self, route, window, batch):
        if route.source != 'qianchuan' or batch.snapshots or batch.orders:
            raise ConfigError('千川仓储仅接受千川小时批次')
        try:
            with self.transaction() as cur:
                cur.execute('DELETE FROM live_ad_hourly WHERE route_id=%s AND stat_hour>=%s AND stat_hour<%s',
                            (route.route_id, timestamp(window.start), timestamp(window.end)))
                for row in batch.ads:
                    cur.execute(
                        'INSERT INTO live_ad_hourly '
                        '(route_id,stat_hour,dimension_hash,product_id,room_id,source,account_id,stat_cost,dimensions,metrics,observed_at) '
                        'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                        (route.route_id, row['hour'], digest(row['dimensions']), route.product_id,
                         route.room_id, 'qianchuan', route.account_id, row['cost'],
                         encode(row['dimensions']), encode(row['metrics']), batch.observed_at))
                self.audit(cur, route, window, 0, batch.count, '采集完整')
        except Exception as exc:
            raise StorageError('千川数据写入失败，事务已回滚') from exc
