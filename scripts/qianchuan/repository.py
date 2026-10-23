"""Source-owned typed facts, idempotency, transaction and DDL."""
from pathlib import Path
from scripts.utils.database import Database, digest
from scripts.utils.columns import values
from scripts.utils.model import DataError, parse_time, timestamp
from .task import validate
from .contracts import contract, project_fields
from .parameters import DAILY, collection_window, granularity
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
        window=collection_window(task,window)
        grain=granularity(task.options)
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
        instants=set()
        for row in batch.ads:
            record=project_fields({'dimensions':row['dimensions'],'metrics':row['metrics']})
            if record['advertiser_id'] != task.account_id:
                raise DataError('写入账户与任务不一致')
            if (record['aweme_id'] or '') != aweme_id:
                raise DataError('写入主播与批次不一致')
            record['aweme_id']=aweme_id
            if record['time_granularity'] != grain:
                raise DataError('写入时间粒度与任务不一致')
            instant=record['stat_datetime']
            dt=parse_time(instant)
            if dt.minute or dt.second or dt.microsecond or (grain==DAILY and dt.hour):
                raise DataError('写入统计时间不符合任务的时间粒度')
            if not window.contains(instant): raise DataError('写入统计时间超出任务窗口')
            if instant in instants: raise DataError('千川账户主播统计时间重复')
            instants.add(instant)
            records.append(values(definition,record)+(batch.observed_at,))
        with self.transaction() as cur:
            cur.execute('DELETE FROM `qianchuan_stats` WHERE `advertiser_id`=%s AND `aweme_id`=%s AND `time_granularity`=%s AND `stat_datetime` >= %s AND `stat_datetime` < %s',
                        (task.account_id,aweme_id,grain,timestamp(window.start),timestamp(window.end)))
            for record in records:
                cur.execute(statement,record)
            self.audit(cur,task,window,0,batch.count,'采集完整')
