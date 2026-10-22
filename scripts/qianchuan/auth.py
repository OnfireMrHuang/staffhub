"""Qianchuan advertiser permission probe with shared OAuth token rotation."""
from scripts.utils.auth import OAuthAuth
from scripts.utils.model import now
from scripts.utils.transport import Transport
from .collector import Collector


class Auth(OAuthAuth):
    source = 'qianchuan'

    def _probe(self, route, state):
        day = now().date().isoformat()
        Collector(Transport(self.client)).query('report', {
            'advertiser_id': route.account_id, 'fields': ['stat_cost'],
            'filtering': {'marketing_goal': 'LIVE_PROM_GOODS'},
            'start_date': day, 'end_date': day, 'page': 1, 'page_size': 1,
        }, state['access_token'])
        return True
