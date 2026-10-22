"""Field contracts and SQL projections owned by this source."""
from copy import deepcopy
from pathlib import Path
from decimal import localcontext
from scripts.utils.fields import decimal_value, load_contracts, project_contract, render_views
from scripts.utils.fields import with_collection as attach_collection
from scripts.utils.model import ConfigError


def contract(dataset):
    try:
        return deepcopy(load_contracts(Path(__file__).with_name('fields.json'))['datasets'][dataset])
    except KeyError as exc:
        raise ConfigError('未知来源字段契约') from exc


def _field_guard(field, raw):
    if not field.get('requires_single_summary'):
        return True
    summary = raw.get('summary', [])
    return isinstance(summary, list) and len(summary) == 1 and isinstance(summary[0], dict)


def _expression_guard(field, expression):
    if field.get('requires_single_summary'):
        return ("CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' "
                "AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 "
                f'THEN {expression} ELSE NULL END')
    return expression


def project_fields(dataset, payload, context=None):
    return project_contract(contract(dataset), payload, context, field_guard=_field_guard)


def render_source_views():
    definitions = load_contracts(Path(__file__).with_name('fields.json'))['datasets']
    base_columns = {}
    for name in definitions:
        if name.endswith('_stats'):
            base_columns[name] = ['route_id', 'product_id', 'room_id', 'source', 'source_date', 'session_id',
                                  'grain', 'observed_at', 'metrics AS raw_metrics']
        else:
            base_columns[name] = ['route_id', 'product_id', 'room_id', 'source', 'source_date', 'session_id',
                                  'first_seen_at', 'observed_at', 'payload AS raw_payload']
    return render_views(definitions, base_columns, expression_guard=_expression_guard)


_RATES = {
    'calcBindCardRate': ('bindPolicyCnt', 'validPolicyCnt'),
    'calcSurrenderRate': ('surrenderPolicyCnt', 'validPolicyCnt'),
    'annualPolRate': ('annualPolicyCnt', 'validPolicyCnt'),
    'multiApplicantPolRate': ('multiApplicantCnt', 'allApplicantCnt'),
}

def clean_pingan_summary(raw):
    """Keep raw amounts; add percentages without the legacy display rounding."""
    result = deepcopy(raw)
    for name, (numerator, denominator) in _RATES.items():
        top, bottom = decimal_value(raw.get(numerator)), decimal_value(raw.get(denominator))
        if top is None or bottom is None or bottom == 0:
            result[name] = None
        else:
            with localcontext() as ctx:
                ctx.prec = 28
                result[name] = format(top * 100 / bottom, 'f')
    return result


def with_collection(raw, context, *, derived=None, raw_row=None, source_context=None):
    version = load_contracts(Path(__file__).with_name('fields.json'))['version']
    return attach_collection(raw, context, derived=derived, raw_row=raw_row,
                             source_context=source_context, contract_version=version)
