"""Source-owned request protocol, scope checks and complete pagination."""
import time
from scripts.utils.model import AuthError, DataError, Batch, timestamp, now
from .contracts import with_collection

ZHONGAN='https://adagent.zhongan.com'
ZA_ENDPOINTS={'rooms':'getLiveDy','attribute':'getLiveAttribute','aggregate':'getDashboardAggregate','orders':'getOrderList'}

def finish_batch(batch):
    completed=now()
    batch.observed_at=timestamp(completed)
    for record in batch.snapshots+batch.orders:
        payload=record.get('metrics',record.get('payload'))
        payload['_collection']['context']['collectedAt']=completed.isoformat(timespec='seconds')
    return batch

def za_headers(state):
    # Only send cookies belonging to the endpoint's host and matching path.
    cookies=[]
    for c in state.get('cookies',[]):
        domain=c.get('domain','').lstrip('.')
        path=c.get('path','/')
        expiry=c.get('expires',-1)
        if domain and ('adagent.zhongan.com'==domain or ('adagent.zhongan.com'.endswith('.'+domain) and c.get('domain','').startswith('.'))) and '/newdmapi/lre/dashboardLiveController/'.startswith(path) and (expiry==-1 or expiry>time.time()):
            cookies.append(c['name']+'='+c['value'])
    headers={'Cookie':'; '.join(cookies),'Origin':ZHONGAN,'Referer':ZHONGAN+'/app-live/liveStream/dashboard/'}
    for origin in state.get('origins',[]):
        if origin.get('origin')==ZHONGAN:
            local={item['name']:item['value'] for item in origin.get('localStorage',[])}
            for key,header in [('ATLANTIS_SESSION_ID','X-Usercenter-Session'),('SERVICE_NAME','X-Service-Name')]:
                if local.get(key) and local[key] not in ('undefined','null'):
                    headers[header]=local[key]
    return headers

class Collector:
    def __init__(self,transport,max_pages=10000):
        self.transport,self.max_pages=transport,max_pages

    def post(self,route,session,endpoint,body):
        payload=self.transport.request('POST',ZHONGAN+'/newdmapi/lre/dashboardLiveController/'+ZA_ENDPOINTS[endpoint],json=body,headers=za_headers(session))
        codes={str(payload.get(k)) for k in ('code','returnCode')}
        if codes & {'401','1013','1014'}: raise AuthError('众安登录失效')
        if payload.get('success') is False or not (payload.get('success') is True or '200' in codes):
            raise DataError('众安业务查询失败，请检查权限')
        if payload.get('data') is None: raise DataError('保单接口缺少 data，不能当作空数据')
        return payload['data']

    def check(self,route,session):
        data=self.post(route,session,'rooms',{'startDate':now().date().isoformat(),'livePlatform':route.options.get('platform','DOUYIN')})
        if not isinstance(data,list): raise DataError('众安授权探测响应结构无效')
        if not data: return 'unobserved_no_live_rooms'
        if not any(isinstance(row,dict) and str(row.get('dyNo'))==route.options['dy_no'] for row in data):
            raise DataError('众安会话有效，但目标直播间未出现在当日可见列表；可能尚未开播或访问范围变化')
        return 'verified'

    def collect(self,route,window,session):
        if route.source != 'zhongan': raise DataError('任务来源与采集器不匹配')
        batch=Batch(); o=route.options; dy=o['dy_no']; platform=o.get('platform','DOUYIN'); all_orders={}
        for day in window.dates():
            rooms=self.post(route,session,'rooms',{'startDate':day,'livePlatform':platform})
            if not isinstance(rooms,list) or not any(isinstance(r,dict) and str(r.get('dyNo'))==dy for r in rooms):
                raise DataError('众安指定直播间不在当日列表中')
            room=next(r for r in rooms if isinstance(r,dict) and str(r.get('dyNo'))==dy)
            attribute=self.post(route,session,'attribute',{'dyNo':dy,'startDate':day})
            if not isinstance(attribute,dict): raise DataError('众安场次结构变化')
            sessions=[]
            session_metadata={}
            if attribute.get('roomId'):
                sid=str(attribute['roomId']); sessions.append(sid)
                session_metadata[sid]={k:v for k,v in attribute.items() if k!='attributeOfflineDTOList'}
            offline=attribute.get('attributeOfflineDTOList') or []
            if not isinstance(offline,list) or any(not isinstance(x,dict) or not x.get('roomId') for x in offline): raise DataError('众安历史场次结构变化')
            for item in offline:
                if str(item['roomId']) not in sessions:
                    sid=str(item['roomId']); sessions.append(sid); session_metadata[sid]=item
            if not sessions: raise DataError('众安当日无场次，不以零覆盖')
            for sid in sessions:
                base={'livePlatform':platform,'dyNo':dy,'roomIdList':[sid]}
                merged={**room,**session_metadata[sid]}
                context={name:merged.get(name) for name in ('anchorNick','agentLiveName','startTime')}
                context.update(livePlatform=platform,dyNo=dy,startDate=day,roomId=sid)
                source_context={'room':room,'session':session_metadata[sid]}
                aggregate=self.post(route,session,'aggregate',base)
                if not isinstance(aggregate,dict) or not aggregate: raise DataError('众安看板结构变化或为空')
                batch.snapshots.append({'date':day,'session_id':sid,'grain':'session_cumulative',
                                        'metrics':with_collection(aggregate,context,source_context=source_context)})
                cursor=None; cursors=set(); order_ids=set()
                for _ in range(self.max_pages):
                    query={**base,'startDate':day,'showDetail':'Y'}
                    if cursor is not None: query['nextPage']=cursor
                    rows=self.post(route,session,'orders',query)
                    if not isinstance(rows,list) or any(not isinstance(r,dict) for r in rows): raise DataError('众安订单结构变化')
                    if not rows: break
                    for row in rows:
                        key=row.get('orderNo')
                        if key is None or not str(key).strip(): raise DataError('众安订单缺少 orderNo')
                        key=str(key)
                        if key in order_ids: raise DataError('众安分页重复订单')
                        order_ids.add(key)
                        record={'order_id':key,'session_id':sid,'date':day,
                                'payload':with_collection(row,context,source_context=source_context)}
                        if key in all_orders and all_orders[key]!=record:
                            raise DataError('众安订单跨场次或日期归属冲突')
                        all_orders[key]=record
                    if 'nextPage' not in rows[-1]: raise DataError('众安缺失分页游标')
                    cursor=rows[-1]['nextPage']
                    if cursor in (None,'',False,0): break
                    if isinstance(cursor,bool) or not isinstance(cursor,(str,int)) or str(cursor) in cursors: raise DataError('众安游标重复或无效')
                    cursors.add(str(cursor))
                else: raise DataError('众安超过最大页数')
        batch.orders=list(all_orders.values())
        return finish_batch(batch)
