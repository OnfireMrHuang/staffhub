"""Marketing task options and data-scope validation."""
from scripts.utils.model import ConfigError, Scope
from scripts.utils.tasks import build_task, positive_id, text

SOURCE = 'marketing'
CONTEXT = {'account_name', 'account_type'}
OPTIONS = CONTEXT | {'account_scope', 'version'}


def _options(options):
    if options is None:
        options = {}
    if not isinstance(options, dict) or set(options) - OPTIONS:
        raise ConfigError('营销 options 含未知字段；不得包含凭据或额外过滤条件')
    options = dict(options)
    for field in CONTEXT & options.keys():
        if options[field] != '':
            options[field] = text(options[field], field)
    if 'account_scope' in options and not isinstance(options['account_scope'], bool):
        raise ConfigError('account_scope 必须为布尔值')
    if options.get('account_scope') is not True:
        raise ConfigError('营销仅支持账户级采集，account_scope 必须为 true')
    options.setdefault('version', 'smart')
    if options['version'] not in ('smart', 'legacy'):
        raise ConfigError('营销仅支持 smart / legacy 版本')
    return options


def make_task(account_id, options=None):
    account_id = positive_id(account_id, 'account_id')
    options = dict(options or {})
    options.setdefault('account_scope', True)
    options = _options(options)
    scope = {key: options[key] for key in ('version', 'account_scope')}
    return build_task(SOURCE, account_id, options, scope)


def validate(route):
    if route.source != SOURCE:
        raise ConfigError('营销采集器不接受其他来源任务')
    account = positive_id(route.account_id, 'account_id')
    if account != route.account_id:
        raise ConfigError('广告 account_id 必须是规范的正整数文本')
    _options(route.options)
    return Scope(resource=(SOURCE, account))
