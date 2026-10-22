"""Source-table snapshots, explicit field mapping, and derived collection tasks."""
import hashlib
import json
import os
import re
from urllib.parse import quote

from scripts.utils.model import ConfigError, DataError
from .model import Route
from scripts.utils.transport import Transport

TABLES = ('accounts', 'applications', 'backends')
PLATFORMS = {
    'marketing': ('marketing', 'smart'),
    '巨量营销': ('marketing', 'smart'),
    '巨量营销-智擎版': ('marketing', 'smart'),
    '巨量营销-旧版': ('marketing', 'legacy'),
    'qianchuan': ('qianchuan', None),
    '巨量千川': ('qianchuan', None),
    'pingan': ('pingan', None),
    '平安保单后台': ('pingan', None),
    'zhongan': ('zhongan', None),
    '众安保单后台': ('zhongan', None),
}
SECRET_COLUMN = re.compile(r'secret|password|token|cookie|auth.?code|密钥|密码|授权码|phone|手机号|电话', re.I)


def stable_key(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def text(value, field, optional=False):
    if value is None or value == '':
        if optional:
            return ''
        raise ConfigError(f'原表缺少必要字段 {field}')
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ConfigError(f'原表 {field} 必须为文本或整数；长 ID 请使用文本')
    result = str(value).strip()
    if not result and not optional:
        raise ConfigError(f'原表 {field} 不能为空')
    if len(result) > 128:
        raise ConfigError(f'原表 {field} 超过128字符')
    return result


def enabled(value):
    if value in (None, ''):
        return True
    if isinstance(value, bool):
        return value
    if value in ('true', 'TRUE', '1', 1, '启用'):
        return True
    if value in ('false', 'FALSE', '0', 0, '停用'):
        return False
    raise ConfigError('原表 enabled 仅支持布尔值、0/1、启用/停用')


def platform(value):
    if value not in PLATFORMS:
        raise ConfigError('原表统计平台未识别，请显式映射 platform_values，不能按产品名称推断')
    return PLATFORMS[value]


def mapped_rows(table, mapping, platform_values):
    values = table.get('values')
    if not isinstance(values, list) or not values or not isinstance(values[0], list):
        raise ConfigError('原表缺少完整表头和数据')
    headers = values[0]
    named_headers = [h for h in headers if h not in ('', None)]
    if any(not isinstance(h, str) for h in named_headers) or len(set(named_headers)) != len(named_headers):
        raise ConfigError('原表表头必须为不重复文本')
    columns = mapping.get('columns', {})
    if not isinstance(columns, dict) or any(h not in headers for h in columns.values()):
        raise ConfigError('columns 映射的列名不存在，请先运行 inspect-sources 校准表头')
    row_numbers=table.get('row_numbers', list(range(2, len(values)+1)))
    if (not isinstance(row_numbers,list) or len(row_numbers)!=len(values)-1
            or any(isinstance(n,bool) or not isinstance(n,int) or n<1 for n in row_numbers)):
        raise ConfigError('原表源行号映射不完整或无效')
    result = []
    for number, row in enumerate(values[1:], 2):
        if not isinstance(row, list) or len(row) > len(headers):
            raise ConfigError('原表行结构不完整或超出表头')
        if not any(v not in (None, '') for v in row):
            continue
        raw = {h: row[i] if i < len(row) else None for i, h in enumerate(headers) if h}
        mapped = {key: raw[h] for key, h in columns.items()}
        for key in ('stat_platform', 'source'):
            if key in mapped:
                mapped[key] = platform_values.get(mapped[key], mapped[key])
        # Unknown columns are not blindly persisted: only configured business fields are mirrored.
        # This prevents a password column with a nonstandard label leaking into MySQL.
        public = {h: raw[h] for key, h in columns.items()
                  if key not in ('app_secret', 'auth_code', 'access_token', 'refresh_token', 'password')
                  and not SECRET_COLUMN.search(h) and not SECRET_COLUMN.search(key)}
        mapped.update(raw_data=public, source_sheet_id=text(table.get('sheet_id'), 'sheet_id'),
                      source_row=row_numbers[number-2],
                      source_revision=text(table.get('revision'), 'revision'))
        result.append(mapped)
    if not result:
        raise ConfigError('默认拒绝空原表，旧数据库快照保持不变')
    return result


def map_tables(tables, config):
    settings = config.get('master_data', {})
    mappings = settings.get('tables', {})
    if set(tables) != set(TABLES) or set(mappings) != set(TABLES):
        raise ConfigError('必须完整提供 accounts、applications、backends 三张原表及映射')
    revisions = {str(tables[k].get('revision')) for k in TABLES}
    if len(revisions) != 1 or 'None' in revisions:
        raise ConfigError('三张原表必须属于同一工作簿版本')
    rows = {k: mapped_rows(tables[k], mappings[k], settings.get('platform_values', {})) for k in TABLES}
    snapshot = {k: [] for k in TABLES}
    for row in rows['applications']:
        app_id = text(row.get('app_id'), 'app_id')
        source, _ = platform(row.get('source'))
        if source not in ('marketing', 'qianchuan'):
            raise ConfigError('巨量应用表仅接受营销或千川来源')
        alias = settings.get('application_credentials', {}).get(f'{source}:{app_id}')
        if not alias:
            raise ConfigError('应用缺少 application_credentials 凭据别名映射')
        snapshot['applications'].append({
            'row_key': stable_key(source, app_id), 'app_id': app_id, 'source': source,
            'credential': alias, 'enabled': enabled(row.get('enabled')),
            **{k: row[k] for k in ('raw_data', 'source_sheet_id', 'source_row', 'source_revision')},
        })
    aliases = [a['credential'] for a in snapshot['applications']]
    if len(set(aliases)) != len(aliases):
        raise ConfigError('不同应用必须使用独立凭据别名和环境变量')
    for row in rows['accounts']:
        product = text(row.get('product_id'), 'product_id')
        room = text(row.get('room_id'), 'room_id')
        account = text(row.get('advertiser_id'), 'advertiser_id')
        source, version = platform(row.get('stat_platform'))
        if source not in ('marketing', 'qianchuan'):
            raise ConfigError('产品账户表必须指明营销/千川统计平台')
        app_id = text(row.get('app_id'), 'app_id',
                      optional='app_id' not in mappings['accounts']['columns'])
        candidates = [a for a in snapshot['applications'] if a['source'] == source
                      and (not app_id or a['app_id'] == app_id)
                      and (a['enabled'] or not enabled(row.get('enabled')))]
        if len(candidates) != 1:
            raise ConfigError('账户关联应用缺失或不唯一；请在原表提供 app_id 或明确唯一应用')
        snapshot['accounts'].append({
            'row_key': stable_key(product, room, source, account), 'product_id': product,
            'room_id': room, 'product_name': text(row.get('product_name'), 'product_name', optional=True) or product,
            'room_name': text(row.get('room_name'), 'room_name', optional=True) or room, 'advertiser_id': account, 'source': source, 'version': version,
            'app_key': candidates[0]['row_key'], 'aweme_id': text(row.get('aweme_id'), 'aweme_id', optional=True),
            'account_scope': False if row.get('account_scope') in (None, '') else enabled(row['account_scope']),
            'account_name': text(row.get('account_name'), 'account_name', optional=True),
            'account_type': text(row.get('account_type'), 'account_type', optional=True),
            'enabled': enabled(row.get('enabled')),
            **{k: row[k] for k in ('raw_data', 'source_sheet_id', 'source_row', 'source_revision')},
        })
    for row in rows['backends']:
        product = text(row.get('product_id'), 'product_id')
        room = text(row.get('room_id'), 'room_id')
        source, _ = platform(row.get('source'))
        if source not in ('pingan', 'zhongan'):
            raise ConfigError('产品统计后台仅接受平安/众安来源')
        selector = text(row.get('selector'), 'selector（平安 channel / 众安 dy_no）')
        backend_id = text(row.get('backend_id'), 'backend_id', optional=True) or selector
        alias = settings.get('backend_credentials', {}).get(f'{source}:{backend_id}')
        if not alias:
            raise ConfigError('后台缺少 backend_credentials 凭据别名映射')
        snapshot['backends'].append({
            'row_key': stable_key(product, room, source, selector), 'product_id': product,
            'room_id': room, 'product_name': text(row.get('product_name'), 'product_name', optional=True) or product,
            'room_name': text(row.get('room_name'), 'room_name', optional=True) or room, 'source': source, 'selector': selector, 'credential': alias,
            'platform': text(row.get('platform'), 'platform', optional=True) or 'DOUYIN',
            'enabled': enabled(row.get('enabled')),
            **{k: row[k] for k in ('raw_data', 'source_sheet_id', 'source_row', 'source_revision')},
        })
    for name, records in snapshot.items():
        if len({r['row_key'] for r in records}) != len(records):
            raise ConfigError(f'{name} 原表出现重复业务键')
    build_routes(snapshot, config['credentials'])
    return snapshot


def build_routes(snapshot, credentials):
    """Compatibility API: runtime tasks come from the normalized business catalog."""
    from .entities import normalize_catalog, catalog_routes
    return catalog_routes(normalize_catalog(snapshot), credentials)


def column_name(number):
    result = ''
    while number:
        number, rem = divmod(number - 1, 26)
        result = chr(65 + rem) + result
    return result


class FeishuReader:
    def __init__(self, workbook, token, client):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', workbook) or not token:
            raise ConfigError('飞书 workbook_token 或访问令牌缺失')
        self.workbook = workbook
        self.token = token
        self.transport = Transport(client)

    def api(self, path, **params):
        body = self.transport.request('GET', 'https://open.feishu.cn/open-apis/' + path,
                                      params=params, headers={'Authorization': 'Bearer ' + self.token})
        if body.get('code') != 0 or not isinstance(body.get('data'), dict):
            raise DataError('飞书读取失败，请检查令牌、表格读取权限及范围')
        return body['data']

    def sheets(self, mappings):
        data = self.api(f'sheets/v3/spreadsheets/{self.workbook}/sheets/query')
        sheets = data.get('sheets')
        if not isinstance(sheets, list):
            raise DataError('飞书工作表元数据无效')
        selected = {}
        for name, spec in mappings.items():
            matches = [s for s in sheets if s.get('sheet_id') == spec.get('sheet_id')]
            if not spec.get('sheet_id'):
                matches = [s for s in sheets if s.get('title') == spec.get('title')]
            if len(matches) != 1:
                raise ConfigError('找不到唯一的原工作表，请校准 sheet_id / title')
            selected[name] = matches[0]
        return selected

    def values(self, sid, start, end, columns):
        ref = f'{sid}!A{start}:{column_name(columns)}{end}'
        data = self.api(f'sheets/v2/spreadsheets/{self.workbook}/values/{quote(ref, safe="")}',
                        valueRenderOption='ToString', dateTimeRenderOption='FormattedString')
        region = data.get('valueRange', {})
        if (data.get('spreadsheetToken') != self.workbook or not isinstance(region, dict)
                or region.get('range') != ref or region.get('majorDimension') != 'ROWS'):
            raise DataError('飞书响应工作簿、工作表范围或行方向不匹配，拒绝同步')
        rows = region.get('values')
        revision = region.get('revision', data.get('revision'))
        if revision is None or not isinstance(rows, list) or any(not isinstance(r, list) or len(r) > columns for r in rows) or len(rows) > end - start + 1:
            raise DataError('飞书值范围或版本信息不完整')
        return rows, str(revision)

    def read(self, mappings, chunk_size=500, headers_only=False):
        selected = self.sheets(mappings)
        result = {}
        revisions = set()
        for name, sheet in selected.items():
            grid = sheet.get('grid_properties', {})
            count, columns = grid.get('row_count'), grid.get('column_count')
            if not isinstance(count, int) or not isinstance(columns, int) or count < 1 or not 1 <= columns <= 1000 or count > 100000:
                raise DataError('飞书网格大小缺失或超过安全上限，不能静默截断')
            rows = []
            for start in range(1, (1 if headers_only else count) + 1, chunk_size):
                end = 1 if headers_only else min(start + chunk_size - 1, count)
                page, revision = self.values(sheet['sheet_id'], start, end, columns)
                revisions.add(revision)
                if len(revisions) != 1:
                    raise DataError('读取期间飞书工作簿版本变化，请重新同步')
                rows.extend(page + [[] for _ in range(end - start + 1 - len(page))])
            result[name] = {'sheet_id': sheet['sheet_id'], 'title': sheet['title'],
                            'revision': revision, 'values': rows}
        if self.sheets(mappings) != selected:
            raise DataError('读取期间工作表结构变化，请重新同步')
        first = next(iter(selected.values()))
        _, latest = self.values(first['sheet_id'], 1, 1, first['grid_properties']['column_count'])
        if latest not in revisions:
            raise DataError('读取结束后工作簿版本变化，本次不提交')
        return result


def read_sources(config, client, headers_only=False):
    settings = config.data.get('master_data', {})
    mode = settings.get('mode')
    if mode == 'xlsx':
        from .xlsx_sources import read_workbook
        if not settings.get('workbook_file'):
            raise ConfigError('master_data.workbook_file 缺失')
        tables = read_workbook(config.resolve(settings['workbook_file']), settings)
        if headers_only:
            return {name: {**table, 'values': table['values'][:1]} for name, table in tables.items()}
        return tables
    if mode == 'json':
        try:
            data = json.loads(config.resolve(settings['snapshot_file']).read_text())
        except (KeyError, OSError, ValueError) as exc:
            raise ConfigError('无法读取完整原表 JSON 快照') from exc
        if not isinstance(data, dict) or set(data) != set(TABLES):
            raise ConfigError('原表 JSON 快照必须包含三张原表')
        return data
    if mode != 'feishu':
        raise ConfigError('master_data.mode 必须是 xlsx、feishu 或 json')
    token = os.environ.get(settings.get('token_env', 'FEISHU_ACCESS_TOKEN'), '')
    return FeishuReader(settings.get('workbook_token', ''), token, client).read(
        settings['tables'], headers_only=headers_only)
