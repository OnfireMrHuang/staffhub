"""Private credential state and reusable OAuth/browser renewal lifecycles."""
import json
import math
import os
from pathlib import Path
import tempfile
import time

from filelock import FileLock, Timeout
import httpx

from .model import AuthError, BusyError


def private_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def read_state(path):
    path = Path(path)
    if not path.exists(): return {}
    try:
        value = json.loads(path.read_text())
        if not isinstance(value, dict): raise ValueError
        return value
    except (OSError, ValueError) as exc:
        raise AuthError('凭据缓存损坏，请重新授权') from exc


def future_expiry(value, threshold):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value > time.time() + threshold)


class BaseAuth:
    source = None
    oauth = False

    def __init__(self, config, client=None, probe=None, capture=None):
        self.config = config
        self.client = client or httpx.Client(timeout=config.settings.get('timeout_seconds', 30), follow_redirects=False)
        self.probe = probe or self._probe
        self.capture = capture

    def _probe(self, route, state):
        raise NotImplementedError('各采集器必须实现自己的权限探测')

    def _validate_profile(self, profile):
        """Source modules may validate their own profile keys here."""

    def _renew(self, route, profile, old, wait_seconds):
        raise NotImplementedError('认证类型必须实现续期')

    def ensure(self, route, renew=False, wait_seconds=15, force=False):
        profile = self.config.credentials.get(route.credential)
        if (route.source != self.source or not isinstance(profile, dict)
                or profile.get('source') != self.source):
            raise AuthError('采集器来源、任务来源与凭据来源不匹配')
        self._validate_profile(profile)
        if self.oauth and profile.get('app_id'):
            if self.env(profile)['app_id'] != str(profile['app_id']):
                raise AuthError('环境变量 APP_ID 与同步原表关联的应用不一致')
        path = self.config.credential_path(route.credential)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            with FileLock(str(path) + '.lock', timeout=0):
                old = read_state(path)
                if old.get('source') is not None and old['source'] != self.source:
                    raise AuthError('缓存来源与当前凭据来源不一致，请使用独立凭据别名')
                if self.oauth and old and old.get('app_id') != self.env(profile)['app_id']:
                    raise AuthError('缓存 app_id 与当前应用不一致')
                threshold = self.config.settings.get('refresh_before_seconds', 1800) if renew else 0
                expiry = old.get('expires_at')
                valid = bool(old) and (future_expiry(expiry, threshold)
                                     or (not self.oauth and expiry is None and not renew))
                if valid and not force:
                    try:
                        scope = self.probe(route, old)
                        return {**old, 'scope_status': scope if isinstance(scope, str) else 'verified'}
                    except AuthError:
                        if not renew: raise
                if not renew:
                    raise AuthError('授权缺失或过期，请执行 auth-maintain / authorize')
                new = self._renew(route, profile, old, wait_seconds)
                if not isinstance(new, dict) or new.get('source') != self.source:
                    raise AuthError('授权返回的会话来源无效')
                # Save OAuth rotations before account scope probing, which may fail independently.
                private_json(path, new)
                scope = self.probe(route, new)
                return {**new, 'scope_status': scope if isinstance(scope, str) else 'verified'}
        except Timeout as exc:
            raise BusyError('该凭据正在更新，请稍后重试') from exc


class OAuthAuth(BaseAuth):
    oauth = True

    def _validate_profile(self, profile):
        if not isinstance(profile.get('env_prefix'), str) or not profile['env_prefix']:
            raise AuthError('OAuth 凭据需要独立 env_prefix')

    def env(self, profile):
        self._validate_profile(profile)
        values = {}
        if profile.get('env_file'):
            from dotenv import dotenv_values
            values = dotenv_values(self.config.resolve(profile['env_file']), interpolate=False)
        prefix = profile['env_prefix']
        return {key: os.environ.get(prefix + key.upper(), values.get(prefix + key.upper(), ''))
                for key in ('app_id', 'app_secret', 'auth_code')}

    def exchange(self, profile, old):
        env = self.env(profile)
        if not str(env['app_id']).isdigit() or int(env['app_id']) <= 0 or not env['app_secret']:
            raise AuthError('缺少此凭据的 APP_ID / APP_SECRET')
        body = {'app_id': int(env['app_id']), 'secret': env['app_secret']}
        if old:
            if old.get('app_id') != env['app_id']:
                raise AuthError('缓存应用 ID 不匹配，请核对配置或使用新的凭据别名')
            if not old.get('refresh_token'):
                raise AuthError('缓存缺少 refresh_token；需要重新授权并更换凭据别名')
            body['refresh_token'] = old['refresh_token']
            action = 'refresh_token'
        else:
            if not env['auth_code']: raise AuthError('首次授权需要 AUTH_CODE')
            body['auth_code'] = env['auth_code']
            action = 'access_token'
        try:
            response = self.client.post('https://api.oceanengine.com/open_api/oauth2/' + action + '/', json=body)
            payload = response.json()
            data = payload.get('data', {})
            lifetime = float(data.get('expires_in', 0))
            if (not response.is_success or payload.get('code') != 0
                    or not isinstance(data.get('access_token'), str) or not data['access_token']
                    or not math.isfinite(lifetime) or lifetime <= 0):
                raise ValueError
            refresh = data.get('refresh_token') or old.get('refresh_token')
            if not isinstance(refresh, str) or not refresh: raise ValueError
        except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
            raise AuthError('OAuth 授权/刷新失败；原缓存保留，需核对应用或重新获取授权码') from exc
        return {'source': self.source, 'app_id': env['app_id'], 'access_token': data['access_token'],
                'refresh_token': refresh, 'expires_at': time.time() + lifetime}

    def _renew(self, route, profile, old, wait_seconds):
        return self.exchange(profile, old)


class BrowserAuth(BaseAuth):
    oauth = False

    def _capture(self, config, route, profile, wait_seconds, validate):
        raise NotImplementedError('各浏览器来源必须实现自己的会话提取')

    def _renew(self, route, profile, old, wait_seconds):
        capture = self.capture or self._capture
        return capture(self.config, route, profile, wait_seconds, lambda state: self.probe(route, state))
