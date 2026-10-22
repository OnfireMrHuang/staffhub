"""Source-owned typed facts, idempotency, transaction and DDL."""
from pathlib import Path
from scripts.utils.database import Database, digest
from scripts.utils.columns import values
from scripts.utils.model import DataError, timestamp
from .task import validate
from .contracts import contract, project_fields
from scripts.utils import database


def insert_sql(definition, extras, update=False):
    names=[f['name'] for f in definition['fields']]+list(extras)
    sql='INSERT INTO `'+definition['table']+'` ('+','.join('`'+n+'`' for n in names)+') VALUES ('+','.join(['%s']*len(names))+')'
    if update:
        sql+=' ON DUPLICATE KEY UPDATE '+','.join('`'+n+'`=VALUES(`'+n+'`)' for n in names if n!='first_seen_at')
    return sql


class Repository(Database):
    @staticmethod
    def lock_name(task):
        scope=validate(task)
        # Lock the whole source resource; overlapping filtered/full scopes serialize.
        return 'scope-'+digest(scope.resource)[:48]

    def init_schema(self):
        self.init_schema_files(Path(database.__file__).with_name('audit.sql'),Path(__file__).with_name('schema.sql'))

    def write(self, task, window, batch):
        validate(task)
        if batch.snapshots or batch.orders: raise DataError('广告采集器不能写保单记录')
        definition=contract()
        statement=insert_sql(definition,('observed_at',))
        aweme_id=getattr(batch,'aweme_id',None)
        if task.options.get('account_scope'):
            if aweme_id not in (None,''): raise DataError('账户全量批次不能包含主播筛选')
            aweme_id=''
        else:
            if not isinstance(aweme_id,str) or not aweme_id.isascii() or not aweme_id.isdigit() or int(aweme_id)<=0:
                raise DataError('千川批次缺少已解析的主播内部 ID')
            if aweme_id != str(int(aweme_id)):
                raise DataError('千川主播内部 ID 未规范化')
            ids=task.options.get('aweme_ids')
            if ids and aweme_id != str(int(ids[0])): raise DataError('写入主播与任务不一致')
        records=[]
        hours=set()
        for row in batch.ads:
            record=project_fields({'dimensions':row['dimensions'],'metrics':row['metrics']})
            if record['advertiser_id'] != task.account_id:
                raise DataError('写入账户与任务不一致')
            if (record['aweme_id'] or '') != aweme_id:
                raise DataError('写入主播与批次不一致')
            record['aweme_id']=aweme_id
            hour=record['stat_datetime']
            if not window.contains(hour): raise DataError('写入小时超出任务窗口')
            if hour in hours: raise DataError('千川账户主播小时记录重复')
            hours.add(hour)
            records.append(values(definition,record)+(batch.observed_at,))
        with self.transaction() as cur:
            cur.execute('DELETE FROM `qianchuan_stats` WHERE `advertiser_id`=%s AND `aweme_id`=%s AND `stat_datetime` >= %s AND `stat_datetime` < %s',
                        (task.account_id,aweme_id,timestamp(window.start),timestamp(window.end)))
            for record in records:
                cur.execute(statement,record)
            self.audit(cur,task,window,0,batch.count,'采集完整')
