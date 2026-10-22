"""Dispatch scheduler operations through each source's public execution API."""
from scripts.registry import get
from scripts.utils.runtime import error_result


class Dispatcher:
    def __init__(self, config):
        self.config = config

    def collect(self, route, window):
        try:
            return get(route.source).cli.collect_task(self.config, route, window)
        except Exception as error:
            return error_result(error, route)

    def ensure(self, route, **options):
        return get(route.source).cli.check_task(self.config, route, **options)
