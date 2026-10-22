"""Normalized business entities and task plans independent from source row layouts."""
from .validation import validate_routes
from .master_data import stable_key
from scripts.utils.model import ConfigError
from scripts.registry import make_task

CATALOG_TABLES = {
    'products': ('live_product', ('product_id','name','enabled')),
    'rooms': ('live_room', ('room_id','product_id','name','enabled')),
    'ad_platforms': ('live_ad_platform', ('platform_id','source','version')),
    'policy_platforms': ('live_policy_platform', ('platform_id','source')),
    'applications': ('live_oauth_application', ('app_key','app_id','source','credential','enabled')),
    'accounts': ('live_ad_account', ('account_key','advertiser_id','name','account_type','platform_id','app_key','enabled')),
    'room_accounts': ('live_room_ad_account', ('room_id','account_key','scope_json','enabled')),
    'room_backends': ('live_room_policy_backend', ('room_id','platform_id','selector','platform','credential','enabled')),
}


def normalize_catalog(snapshot):
    """Convert validated mirrors into eight relational entity sets, with no source JSON."""
    result = {name:{} for name in CATALOG_TABLES}
    def put(table, key, row, aggregate_enabled=False):
        old=result[table].get(key)
        if old is not None:
            comparable={k:v for k,v in row.items() if not (aggregate_enabled and k=='enabled')}
            if {k:v for k,v in old.items() if not (aggregate_enabled and k=='enabled')} != comparable:
                raise ConfigError('业务目录同一主键存在冲突属性或外键')
            if aggregate_enabled: old['enabled'] = old['enabled'] or row['enabled']
        else: result[table][key]=row
    def room(row):
        product=row['product_id']; room_id=row['room_id']
        put('products',product,{'product_id':product,'name':row.get('product_name') or product,'enabled':row['enabled']},True)
        put('rooms',room_id,{'room_id':room_id,'product_id':product,'name':row.get('room_name') or room_id,'enabled':row['enabled']},True)
    for app in snapshot['applications']:
        put('applications',app['row_key'],{'app_key':app['row_key'],'app_id':app['app_id'],
             'source':app['source'],'credential':app['credential'],'enabled':app['enabled']})
    for account in snapshot['accounts']:
        room(account)
        app=result['applications'].get(account['app_key'])
        if app is None or app['source'] != account['source'] or (account['enabled'] and not app['enabled']):
            raise ConfigError('业务目录账户关联应用缺失、停用或来源冲突')
        version=account.get('version') or ''
        platform_id=stable_key(account['source'],version)
        put('ad_platforms',platform_id,{'platform_id':platform_id,'source':account['source'],'version':version})
        account_key=stable_key(account['source'],account['advertiser_id'])
        put('accounts',account_key,{'account_key':account_key,'advertiser_id':account['advertiser_id'],
            'name':account.get('account_name',''),'account_type':account.get('account_type',''),
            'platform_id':platform_id,'app_key':account['app_key'],'enabled':account['enabled']},True)
        options={'aweme_id':account['aweme_id']} if account.get('aweme_id') else {'account_scope':account['account_scope']}
        key=account['room_id'],account_key
        if key in result['room_accounts']: raise ConfigError('同一直播间账户绑定重复')
        put('room_accounts',key,{'room_id':account['room_id'],'account_key':account_key,
            'scope_json':options,'enabled':account['enabled']})
    for backend in snapshot['backends']:
        room(backend)
        platform_id=stable_key(backend['source'])
        put('policy_platforms',platform_id,{'platform_id':platform_id,'source':backend['source']})
        if backend['room_id'] in result['room_backends']: raise ConfigError('同一直播间只能绑定一个保单后台')
        put('room_backends',backend['room_id'],{'room_id':backend['room_id'],'platform_id':platform_id,
            'selector':backend['selector'],'platform':backend['platform'],'credential':backend['credential'],'enabled':backend['enabled']})
    catalog={name:[records[key] for key in sorted(records)] for name,records in result.items()}
    # Scope overlap and missing enabled relationships fail before any SQL mutation.
    credentials={a['credential']:{'source':a['source']} for a in snapshot['applications']}
    credentials.update({b['credential']:{'source':b['source']} for b in snapshot['backends']})
    catalog_routes(catalog,credentials)
    return catalog


def catalog_routes(catalog, credentials):
    products={r['product_id']:r for r in catalog['products']}
    rooms={r['room_id']:r for r in catalog['rooms']}
    apps={r['app_key']:r for r in catalog['applications']}
    accounts={r['account_key']:r for r in catalog['accounts']}
    ads={r['platform_id']:r for r in catalog['ad_platforms']}
    policies={r['platform_id']:r for r in catalog['policy_platforms']}
    tasks=[]; ad_rooms=set(); policy_rooms=set()
    def active_room(room_id):
        room=rooms.get(room_id)
        if not room or room['product_id'] not in products: raise ConfigError('目录直播间的产品外键缺失')
        return room if room['enabled'] and products[room['product_id']]['enabled'] else None
    for binding in catalog['room_accounts']:
        if not binding['enabled']: continue
        room=active_room(binding['room_id'])
        if room is None: continue
        account=accounts.get(binding['account_key'])
        if not account or not account['enabled']: raise ConfigError('目录账户绑定缺失或账户停用')
        app=apps.get(account['app_key']); platform=ads.get(account['platform_id'])
        if not app or not platform or not app['enabled'] or app['source']!=platform['source']: raise ConfigError('目录账户应用或广告平台关联无效')
        options=dict(binding['scope_json'])
        if platform['source']=='marketing': options['version']=platform['version']
        options.update(expected_app_id=app['app_id'],account_name=account['name'],account_type=account['account_type'],room_name=room['name'])
        tasks.append(make_task(platform['source'],room['product_id'],room['room_id'],app['credential'],account['advertiser_id'],options))
        ad_rooms.add(room['room_id'])
    for binding in catalog['room_backends']:
        if not binding['enabled']: continue
        room=active_room(binding['room_id'])
        if room is None: continue
        platform=policies.get(binding['platform_id'])
        if not platform: raise ConfigError('目录保单平台外键缺失')
        source=platform['source']
        options={'channel':binding['selector']} if source=='pingan' else {'dy_no':binding['selector'],'platform':binding['platform']}
        options['room_name']=room['name']
        tasks.append(make_task(source,room['product_id'],room['room_id'],binding['credential'],options=options))
        if room['room_id'] in policy_rooms: raise ConfigError('目录保单任务重复')
        policy_rooms.add(room['room_id'])
    if ad_rooms != policy_rooms: raise ConfigError('直播间投放账户与保单后台的启用关联不完整')
    validate_routes(tasks,credentials)
    return sorted(tasks,key=lambda r:(r.product_id,r.room_id,r.source not in ('marketing','qianchuan'),r.source,r.account_id,r.route_id))
