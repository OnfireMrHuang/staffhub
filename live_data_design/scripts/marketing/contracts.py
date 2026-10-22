"""The marketing workbook field contract belongs to this collector."""
from copy import deepcopy
from pathlib import Path

from scripts.utils.fields import (default_metric_fields, load_contracts,
                                 project_contract, render_views, with_collection as attach_collection)
from scripts.utils.model import ConfigError

PATH = Path(__file__).with_name('fields.json')


def contract(dataset='marketing_hourly'):
    try:
        return deepcopy(load_contracts(PATH)['datasets'][dataset])
    except KeyError as exc:
        raise ConfigError('营销字段契约不存在') from exc


def default_metrics(version='smart'):
    version = version or 'smart'
    if version not in ('smart', 'legacy'):
        raise ConfigError('营销版本仅支持 smart / legacy')
    return default_metric_fields(contract(), version)


def project_fields(payload, context=None):
    return project_contract(contract(), payload, context)


def with_collection(raw, context, **kwargs):
    return attach_collection(raw, context, contract_version=load_contracts(PATH)['version'], **kwargs)


def render_source_views():
    """Render the source-owned hourly view from its checked-in contract."""
    definitions = load_contracts(PATH)['datasets']
    base_columns = {name: ['route_id', 'product_id', 'room_id', 'source', 'account_id',
                           'stat_hour', 'observed_at', 'dimensions AS raw_dimensions', 'metrics AS raw_metrics']
                    for name in definitions}
    return render_views(definitions, base_columns)
