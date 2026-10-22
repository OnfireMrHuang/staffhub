"""pingan policy fact writes, idempotency and schema ownership."""
from pathlib import Path
from scripts.utils.database import Database, encode, digest
from scripts.utils.model import DataError, timestamp, parse_time
from scripts.utils.tasks import hash_value
from .task import validate


class Repository(Database):
    @staticmethod
    def lock_name(route):
        validate(route)
        return 'scope-' + hash_value(['pingan', route.options['channel'].strip()])[:48]

    def init_schema(self):
        self.init_schema_files(Path(__file__).resolve().parents[1] / 'utils/audit.sql',
                               Path(__file__).with_name('schema.sql'))

    def write(self, route, window, batch):
        validate(route)
        if batch.ads:
            raise DataError('保单采集器不能写入广告指标')
        with self.transaction() as cur:
            for row in batch.snapshots:
                cur.execute('INSERT INTO live_policy_snapshot (route_id,source_date,session_hash,observed_hour,session_id,product_id,room_id,source,grain,metrics,observed_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE metrics=VALUES(metrics),observed_at=VALUES(observed_at)',
                            (route.route_id, row['date'], digest(row['session_id']),
                             timestamp(parse_time(batch.observed_at).replace(minute=0, second=0, microsecond=0)),
                             row['session_id'], route.product_id, route.room_id, 'pingan', row['grain'],
                             encode(row['metrics']), batch.observed_at))
            for row in batch.orders:
                cur.execute('INSERT INTO live_policy_order (route_id,order_hash,order_id,session_id,source_date,product_id,room_id,source,payload,first_seen_at,observed_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE session_id=VALUES(session_id),source_date=VALUES(source_date),payload=VALUES(payload),observed_at=VALUES(observed_at)',
                            (route.route_id, digest(row['order_id']), row['order_id'], row['session_id'], row['date'],
                             route.product_id, route.room_id, 'pingan', encode(row['payload']),
                             batch.observed_at, batch.observed_at))
            self.audit(cur, route, window, 0, batch.count, '采集完整')
