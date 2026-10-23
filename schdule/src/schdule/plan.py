"""Read one MySQL relation projection and build a fully validated immutable run plan."""
import json
import re
from pathlib import Path
from .models import Binding
from .errors import ScheduleError


def load_fixture(path,limit):
    try:
        raw=Path(path).read_text(encoding='utf-8')
        if len(raw)>8*1024*1024:raise ValueError
        rows=json.loads(raw)
    except (OSError,ValueError) as error:raise ScheduleError('无法读取计划预览文件') from error
    return validate_rows(rows,limit)


def validate_rows(rows,limit):
    if not isinstance(rows,list) or not rows:raise ScheduleError('启用计划为空；检查 MySQL 关联查询或筛选条件')
    if len(rows)>limit:raise ScheduleError('关联查询超过 max_rows，拒绝截断后执行')
    return [Binding.parse(row) for row in rows]


def load_mysql(settings,connect=None):
    import pymysql
    db=settings.data.get('mysql',{})
    connection=None
    try:
        query=settings.resolve(settings.data.get('plan',{}).get('query_file','plan.sql')).read_text(encoding='utf-8')
        body=re.sub(r'^\s*--[^\n]*(?:\n|$)', '', query, flags=re.MULTILINE).lstrip()
        if len(query)>1024*1024 or not re.match(r'(SELECT|WITH)\b',body,re.IGNORECASE):
            raise ScheduleError('计划 SQL 必须是 SELECT 或 WITH 查询')
        password=db.get('password')
        if not isinstance(password,str):raise ScheduleError('请在 mysql.password 中配置字符串密码')
        connection=(connect or pymysql.connect)(host=db.get('host','127.0.0.1'),port=int(db.get('port',3306)),
            user=db.get('user','schedule_reader'),password=password,database=db.get('database','source_data'),
            charset='utf8mb4',autocommit=False,connect_timeout=10,read_timeout=30,write_timeout=30,
            cursorclass=pymysql.cursors.DictCursor)
        with connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION READ ONLY')
            connection.begin()
            cursor.execute(query)
            rows=list(cursor.fetchmany(settings.max_rows+1))
        connection.commit()
    except ScheduleError:raise
    except Exception as error:
        raise ScheduleError('MySQL 计划读取失败；检查配置、只读权限和 SQL 投影',5) from error
    finally:
        if connection is not None:
            try:connection.close()
            except Exception:pass
    return validate_rows(rows,settings.max_rows)


def build_plan(bindings,collectors):
    targets=[]
    by_task={}
    resource_scopes={}
    policy_rooms=set()
    for binding in bindings:
        target=collectors.prepare(binding)
        key=(binding.source,target.task.task_id)
        if key in by_task:
            old=by_task[key]
            if (old.binding.room_key!=binding.room_key or old.auth_key!=target.auth_key
                    or old.task.options!=target.task.options):
                raise ScheduleError('相同来源范围存在冲突归属或参数')
            continue  # A SQL account/backend join may repeat an identical backend row.
        if binding.source in ('pingan','zhongan'):
            if binding.room_key in policy_rooms:
                raise ScheduleError('同一直播间存在多个不同保单后台范围')
            policy_rooms.add(binding.room_key)
        scope=target.scope
        previous=resource_scopes.setdefault(scope.resource,[])
        for other in previous:
            if ((scope.namespace and other.namespace and scope.namespace!=other.namespace)
                    or '*' in (scope.selector,other.selector) or scope.selector==other.selector):
                raise ScheduleError('来源范围重叠或无法比较，拒绝重复采集')
        previous.append(scope)
        by_task[key]=target
        targets.append(target)
    return sorted(targets,key=lambda t:(*t.binding.room_key,
        t.binding.source not in ('marketing','qianchuan'),t.binding.source,t.binding.advertise_id,t.task.task_id))
