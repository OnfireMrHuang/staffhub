"""Qianchuan's workbook field contract and source projection."""
from copy import deepcopy
from pathlib import Path

from scripts.utils.fields import (default_metric_fields, load_contracts,
                                 project_contract, with_collection as attach_collection)
from scripts.utils.model import ConfigError

PATH = Path(__file__).with_name('fields.json')


def contract(dataset='qianchuan_hourly'):
    try:
        return deepcopy(load_contracts(PATH)['datasets'][dataset])
    except KeyError as exc:
        raise ConfigError('千川字段契约不存在') from exc


def default_metrics(version=None):
    if version not in (None, 'qianchuan'):
        raise ConfigError('千川字段契约不接受其他广告版本')
    return default_metric_fields(contract(), 'qianchuan')


def project_fields(payload, context=None):
    return project_contract(contract(), payload, context)


def with_collection(raw, context, **kwargs):
    return attach_collection(raw, context, contract_version=load_contracts(PATH)['version'], **kwargs)


