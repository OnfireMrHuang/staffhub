"""Atomic marketing hourly storage; no catalog or scheduler dependency."""
from pathlib import Path

from scripts.utils.database import Database, digest, encode
from scripts.utils.model import ConfigError, StorageError, timestamp
from scripts.utils.tasks import hash_value


class Repository(Database):
    @staticmethod
    def lock_name(route):
        return 'scope-' + hash_value(['marketing', route.account_id])[:48]

    def init_schema(self):
        self.init_schema_files(Path(__file__).parents[1] / 'utils/audit.sql',
                               Path(__file__).with_name('schema.sql'))

    def write(self, route, window, batch):
        if route.source != 'marketing' or batch.snapshots or batch.orders:
            raise ConfigError('营销仓储仅接受营销小时批次')
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
                         route.room_id, 'marketing', route.account_id, row['cost'],
                         encode(row['dimensions']), encode(row['metrics']), batch.observed_at))
                self.audit(cur, route, window, 0, batch.count, '采集完整')
        except Exception as exc:
            raise StorageError('营销数据入库失败，本任务事务已回滚') from exc
