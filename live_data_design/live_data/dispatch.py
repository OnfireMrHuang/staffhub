"""Dispatch scheduler operations through each source's public execution API."""
from registry import get
from scripts.utils.runtime import error_result
from scripts.utils.config import Config
from scripts.utils.model import ConfigError
from copy import deepcopy


class Dispatcher:
    def __init__(self, config):
        self.config = config

    def task_config(self, route):
        expected = route.options.get('expected_app_id')
        if not expected:
            return self.config
        data = deepcopy(self.config.data)
        profile = data['credentials'][route.credential]
        if profile.get('app_id') and str(profile['app_id']) != str(expected):
            raise ConfigError('目录应用绑定与凭据配置不一致')
        profile['app_id'] = str(expected)
        return Config(self.config.path, data, [])

    def collect(self, route, window):
        try:
            return get(route.source).cli.collect_task(self.task_config(route), route.collector_task, window)
        except Exception as error:
            return {**error_result(error, source=route.source), 'route_id': route.route_id}

    def ensure(self, route, **options):
        return get(route.source).cli.check_task(self.task_config(route), route.collector_task, **options)
