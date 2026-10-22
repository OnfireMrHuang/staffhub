"""Read the supplied workbook layout without executing formulas or exporting secrets."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
import re
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile
from scripts.utils.model import ConfigError

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
RID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
TITLES = {'accounts': '产品账户信息', 'applications': '巨量引擎应用信息', 'backends': '产品统计后台信息'}
ACCOUNT_HEADERS = ['product_id', 'room_id', 'product_name', 'room_name', 'advertiser_id', 'account_name', 'account_type', 'stat_platform', 'app_id', 'account_scope', 'aweme_id']
BACKEND_HEADERS = ['product_id', 'room_id', 'product_name', 'room_name', 'source', 'selector', 'platform']


def _coordinate(ref):
    match = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', ref)
    if not match: raise ConfigError('Excel 单元格坐标无效')
    col = 0
    for char in match[1]: col = col * 26 + ord(char) - 64
    row = int(match[2])
    if row > 100000 or col > 1000: raise ConfigError('Excel 范围超过导入上限')
    return row, col


def _xml(archive, name):
    raw = archive.read(name)
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ConfigError('Excel XML 不允许外部实体')
    return ET.fromstring(raw)


def _grid(tree, strings):
    cells = {}
    for cell in tree.findall('s:sheetData/s:row/s:c', NS):
        pos = _coordinate(cell.get('r', ''))
        if pos in cells: raise ConfigError('Excel 出现重复单元格坐标')
        if cell.find('s:f', NS) is not None: raise ConfigError('基础配置中不接受公式，请导出已确认的静态值')
        value = cell.find('s:v', NS)
        value = '' if value is None or value.text is None else value.text
        kind = cell.get('t')
        if kind == 's':
            try: value = strings[int(value)]
            except (ValueError, IndexError): raise ConfigError('Excel 共享文本索引无效') from None
        elif kind == 'inlineStr': value = ''.join(n.text or '' for n in cell.findall('s:is//s:t', NS))
        elif kind == 'e': raise ConfigError('Excel 基础配置含错误单元格')
        cells[pos] = value.strip()
    expanded = set()
    for merge in tree.findall('s:mergeCells/s:mergeCell', NS):
        span = merge.get('ref', '').split(':')
        if len(span) != 2: raise ConfigError('Excel 合并范围无效')
        r1,c1 = _coordinate(span[0]); r2,c2 = _coordinate(span[1])
        if r2 < r1 or c2 < c1 or (r2-r1+1)*(c2-c1+1) > 100000: raise ConfigError('Excel 合并范围无效或过大')
        value = cells.get((r1,c1), '')
        for row in range(r1,r2+1):
            for col in range(c1,c2+1):
                pos = row,col
                if pos in expanded or (pos != (r1,c1) and cells.get(pos) not in (None,'',value)): raise ConfigError('Excel 合并范围重叠或内容冲突')
                cells[pos] = value; expanded.add(pos)
    return cells


def _required(value, label):
    if not isinstance(value,str) or not value.strip(): raise ConfigError(f'Excel 缺少 {label}；仅真实合并范围允许展开')
    return value.strip()


def _source(label):
    if label.startswith('巨量营销应用'): return 'marketing'
    if label.startswith('巨量千川应用'): return 'qianchuan'
    raise ConfigError('Excel 应用分组的平台未识别')


def _backend(value):
    urls = re.findall(r'https?://[^\s<>"\']+', value)
    if len(urls) != 1: raise ConfigError('看板地址必须包含唯一 URL')
    try:
        parsed = urlsplit(urls[0])
        invalid = parsed.scheme != 'https' or parsed.username or parsed.password or parsed.fragment or parsed.port
    except ValueError: raise ConfigError('看板 URL 格式无效') from None
    if invalid: raise ConfigError('看板 URL 格式无效')
    query = parse_qs(parsed.query, keep_blank_values=True)
    def one(name):
        values = query.get(name, [])
        if len(values) != 1 or not values[0].strip(): raise ConfigError('看板 URL 必要参数缺失或重复')
        return values[0].strip()
    if parsed.hostname == 'open.health.pingan.com' and parsed.path.rstrip('/') == '/v2/home': return 'pingan', one('merchantChannel'), 'DOUYIN'
    if parsed.hostname == 'adagent.zhongan.com' and parsed.path.rstrip('/') == '/app-live/liveStream/dashboard': return 'zhongan', one('dyNo'), one('livePlatform')
    raise ConfigError('看板 URL 主机或路径不在已支持范围内')


def _vertical(cells, allowed):
    """Discard all values except explicitly allowed public business keys."""
    groups = {}; positions = {}
    for row in sorted({r for r,c in cells}):
        label = cells.get((row,2), '')
        if label not in allowed: continue
        group = _required(cells.get((row,1), ''), '应用/后台分组')
        value = _required(cells.get((row,3), ''), '应用/后台公共字段')
        record = groups.setdefault(group,{})
        if label in record: raise ConfigError('Excel 纵向分组字段重复')
        record[label] = value; positions.setdefault(group,row)
    if not groups: raise ConfigError('Excel 纵向分组没有可导入的公共字段')
    return [(key, record, positions[key]) for key,record in groups.items()]


def read_workbook(path, settings):
    """Return three canonical tables; sensitive vertical fields never leave this adapter."""
    path = Path(path)
    try:
        before = path.read_bytes()
        if len(before) > 50 * 1024 * 1024: raise ConfigError('Excel 文件超过导入上限')
        revision = sha256(before).hexdigest()
        with ZipFile(BytesIO(before)) as archive:
            if sum(i.file_size for i in archive.infolist()) > 100 * 1024 * 1024: raise ConfigError('Excel 解压内容超过导入上限')
            strings=[]
            if 'xl/sharedStrings.xml' in archive.namelist(): strings=[''.join(n.text or '' for n in item.findall('.//s:t', NS)) for item in _xml(archive,'xl/sharedStrings.xml').findall('s:si',NS)]
            relations={r.attrib['Id']:r.attrib['Target'] for r in _xml(archive,'xl/_rels/workbook.xml.rels') if r.get('TargetMode') != 'External'}
            sheets={}
            for sheet in _xml(archive,'xl/workbook.xml').findall('s:sheets/s:sheet',NS):
                name=sheet.get('name')
                if name in sheets: raise ConfigError('Excel 工作表标题重复')
                sheets[name]=sheet
            loaded={}
            for name,default_title in TITLES.items():
                title=settings.get('tables',{}).get(name,{}).get('title',default_title)
                sheet=sheets.get(title)
                if sheet is None: raise ConfigError('Excel 缺少必需基础配置工作表')
                target=relations[sheet.attrib[RID]]
                target=target[1:] if target.startswith('/') else str(PurePosixPath('xl')/target)
                if '..' in PurePosixPath(target).parts or not target.startswith('xl/'): raise ConfigError('Excel 工作表路径无效')
                loaded[name]=(sheet.attrib['sheetId'],title,_grid(_xml(archive,target),strings))
        if path.read_bytes() != before: raise ConfigError('读取期间 Excel 文件变化，请重新同步')
    except ConfigError: raise
    except (OSError,BadZipFile,ET.ParseError,KeyError,ValueError) as exc: raise ConfigError('无法读取完整 Excel 基础配置') from exc
    def table(name,headers,rows,row_numbers):
        sid,title,_=loaded[name]
        return {'sheet_id':sid,'title':title,'revision':revision,'values':[headers]+rows,'row_numbers':row_numbers}
    applications=[]; application_rows=[]
    for group,record,row in _vertical(loaded['applications'][2],{'app_id'}):
        applications.append([record['app_id'],_source(group)]); application_rows.append(row)
    by_source={}
    for app_id,source in applications: by_source.setdefault(source,[]).append(app_id)
    known_backends={}
    for group,record,row in _vertical(loaded['backends'][2],{'看板地址'}):
        scope=_backend(record['看板地址'])
        if scope in known_backends: raise ConfigError('Excel 后台查询范围重复')
        known_backends[scope]=row
    cells=loaded['accounts'][2]
    headers={value:col for (row,col),value in cells.items() if row==1 and value}
    if len(headers) != sum(bool(value) for (row,col),value in cells.items() if row==1): raise ConfigError('Excel 账户表表头重复')
    required=['保险产品','直播间','保费看板地址','账户ID','账户名称','账户类型','账户平台']
    if any(h not in headers for h in required): raise ConfigError('Excel 账户表缺少已确认的字段列')
    accounts=[]; account_rows=[]; bindings={}; used_accounts={}
    from .master_data import platform, stable_key
    for row in sorted({r for r,c in cells if r>1}):
        record={h:cells.get((row,col),'') for h,col in headers.items()}
        if not any(record.values()): continue
        product=_required(record.get('保险产品'),'保险产品'); room=_required(record.get('直播间'),'直播间')
        account=_required(record.get('账户ID'),'账户ID'); source,_=platform(record.get('账户平台'))
        if source not in ('marketing','qianchuan'): raise ConfigError('Excel 账户平台必须是广告来源')
        scope=_backend(_required(record.get('保费看板地址'),'保费看板地址'))
        if scope not in known_backends: raise ConfigError('账户看板与后台配置没有精确匹配')
        product_id='product-'+stable_key(product); room_id='room-'+stable_key(product,room)
        if room_id in bindings and bindings[room_id][0] != scope: raise ConfigError('同一直播间存在冲突的保单后台')
        bindings[room_id]=(scope,product_id,product,room)
        app_id=record.get('应用ID','')
        if '应用ID' in headers and not app_id:
            raise ConfigError('Excel 已提供应用ID列，账户行不能留空')
        if not app_id:
            candidates=by_source.get(source,[])
            if len(candidates)!=1: raise ConfigError('Excel 账户应用缺失或不唯一')
            app_id=candidates[0]
        aweme=record.get('广告抖音号','')
        prior=used_accounts.setdefault((source,account),[])
        if any(not aweme or not old_aweme or aweme==old_aweme or room_id==old_room for old_room,old_aweme in prior): raise ConfigError('共享账户必须为各直播间提供明确且互斥的广告抖音号')
        prior.append((room_id,aweme))
        accounts.append([product_id,room_id,product,room,account,record['账户名称'],record['账户类型'],record['账户平台'],app_id,not bool(aweme),aweme]); account_rows.append(row)
    if not accounts or set(scope for scope,_,_,_ in bindings.values()) != set(known_backends): raise ConfigError('Excel 账户与后台关联不完整或有未关联后台')
    backends=[]; backend_rows=[]
    for room_id,(scope,product_id,product,room) in bindings.items():
        source,selector,backend_platform=scope
        backends.append([product_id,room_id,product,room,source,selector,backend_platform]); backend_rows.append(known_backends[scope])
    return {'accounts':table('accounts',ACCOUNT_HEADERS,accounts,account_rows),'applications':table('applications',['app_id','source'],applications,application_rows),'backends':table('backends',BACKEND_HEADERS,backends,backend_rows)}
