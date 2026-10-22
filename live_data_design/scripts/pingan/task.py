"""pingan owns its task parameters, normalization and data scope."""
from scripts.utils.model import ConfigError, Scope
from scripts.utils.tasks import build_task, text

CONTEXT = {'account_name', 'account_type', 'room_name'}
ALLOWED = {'channel'} | CONTEXT


def make_task(product_id, room_id, credential, account_id='', options=None):
    if account_id:
        raise ConfigError('保单任务不得配置广告 account_id')
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ConfigError('options 必须为对象')
    options = dict(options)
    if set(options) - ALLOWED:
        raise ConfigError('任务 options 含未知字段；不得包含凭据或额外过滤条件')
    for field in CONTEXT & options.keys():
        if options[field] != '':
            options[field] = text(options[field], field)
    options['channel'] = text(options.get('channel'), 'channel')
    scope = {name: value for name, value in options.items() if name not in CONTEXT}
    route = build_task('pingan', product_id, room_id, credential, '', options, scope)
    validate(route)
    return route


def validate(route):
    if route.source != 'pingan':
        raise ConfigError('任务来源与采集器不匹配')
    if route.account_id:
        raise ConfigError('保单数据不按广告账户复制，请留空 account_id')
    options = route.options
    if not isinstance(options, dict) or set(options) - ALLOWED:
        raise ConfigError('任务 options 含未知字段；不得包含凭据或额外过滤条件')
    text(options.get('channel'), 'channel')
    return Scope(('pingan', options['channel'].strip()))
