"""Room-level orchestration; source execution belongs to CollectionService."""
from scripts.utils.model import LiveError, DataError, AuthError
from scripts.utils.runtime import error_result


class Runner:
    def __init__(self, dispatcher, on_error='continue', notifier=None, alert_on_error=False):
        self.dispatcher = dispatcher
        self.on_error = on_error
        self.notifier = notifier
        self.alert_on_error = alert_on_error

    def collect(self, routes, window):
        results, skipped, stopped, code = [], set(), False, 0
        ordered = sorted(routes, key=lambda r: (
            r.product_id, r.room_id, r.source not in ('marketing', 'qianchuan'),
            r.account_id, r.route_id))
        for route in ordered:
            room_key = (route.product_id, route.room_id)
            if stopped or room_key in skipped:
                results.append({'route_id': route.route_id, 'task_id': route.route_id,
                                'source': route.source, 'status': 'skipped', 'code': code})
                continue
            item = self.dispatcher.collect(route, window)
            results.append(item)
            error_code = item['code']
            if not error_code:
                continue
            code = max(code, error_code)
            # Storage failure also covers an audit failure: continuing would lose traceability.
            if error_code == 5 or item.get('audit_error'):
                stopped = True
            if self.notifier and self.alert_on_error:
                try:
                    item['alert'] = self.notifier.send(
                        route.source, route.credential,
                        'auth_required' if error_code == 3 else 'collection_failed')
                except LiveError as exc:
                    item['alert_error'] = str(exc)
                    code = max(code, exc.code)
            if self.on_error == 'abort':
                stopped = True
            elif self.on_error == 'skip-room':
                skipped.add(room_key)
        return {'code': code, 'results': results}

    def maintain(self,routes,wait_seconds=15):
        results=[]; code=0
        groups={}
        for route in routes: groups.setdefault(route.credential,[]).append(route)
        for name,group in groups.items():
            item={'credential':name,'source':group[0].source,'status':'success','code':0}; results.append(item)
            try:
                state=self.dispatcher.ensure(group[0],renew=True,wait_seconds=wait_seconds)
                item['checks']=[{'route_id':group[0].route_id,'scope_status':state.get('scope_status','verified')}]
                for route in group[1:]:
                    state=self.dispatcher.ensure(route)
                    item['checks'].append({'route_id':route.route_id,'scope_status':state.get('scope_status','verified')})
            except Exception as exc:
                error=exc if isinstance(exc,LiveError) else DataError('授权维护遇到非预期错误')
                code=max(code,error.code); item.update(status='failed',code=error.code,message=str(error))
                if self.notifier:
                    try: item['alert']=self.notifier.send(group[0].source,name,'auth_required' if isinstance(error,AuthError) else 'permission_denied')
                    except LiveError as alert_error:
                        item['alert_error']=str(alert_error); code=max(code,alert_error.code)
        return {'code':code,'results':results}

    def check(self, routes, authorize=False, wait_seconds=15):
        results, renewed, code = [], set(), 0
        for route in routes:
            try:
                first = route.credential not in renewed
                state = self.dispatcher.ensure(route, renew=authorize and first,
                    force=authorize and first, wait_seconds=wait_seconds)
                renewed.add(route.credential)
                results.append({'route_id': route.route_id, 'credential': route.credential,
                    'code': 0, 'status': 'session_valid',
                    'scope_status': state.get('scope_status', 'verified')})
            except Exception as error:
                item = error_result(error, route)
                code = max(code, item['code'])
                results.append(item)
        return {'code': code, 'results': results}
