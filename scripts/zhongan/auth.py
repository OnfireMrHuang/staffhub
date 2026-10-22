"""ZhongAn cookie/session extraction, login entry and visible-room probe."""
import math
import time
from urllib.parse import urlencode
from scripts.utils.auth import BrowserAuth
from scripts.utils.browser import capture_session, domain_matches, jwt_exp
from scripts.utils.model import AuthError
from scripts.utils.transport import Transport
from .collector import Collector, ZHONGAN


def _cookie_names(profile):
    names = profile.get('auth_cookie_names', [])
    if (not isinstance(names, list) or not names
            or any(not isinstance(name, str) or not name for name in names)
            or len(names) != len(set(names))):
        raise AuthError('配置众安 auth_cookie_names 后才能判定认证 Cookie')
    return names


def extract_session(state, profile):
    names = _cookie_names(profile)
    cookies = [cookie for cookie in state.get('cookies', [])
               if domain_matches(cookie.get('domain', ''), 'adagent.zhongan.com')]
    auth = [cookie for cookie in cookies if cookie.get('name') in names and cookie.get('value')]
    if set(names) != {cookie['name'] for cookie in auth}:
        raise AuthError('浏览器缺少众安认证 Cookie')
    expiries = []
    for cookie in auth:
        expiry = cookie.get('expires', -1)
        if expiry != -1:
            expiries.append(expiry)
        expiry = jwt_exp(cookie['value'])
        if expiry is not None:
            expiries.append(expiry)
    if any(isinstance(value, bool) or not isinstance(value, (int, float))
           or not math.isfinite(value) or value <= time.time() for value in expiries):
        raise AuthError('认证令牌已过期，请重新登录')
    return {'cookies': cookies,
            'origins': [origin for origin in state.get('origins', []) if origin.get('origin') == ZHONGAN],
            'source': 'zhongan', 'expires_at': min(expiries) if expiries else None}


class Auth(BrowserAuth):
    source = 'zhongan'

    def _validate_profile(self, profile):
        _cookie_names(profile)

    def _probe(self, route, state):
        return Collector(Transport(self.client)).check(route, state)

    def _capture(self, config, route, profile, wait_seconds, validate):
        url = ZHONGAN + '/app-live/liveStream/dashboard/?' + urlencode(
            {'dyNo': route.options['dy_no'], 'livePlatform': route.options.get('platform', 'DOUYIN')})
        return capture_session(config, route, profile, wait_seconds, validate,
                               url=url, extract=extract_session)
