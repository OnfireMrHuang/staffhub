"""Qianchuan task normalization and non-overlapping account/anchor scope."""
import re

from scripts.utils.model import ConfigError, Scope
from scripts.utils.tasks import build_task, positive_id, text

SOURCE = 'qianchuan'
CONTEXT = {'account_name', 'account_type', 'room_name'}
OPTIONS = CONTEXT | {'account_scope', 'aweme_id', 'aweme_ids', 'metrics', 'expected_app_id'}


def _options(options):
    if options is None:
        options = {}
    if not isinstance(options, dict) or set(options) - OPTIONS:
        raise ConfigError('千川 options 含未知字段；不得包含凭据或额外过滤条件')
    options = dict(options)
    for field in CONTEXT & options.keys():
        if options[field] != '':
            options[field] = text(options[field], field)
    if 'account_scope' in options and not isinstance(options['account_scope'], bool):
        raise ConfigError('account_scope 必须为布尔值')
    if 'aweme_id' in options:
        options['aweme_id'] = text(options['aweme_id'], 'aweme_id')
    if 'aweme_ids' in options:
        values = options['aweme_ids']
        if (not isinstance(values, list) or len(values) != 1 or isinstance(values[0], bool)
                or not isinstance(values[0], (str, int))):
            raise ConfigError('aweme_ids 必须只包含一个已核实的内部ID')
        options['aweme_ids'] = [int(positive_id(str(values[0]), 'aweme_ids'))]
    if options.get('aweme_id') and options.get('aweme_ids'):
        raise ConfigError('手机端和内部 aweme ID 不能同时配置')
    selected = bool(options.get('aweme_id') or options.get('aweme_ids'))
    if not selected and options.get('account_scope') is not True:
        raise ConfigError('千川任务必须指定抖音号、内部ID或明确 account_scope=true')
    if selected and options.get('account_scope'):
        raise ConfigError('账户全量与主播过滤不能同时配置')
    if 'expected_app_id' in options:
        options['expected_app_id'] = positive_id(options['expected_app_id'], 'expected_app_id')
    if 'metrics' in options:
        metrics = options['metrics']
        if (not isinstance(metrics, list) or not metrics or len(metrics) > 200
                or any(not isinstance(m, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', m) for m in metrics)
                or len(set(metrics)) != len(metrics)):
            raise ConfigError('metrics 必须为不重复的来源字段名数组')
        options['metrics'] = list(metrics)
    return options


def make_task(product_id, room_id, credential, account_id='', options=None):
    account_id = positive_id(account_id, 'account_id')
    options = _options(options)
    scope = {key: options[key] for key in ('account_scope', 'aweme_id', 'aweme_ids') if key in options}
    if not scope.get('account_scope'):
        scope.pop('account_scope', None)
    return build_task(SOURCE, product_id, room_id, credential, account_id, options, scope)


def validate(route):
    if route.source != SOURCE:
        raise ConfigError('千川采集器不接受其他来源任务')
    account = positive_id(route.account_id, 'account_id')
    if account != route.account_id:
        raise ConfigError('广告 account_id 必须是规范的正整数文本')
    options = _options(route.options)
    if options.get('aweme_ids'):
        return Scope((SOURCE, account), str(options['aweme_ids'][0]), 'internal')
    return Scope((SOURCE, account), options.get('aweme_id', '*'), 'display')
