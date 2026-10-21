"""Version routing and metadata-backed Douyin account filtering."""
from __future__ import annotations

import copy
import re
from typing import Any


class ToolError(Exception):
    def __init__(self, message: str, response: dict | None = None):
        super().__init__(message)
        self.response = response


VERSIONS = {
    'smart': ('巨量营销-智擎版', 'BASIC_DATA'),
    'legacy': ('巨量营销-旧版', 'STD_BASIC_DATA'),
    'qianchuan': ('巨量千川', 'ECP_BASIC_DATA'),
}


def normalize_version(value: str | None) -> str:
    if value is None:
        return 'smart'
    for key, (label, _) in VERSIONS.items():
        if value in (key, label):
            return key
    raise ToolError('未知巨量版本，请使用 smart / legacy / qianchuan 或对应中文名称。')


def report_endpoint(command: str, version: str) -> str:
    prefix = '/open_api/v1.0/qianchuan' if version == 'qianchuan' else '/open_api/v3.0'
    suffix = 'config/get/' if command == 'fields' else 'get/'
    return f'{prefix}/report/custom/{suffix}'


def identifier(value: Any, name: str, numeric: bool = False) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ToolError(f'{name} 必须是非空字符串或整数，超长ID请使用字符串。')
    result = str(value).strip()
    if not result or (numeric and (not re.fullmatch(r'[0-9]+', result) or int(result) <= 0)):
        raise ToolError(f'{name} 无效' + ('，须为正整数ID。' if numeric else '，不能为空。'))
    return result


def prepare_query(command: str, source: dict, *, version=None, advertiser_id=None,
                  aweme_id=None, data_topic=None) -> tuple[str, dict, str | None]:
    params = copy.deepcopy(source)
    context = params.pop('_context', {})
    if not isinstance(context, dict) or set(context) - {'version', 'aweme_id', 'data_topic'}:
        raise ToolError('_context 仅支持 version、aweme_id、data_topic。')
    explicit_version = version if version is not None else context.get('version')
    selected = normalize_version(explicit_version)
    account = advertiser_id if advertiser_id is not None else params.get('advertiser_id')
    params['advertiser_id'] = identifier(account, 'advertiser_id', numeric=True)
    key = 'data_topics' if command == 'fields' else 'data_topic'
    topic = data_topic if data_topic is not None else context.get('data_topic')
    if topic is not None:
        topic = identifier(topic, 'data_topic')
        params[key] = [topic] if command == 'fields' else topic
    elif explicit_version is not None or key not in params:
        topic = VERSIONS[selected][1]
        params[key] = [topic] if command == 'fields' else topic
    if command == 'fields':
        # A report template can be reused to discover the selected version's fields.
        params = {k: params[k] for k in ('advertiser_id', 'data_topics')}
        if not isinstance(params[key], list) or not params[key] or any(not isinstance(t, str) or not t.strip() for t in params[key]):
            raise ToolError('data_topics 必须是非空字符串数组。')
    else:
        if not isinstance(params[key], str) or not params[key].strip():
            raise ToolError('data_topic 必须是非空字符串。')
        for name in ('dimensions', 'metrics'):
            if not isinstance(params.get(name), list) or not params[name] or any(not isinstance(f, str) or not f for f in params[name]):
                raise ToolError(f'{name} 必须是非空字段名数组。')
        params.setdefault('filters', [])
        if not isinstance(params['filters'], list) or any(not isinstance(f, dict) for f in params['filters']):
            raise ToolError('filters 必须是对象数组。')
    aweme = aweme_id if aweme_id is not None else context.get('aweme_id')
    if aweme is not None:
        aweme = identifier(aweme, 'aweme_id（抖音号）')
        if command != 'report':
            raise ToolError('fields 查询账户级字段配置，不接受抖音号；请在 report 中指定。')
    return selected, params, aweme


