"""zhongan owns its task parameters, normalization and data scope."""
from scripts.utils.model import ConfigError, Scope
from scripts.utils.tasks import build_task, text

CONTEXT = set()
ALLOWED = {'dy_no', 'platform'} | CONTEXT


def make_task(credential, options=None):
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
    options['dy_no'] = text(options.get('dy_no'), 'dy_no')
    options['platform'] = text(options.get('platform', 'DOUYIN'), 'platform')
    scope = {name: value for name, value in options.items() if name not in CONTEXT}
    route = build_task('zhongan', credential, '', options, scope)
    validate(route)
    return route


def validate(route):
    if route.source != 'zhongan':
        raise ConfigError('任务来源与采集器不匹配')
    if route.account_id:
        raise ConfigError('保单数据不按广告账户复制，请留空 account_id')
    options = route.options
    if not isinstance(options, dict) or set(options) - ALLOWED:
        raise ConfigError('任务 options 含未知字段；不得包含凭据或额外过滤条件')
    text(options.get('dy_no'), 'dy_no')
    text(options.get('platform', 'DOUYIN'), 'platform')
    return Scope(('zhongan', options.get('platform', 'DOUYIN'), options['dy_no'].strip()))
