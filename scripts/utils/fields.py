"""Source-neutral field projection. Contracts and SQL layouts are supplied by callers."""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
from functools import lru_cache
import json
from pathlib import Path
import re
from .model import DataError

_DECIMAL = re.compile(r'^[+-]?[0-9]{1,35}(?:\.[0-9]{1,30})?$')

@lru_cache(maxsize=32)
def _load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def load_contracts(path):
    return deepcopy(_load(str(Path(path).resolve())))


def default_metric_fields(contract, version):
    return [field['name'] for field in contract['fields']
            if field.get('requestable') and version in field.get('versions', [])]


def decimal_value(value):
    """Conservative DECIMAL(65,30) projection, never a lossy display conversion.

    Noncanonical number text (commas, percent signs, scientific notation), bools,
    nonfinite values and values outside the SQL decimal envelope return None.
    The original input remains present in raw JSON.
    """
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        return None
    text = str(value)
    if not _DECIMAL.fullmatch(text):
        return None
    try:
        result = Decimal(text)
        return result if result.is_finite() else None
    except InvalidOperation:
        return None


def with_collection(raw, context, *, derived=None, raw_row=None, source_context=None, contract_version=1):
    if '_collection' in raw:
        raise DataError('来源使用了保留元数据字段 _collection，需更新字段契约后采集')
    metadata = {'contract_version': contract_version, 'context': deepcopy(context)}
    if derived is not None:
        metadata['derived'] = deepcopy(derived)
    if raw_row is not None:
        metadata['raw_row'] = deepcopy(raw_row)
    if source_context is not None:
        metadata['source_context'] = deepcopy(source_context)
    return {**deepcopy(raw), '_collection': metadata}


def _get(value, path):
    for part in path:
        if isinstance(part, int):
            if not isinstance(value, list) or part < 0 or part >= len(value):
                return None
        elif not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def project_contract(definition, payload, context=None, *, field_guard=None):
    """Project either an envelope or raw payload, as specified by its owner."""
    wrapped = definition.get('row_wrapped', False)
    raw = payload.get(definition['raw_column'], payload) if wrapped else payload
    context = context if context is not None else _get(raw, ['_collection', 'context']) or {}
    result = {}
    for field in definition['fields']:
        if field['status'] == 'unsupported':
            value = None
        elif field['status'] == 'context':
            value = context.get(field['name'])
        elif field_guard is not None and not field_guard(field, raw):
            value = None
        else:
            document = payload.get(field['storage_column'], raw) if wrapped else raw
            value = _get(document, field['path'])
        if field['projection_type'] == 'decimal':
            value = decimal_value(value)
        elif field['projection_type'] == 'text':
            value = str(value) if isinstance(value, (str, int, float)) and not isinstance(value, bool) else None
            if value is not None and not value.strip():
                value = None
        result[field['name']] = deepcopy(value)
    return result

