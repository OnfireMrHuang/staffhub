"""Source-owned request protocol, scope checks and complete pagination."""
import json
import time
from datetime import timedelta
from urllib.parse import urlencode
from scripts.utils.model import AuthError, DataError, Batch, parse_time, timestamp, now
from .contracts import clean_pingan_summary, with_collection

PINGAN='https://open.health.pingan.com'
PA_ENDPOINTS={'title':'obtainTikTokBoardTitle','summary':'queryCommonRealtimeTargets','funnel':'obtainTikTokBoardFunnel','orders':'orderInfo'}

def finish_batch(batch):
    completed=now()
    batch.observed_at=timestamp(completed)
    for record in batch.snapshots+batch.orders:
        payload=record.get('metrics',record.get('payload'))
        payload['_collection']['context']['collectedAt']=completed.isoformat(timespec='seconds')
    return batch

class Collector:
    def __init__(self,transport,max_pages=10000):
        self.transport,self.max_pages=transport,max_pages

    def post(self,route,session,endpoint,body):
        req_id=str(time.time_ns()//1000000)
        payload=self.transport.request('POST',PINGAN+'/web/merchant/board/'+PA_ENDPOINTS[endpoint], json={'data':body,'requestId':req_id}, headers={'X-Access-Token':session.get('token',''),'requestId':req_id,'Origin':PINGAN,'Referer':PINGAN+'/v2/home?'+urlencode({'merchantChannel':route.options['channel']})})
        if str(payload.get('code'))=='401': raise AuthError('平安登录失效')
        if payload.get('code')!=200 or payload.get('success') is False:
            raise DataError('平安业务查询失败，请检查渠道权限')
        if payload.get('data') is None: raise DataError('保单接口缺少 data，不能当作空数据')
        return payload['data']

    def check(self,route,session):
        data=self.post(route,session,'title',{'merchantChannelCode':route.options['channel']})
        if not isinstance(data,(dict,list)): raise DataError('平安授权探测响应结构无效')
        return 'verified'

    def collect(self,route,window,session):
        if route.source != 'pingan': raise DataError('任务来源与采集器不匹配')
        batch=Batch(); channel=route.options['channel']; seen_orders=set()
        title=self.post(route,session,'title',{'merchantChannelCode':channel})
        for day in window.dates():
            start=max(window.start,parse_time(day+'T00:00:00'))
            end=min(window.end,parse_time(day+'T00:00:00')+timedelta(days=1))
            summary=self.post(route,session,'summary',{'pageNo':1,'pageSize':999,'advertPlat':channel,'statDate':day.replace('-','')})
            if not isinstance(summary,list) or not summary or any(not isinstance(x,dict) for x in summary):
                raise DataError('平安统计无数据或结构变化，不以零覆盖')
            funnel=self.post(route,session,'funnel',{'merchantChannelCode':channel,'fromTime':day+' 00:00:00','toTime':timestamp(end-timedelta(seconds=1))})
            if not isinstance(funnel,dict): raise DataError('平安漏斗结构变化')
            cleaned=clean_pingan_summary(summary[0]) if len(summary)==1 else {}
            derived={key:cleaned.get(key) for key in ('calcBindCardRate','calcSurrenderRate','annualPolRate','multiApplicantPolRate')}
            metrics=with_collection({'title':title,'summary':summary,'funnel':funnel,'funnel_to':timestamp(end-timedelta(seconds=1))},
                                    {'startDate':day},derived=derived)
            batch.snapshots.append({'date':day,'session_id':'','grain':'day_cumulative','metrics':metrics})
            base={'merchantChannelCode':channel,'fromTime':timestamp(start),'toTime':timestamp(end-timedelta(seconds=1)), 'orderStatusList':[1,10,20,21,30,90,99,100], 'pageSize':10,'sortKey':'updated_date','sortMode':'desc'}
            expected=None; total_pages=None; count=0; fingerprints=set()
            for page in range(1,self.max_pages+1):
                data=self.post(route,session,'orders',{**base,'pageIndex':page})
                if not isinstance(data,dict) or not isinstance(data.get('orderInfoList'),list): raise DataError('平安订单结构变化')
                rows=data['orderInfoList']
                try:
                    total=int(data['totalCount']); pages=int(data['totalPage'])
                    if total<0 or pages<0: raise ValueError
                except (KeyError,ValueError,TypeError) as exc: raise DataError('平安分页元数据无效') from exc
                if expected is None: expected,total_pages=total,pages
                elif total!=expected or pages!=total_pages: raise DataError('平安分页总数变化')
                fp=json.dumps(rows,sort_keys=True)
                if rows and fp in fingerprints: raise DataError('平安返回重复页')
                fingerprints.add(fp); count+=len(rows)
                for row in rows:
                    if not isinstance(row,dict) or not row.get('postId'): raise DataError('平安订单缺少 postId')
                    key=str(row['postId'])
                    if key in seen_orders: raise DataError('平安分页重复订单')
                    seen_orders.add(key); batch.orders.append({'order_id':key,'session_id':'','date':day,'payload':with_collection(row,{'startDate':day})})
                if not rows or page>=pages:
                    if count!=expected: raise DataError('平安订单数量不完整')
                    break
            else: raise DataError('平安订单超过最大页数')
        return finish_batch(batch)
