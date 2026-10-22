"""Field contracts and SQL projections owned by this source."""
from copy import deepcopy
from pathlib import Path
from scripts.utils.fields import load_contracts, project_contract
from scripts.utils.fields import with_collection as attach_collection
from scripts.utils.model import ConfigError


def contract(dataset):
    try:
        return deepcopy(load_contracts(Path(__file__).with_name('fields.json'))['datasets'][dataset])
    except KeyError as exc:
        raise ConfigError('未知来源字段契约') from exc


def project_fields(dataset, payload, context=None):
    return project_contract(contract(dataset), payload, context)




def with_collection(raw, context, *, derived=None, raw_row=None, source_context=None):
    version = load_contracts(Path(__file__).with_name('fields.json'))['version']
    return attach_collection(raw, context, derived=derived, raw_row=raw_row,
                             source_context=source_context, contract_version=version)
