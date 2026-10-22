"""Marketing-specific advertiser permission probe using common OAuth rotation."""
from scripts.utils.auth import OAuthAuth
from scripts.utils.transport import Transport
from .collector import Collector


class Auth(OAuthAuth):
    source = 'marketing'

    def _probe(self, route, state):
        version = route.options.get('version', 'smart')
        topic = 'STD_BASIC_DATA' if version == 'legacy' else 'BASIC_DATA'
        Collector(Transport(self.client)).query('fields', {
            'advertiser_id': route.account_id, 'data_topics': [topic]
        }, state['access_token'], version)
        return True
