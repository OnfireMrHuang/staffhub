"""PingAn authentication keys, browser entry and channel permission probe."""
import math
import time
from urllib.parse import urlencode
from scripts.utils.auth import BrowserAuth
from scripts.utils.browser import capture_session, domain_matches, jwt_exp
from scripts.utils.model import AuthError
from scripts.utils.transport import Transport
from .collector import Collector, PINGAN


def extract_session(state, profile):
    key = profile.get('token_key')
    if not isinstance(key, str) or not key:
        raise AuthError('需配置平安实际 token_key')
    cookies = [cookie for cookie in state.get('cookies', [])
               if domain_matches(cookie.get('domain', ''), 'open.health.pingan.com')]
    local = {item['name']: item['value'] for origin in state.get('origins', [])
             if origin.get('origin') == PINGAN for item in origin.get('localStorage', [])}
    expiries = []
    storage = profile.get('token_storage', 'cookie')
    if storage == 'cookie':
        matches = [cookie for cookie in cookies if cookie.get('name') == key]
        if len(matches) != 1:
            raise AuthError('未找到唯一的平安认证 Cookie')
        token = matches[0].get('value')
        expiry = matches[0].get('expires', -1)
        if expiry != -1:
            expiries.append(expiry)
    elif storage == 'localStorage':
        token = local.get(key)
    else:
        raise AuthError('token_storage 仅支持 cookie / localStorage')
    if not isinstance(token, str) or not token or token in ('undefined', 'null'):
        raise AuthError('浏览器未找到有效平安令牌')
    expiry = jwt_exp(token)
    if expiry is not None:
        expiries.append(expiry)
    if any(isinstance(value, bool) or not isinstance(value, (int, float))
           or not math.isfinite(value) or value <= time.time() for value in expiries):
        raise AuthError('认证令牌已过期，请重新登录')
    return {'token': token, 'source': 'pingan', 'expires_at': min(expiries) if expiries else None}


class Auth(BrowserAuth):
    source = 'pingan'

    def _validate_profile(self, profile):
        if not isinstance(profile.get('token_key'), str) or not profile['token_key']:
            raise AuthError('需配置平安实际 token_key')
        if profile.get('token_storage', 'cookie') not in ('cookie', 'localStorage'):
            raise AuthError('token_storage 仅支持 cookie / localStorage')

    def _probe(self, route, state):
        return Collector(Transport(self.client)).check(route, state)

    def _capture(self, config, route, profile, wait_seconds, validate):
        url = PINGAN + '/v2/home?' + urlencode({'merchantChannel': route.options['channel']})
        return capture_session(config, route, profile, wait_seconds, validate,
                               url=url, extract=extract_session)
