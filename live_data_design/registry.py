"""Scheduler adapter: bind business ownership around independent source tasks."""
from importlib import import_module
from scripts.utils.model import ConfigError, SOURCES
from scripts.utils.tasks import hash_value, text


def get(source):
    if source not in SOURCES:raise ConfigError('不支持的采集来源')
    return import_module('scripts.'+source)


def make_task(source, product_id, room_id, credential, account_id='', options=None):
    from catalog.model import Route
    route=Route('pending',text(product_id,'product_id'),text(room_id,'room_id'),source,credential,account_id,options or {})
    task=route.collector_task
    identity='plan-'+hash_value([route.product_id,route.room_id,task.task_id])
    return Route(identity,route.product_id,route.room_id,source,credential,task.account_id,route.options)
