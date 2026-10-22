"""Lazy module lookup only. Source packages own all implementation choices."""
from importlib import import_module
from .utils.model import ConfigError, SOURCES


def get(source):
    if source not in SOURCES:
        raise ConfigError('不支持的采集来源')
    return import_module('scripts.' + source)


def make_task(source, product_id, room_id, credential, account_id='', options=None):
    return get(source).task.make_task(product_id, room_id, credential, account_id, options)
