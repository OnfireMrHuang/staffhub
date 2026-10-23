"""Qianchuan advertiser permission probe with shared OAuth token rotation."""
from scripts.utils.auth import OAuthAuth
from scripts.utils.model import now
from scripts.utils.transport import Transport
from .collector import Collector
from .parameters import request_params


class Auth(OAuthAuth):
    source = 'qianchuan'

    def _probe(self, route, state):
        day = now().date().isoformat()
        Collector(Transport(self.client)).query(
            request_params(route, day, fields=['stat_cost'], page_size=1), state['access_token'])
        return True
