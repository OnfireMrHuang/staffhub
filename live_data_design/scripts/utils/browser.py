"""Browser lifecycle only; URL and cookie/local-storage contracts belong to sources."""
import base64
import json
import math
import time

from .model import AuthError


def jwt_exp(value):
    try:
        payload = value.split('.')[1]
        expiry = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get('exp')
        return float(expiry) if not isinstance(expiry, bool) and math.isfinite(float(expiry)) else None
    except (ValueError, IndexError, TypeError, AttributeError):
        return None


def domain_matches(domain, host):
    return domain == host or (domain.startswith('.') and (host == domain[1:] or host.endswith(domain)))


def capture_session(config, route, profile, wait_seconds, validate, *, url, extract):
    from playwright.sync_api import sync_playwright, Error as BrowserError
    directory = config.state_dir / 'browser' / config.credential_path(route.credential).stem
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                str(directory), channel=profile.get('browser_channel', 'chrome'), headless=False)
            try:
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(url, wait_until='domcontentloaded', timeout=30000)
                deadline = time.monotonic() + wait_seconds
                while True:
                    try:
                        state = extract(context.storage_state(), profile)
                        expiry = state['expires_at']
                        if expiry is not None and expiry <= time.time() + config.settings.get('refresh_before_seconds', 1800):
                            raise AuthError('浏览器令牌即将过期，请重新登录')
                        validate(state)
                        return state
                    except AuthError:
                        if time.monotonic() >= deadline: break
                        page.wait_for_timeout(1000)
            finally:
                context.close()
    except BrowserError as exc:
        raise AuthError('无法打开系统浏览器或登录窗口已关闭，请在图形桌面执行 authorize') from exc
    raise AuthError('请通知系统管理员在半小时内完成登录，并重新执行 authorize')
