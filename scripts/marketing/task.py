"""Marketing task options and data-scope validation."""
import re

from scripts.utils.model import ConfigError, Scope
from scripts.utils.tasks import build_task, positive_id, text

SOURCE = 'marketing'
CONTEXT = {'account_name', 'account_type'}
OPTIONS = CONTEXT | {'account_scope', 'aweme_id', 'version'}


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
    if 'aweme_id' in options:
        options['aweme_id'] = text(options['aweme_id'], 'aweme_id')
    if not options.get('aweme_id') and options.get('account_scope') is not True:
        raise ConfigError('营销任务必须指定抖音号或明确 account_scope=true')
    if options.get('aweme_id') and options.get('account_scope'):
        raise ConfigError('账户全量与主播过滤不能同时配置')
    options.setdefault('version', 'smart')
    if options['version'] not in ('smart', 'legacy'):
        raise ConfigError('营销仅支持 smart / legacy 版本')
    return options


def make_task(credential, account_id, options=None):
    account_id = positive_id(account_id, 'account_id')
    options = dict(options or {})
    if not options.get('aweme_id') and not options.get('aweme_ids'):
        options.setdefault('account_scope', True)
    options = _options(options)
    scope = {key: options[key] for key in ('version', 'account_scope', 'aweme_id') if key in options}
    if not scope.get('account_scope'):
        scope.pop('account_scope', None)
    return build_task(SOURCE, credential, account_id, options, scope)


def validate(route):
    if route.source != SOURCE:
        raise ConfigError('营销采集器不接受其他来源任务')
    account = positive_id(route.account_id, 'account_id')
    if account != route.account_id:
        raise ConfigError('广告 account_id 必须是规范的正整数文本')
    options = _options(route.options)
    return Scope(resource=(SOURCE, account), selector=options.get('aweme_id', '*'), namespace='display')