def get_topic_config(response: dict, topic: str) -> dict:
    if response.get('code') != 0 or not isinstance(response.get('data'), dict):
        raise ToolError('字段配置不是成功的接口响应。')
    data = response['data']
    items = data.get('list', data.get('custom_config_datas'))
    if not isinstance(items, list):
        raise ToolError('字段配置缺少 data.list 或 data.custom_config_datas。')
    matches = [x for x in items if isinstance(x, dict) and x.get('data_topic') == topic]
    if len(matches) != 1:
        raise ToolError(f'字段配置中未找到唯一的主题 {topic}，请重新执行 fields。')
    config = matches[0]
    for name in ('dimensions', 'metrics'):
        entries = config.get(name)
        if not isinstance(entries, list) or any(not isinstance(x, dict) or not isinstance(x.get('field'), str) for x in entries):
            raise ToolError(f'字段配置中的 {name} 格式无效。')
        if len({x['field'] for x in entries}) != len(entries):
            raise ToolError(f'字段配置中的 {name} 有重复字段。')
    return config


def aweme_filter_field(config: dict, version: str) -> tuple[dict, bool]:
    """Return a filterable display-ID dimension, or a QC internal-ID dimension."""
    dims = {x['field']: x for x in config['dimensions']
            if x.get('filter_able', x.get('filterable')) is True}
    for key in ('aweme_show_id', 'anchor_show_id', 'aweme_id', 'anchor_id'):
        entry = dims.get(key)
        if not entry:
            continue
        display = key.endswith('show_id') or (version != 'qianchuan' and entry.get('name') in ('抖音号', '主播抖音号'))
        # Marketing's aweme_id is labelled 抖音号 in its field configuration.
        if display:
            return entry, False
    if version == 'qianchuan':
        for key in ('aweme_id', 'anchor_id'):
            if key in dims:
                return dims[key], True
    raise ToolError('该主题未提供可筛选的抖音号维度，无法安全限定主播；请检查 fields 或选择其他数据主题。')


def add_aweme_filter(params: dict, config: dict, field: dict, value: str) -> dict:
    result = copy.deepcopy(params)
    rule = field.get('filter_config')
    if not isinstance(rule, dict) or rule.get('operator') not in (1, 7) or isinstance(rule.get('operator'), bool):
        raise ToolError('抖音号字段未提供支持精确匹配的筛选规则，不能构造主播过滤。')
    if not isinstance(rule.get('type'), int) or isinstance(rule['type'], bool):
        raise ToolError('抖音号字段的 filter_config.type 缺失或无效。')
    if rule.get('value_limit') is not None and rule['value_limit'] < 1:
        raise ToolError('该抖音号字段不允许筛选值。')
    wanted = {'field': field['field'], 'type': rule['type'], 'operator': rule['operator'], 'values': [value]}
    existing = [f for f in result['filters'] if f.get('field') == field['field']]
    if existing and (len(existing) != 1 or existing[0] != wanted):
        raise ToolError('params 中已有不同的抖音号筛选条件，请删除冲突条件后再查询。')
    if not existing:
        result['filters'].append(wanted)
    dims = {x['field']: x for x in config['dimensions']}
    metrics = {x['field']: x for x in config['metrics']}
    for key, available in (('dimensions', dims), ('metrics', metrics)):
        missing = sorted(set(result[key]) - available.keys())
        if missing:
            raise ToolError(f'当前主题不支持这些 {key}: {", ".join(missing)}；请先查询对应版本的 fields。')
    selected_dims = set(result['dimensions']) | {f['field'] for f in result['filters'] if f.get('field') in dims}
    selected_metrics = set(result['metrics']) | {f['field'] for f in result['filters'] if f.get('field') in metrics}
    for key in selected_dims | selected_metrics:
        entry = dims.get(key, metrics.get(key))
        conflicts = (set(entry.get('exclusion_dims', [])) & selected_dims) | (set(entry.get('exclusion_metrics', [])) & selected_metrics)
        if conflicts:
            raise ToolError(f'{key} 与这些查询字段互斥: {", ".join(sorted(conflicts))}')
    for key, entry in dims.items():
        if entry.get('is_required') is True and key not in result['dimensions']:
            raise ToolError(f'当前主题要求 dimensions 包含 {key}。')
    return result
