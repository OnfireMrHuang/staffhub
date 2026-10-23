"""Source-owned typed facts, idempotency, transaction and configured tables."""
from scripts.utils.database import Database, digest
from scripts.utils.columns import values
from scripts.utils.model import DataError, timestamp, parse_time
from .task import validate
from .contracts import contract, project_fields


def insert_sql(definition, table, extras, update=False):
    names=[f['name'] for f in definition['fields']]+list(extras)
    sql='INSERT INTO '+table+' ('+','.join('`'+n+'`' for n in names)+') VALUES ('+','.join(['%s']*len(names))+')'
    if update:
        sql+=' ON DUPLICATE KEY UPDATE '+','.join('`'+n+'`=VALUES(`'+n+'`)' for n in names if n!='first_seen_at')
    return sql


class Repository(Database):
    table_roles = ('stats', 'orders', 'audit')

    @staticmethod
    def lock_name(task):
        scope=validate(task)
        # Lock the whole source resource; overlapping filtered/full scopes serialize.
        return 'scope-'+digest(scope.resource)[:48]

    def write(self, task, window, batch):
        validate(task)
        if batch.ads: raise DataError('保单采集器不能写广告记录')
        stats=contract('zhongan_stats');orders=contract('zhongan_orders')
        snapshot_sql=insert_sql(stats,self.table('stats'),('observed_hour','observed_at'),update=True)
        order_sql=insert_sql(orders,self.table('orders'),('first_seen_at','observed_at'),update=True)
        hour=timestamp(parse_time(batch.observed_at).replace(minute=0,second=0,microsecond=0))
        with self.transaction() as cur:
            for row in batch.snapshots:
                record=project_fields('zhongan_stats',row['metrics'])
                cur.execute(snapshot_sql,values(stats,record)+(hour,batch.observed_at))
            for row in batch.orders:
                record=project_fields('zhongan_orders',row['payload'])
                cur.execute(order_sql,values(orders,record)+(batch.observed_at,batch.observed_at))
            self.audit(cur,task,window,0,batch.count,'采集完整')
