"""Collect the two dashboard APIs using an isolated browser's authenticated state."""
from __future__ import annotations

import argparse
from datetime import date, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile
import time
from urllib.parse import urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from filelock import FileLock, Timeout as LockTimeout

from zhongan_core import CollectionError, LoginExpired, collect_orders, export_excel, response_data

ROOT = Path(__file__).resolve().parent
ORIGIN = "https://adagent.zhongan.com"
API_ROOT = "/newdmapi/lre/dashboardLiveController/"
CHINA = ZoneInfo("Asia/Shanghai")
ENDPOINTS = {
    "rooms": "getLiveDy",
    "attribute": "getLiveAttribute",
    "aggregate": "getDashboardAggregate",
    "orders": "getOrderList",
}


def private_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
        os.replace(temp, path)  # mkstemp is 0600, including before the replace.
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def dashboard_url(args):
    return ORIGIN + "/app-live/liveStream/dashboard/?" + urlencode(
        {"livePlatform": args.platform, "dyNo": args.dy_no, "startDate": args.date})


def session_from_curl(source):
    """Parse Chrome's Copy as cURL text as data; NEVER execute shell input."""
    try:
        words = shlex.split(source.replace("\\\n", ""))
    except ValueError as exc:
        raise CollectionError("cURL 文本格式无效。") from exc
    if not words or words[0] != "curl":
        raise CollectionError("请提供 Chrome 网络面板“以 cURL 格式复制”的请求文本。")
    urls = [w for w in words if w.startswith(("https://", "http://"))]
    allowed = {ORIGIN + API_ROOT + name for name in ENDPOINTS.values()}
    if len(urls) != 1 or urls[0] not in allowed:
        raise CollectionError("只允许导入众安四个查询接口的请求。")
    headers, cookie_text = {}, ""
    for i, word in enumerate(words[:-1]):
        if word in ("-H", "--header"):
            name, separator, value = words[i + 1].partition(":")
            if separator:
                headers[name.lower()] = value.strip()
        elif word in ("-b", "--cookie"):
            cookie_text = words[i + 1]
    cookie_text = cookie_text or headers.get("cookie", "")
    cookies = {}
    for item in cookie_text.split(";"):
        name, separator, value = item.strip().partition("=")
        if separator and name:
            cookies[name] = {"name": name, "value": value, "domain": urlparse(ORIGIN).hostname,
                             "path": "/", "expires": -1, "httpOnly": True,
                             "secure": True, "sameSite": "Lax"}
    if not cookies:
        raise CollectionError("请求文本没有 Cookie，无法导入登录态。")
    local = []
    for header, key in (("x-usercenter-session", "ATLANTIS_SESSION_ID"),
                        ("x-service-name", "SERVICE_NAME")):
        value = headers.get(header)
        if value and value not in ("undefined", "null"):
            local.append({"name": key, "value": value})
    return {"cookies": list(cookies.values()), "origins": [{"origin": ORIGIN, "localStorage": local}]}


def notify_expired(phone, state_path, *, gateway=None, token=None, cooldown=None):
    """Gateway contract: POST JSON -> HTTP 2xx and {"success": true}."""
    gateway = gateway if gateway is not None else os.getenv("ZHONGAN_SMS_GATEWAY_URL", "")
    token = token if token is not None else os.getenv("ZHONGAN_SMS_GATEWAY_TOKEN", "")
    cooldown = cooldown if cooldown is not None else int(os.getenv("ZHONGAN_SMS_COOLDOWN_SECONDS", "3600"))
    if not gateway:
        print("登录失效：短信网关未配置，未发送短信。请运行 login。", file=sys.stderr)
        return False
    parsed = urlparse(gateway)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
        raise CollectionError("短信网关须为 HTTPS（本机调试可用 HTTP）。")
    if cooldown < 0:
        raise CollectionError("短信冷却时间不能为负数。")
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(str(state_path) + ".lock", timeout=10):
        now = time.time()
        identity = hashlib.sha256((gateway + "|" + phone).encode()).hexdigest()
        previous = {}
        if state_path.exists():
            try:
                previous = json.loads(state_path.read_text())
            except (ValueError, OSError):
                pass
        if isinstance(previous, dict) and previous.get("identity") == identity and now - previous.get("sentAt", 0) < cooldown:
            print("登录失效提醒处于冷却期，本次未重复发送。")
            return False
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            with httpx.Client(timeout=15, follow_redirects=False) as client:
                response = client.post(gateway, headers=headers, json={
                    "phone": phone, "event": "zhongan_login_expired",
                    "message": "众安直播数据采集登录已过期，请在采集电脑运行 login 并完成人工登录。",
                })
                if not 200 <= response.status_code < 300 or response.json().get("success") is not True:
                    raise CollectionError("短信网关未确认发送成功。")
        except (httpx.HTTPError, ValueError, AttributeError) as exc:
            raise CollectionError("短信网关请求失败，未记录发送成功。") from exc
        private_json(state_path, {"identity": identity, "sentAt": now})
        print("已发送登录失效短信提醒。")
        return True


def try_notify(args):
    try:
        notify_expired(args.phone, args.session.parent / "sms-state.json")
    except (CollectionError, LockTimeout, OSError, ValueError, TypeError) as exc:
        print(f"短信通知失败：{exc}", file=sys.stderr)


class Client:
    def __init__(self, context, referer, timeout=30, pause=0.25):
        self.context, self.referer = context, referer
        self.timeout, self.pause = timeout, pause
        self.raw_dir = None
        self.counter = 0

    def post(self, endpoint, payload):
        if endpoint not in ENDPOINTS:
            raise CollectionError("仅允许已确认的查询接口。")
        headers = {"Origin": ORIGIN, "Referer": self.referer, "Accept": "application/json"}
        for origin in self.context.storage_state().get("origins", []):
            if origin["origin"] == ORIGIN:
                local = {entry["name"]: entry["value"] for entry in origin["localStorage"]}
                for key, header in (("ATLANTIS_SESSION_ID", "X-Usercenter-Session"), ("SERVICE_NAME", "X-Service-Name")):
                    if local.get(key) and local[key] not in ("undefined", "null"):
                        headers[header] = local[key]
        from playwright.sync_api import Error as PlaywrightError
        for attempt in range(3):
            try:
                response = self.context.request.post(
                    ORIGIN + API_ROOT + ENDPOINTS[endpoint], data=payload, headers=headers,
                    timeout=self.timeout * 1000, max_redirects=0)
            except PlaywrightError as exc:
                if attempt == 2:
                    raise CollectionError("查询网络失败，重试已耗尽。") from exc
                time.sleep(2**attempt)
                continue
            try:
                status = response.status
                location = response.headers.get("location", "")
                if status == 401 or (300 <= status < 400 and re.search(r"login|sso", location, re.I)):
                    raise LoginExpired("接口要求重新登录。")
                if status in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(2**attempt)
                    continue
                if not 200 <= status < 300:
                    raise CollectionError(f"{endpoint} 查询失败：HTTP {status}。")
                try:
                    raw = response.json()
                except (ValueError, PlaywrightError) as exc:
                    # Do not mislabel every HTML error page as expired authentication.
                    raise CollectionError("接口没有返回 JSON，请检查登录页或网络错误。") from exc
                data = response_data(status, raw)
                if self.raw_dir:
                    self.counter += 1
                    private_json(self.raw_dir / f"{self.counter:05d}-{endpoint}.json",
                                 {"request": payload, "response": raw})
                if self.pause:
                    time.sleep(self.pause)
                return data
            finally:
                response.dispose()
        raise CollectionError("查询失败。")


def verify_login(client, args):
    rooms = client.post("rooms", {"startDate": args.date, "livePlatform": args.platform})
    if not isinstance(rooms, list):
        raise CollectionError("直播间列表格式变化，预期 data 为列表。")
    return rooms


def save_session(context, path):
    private_json(path, context.storage_state())


def wait_for_login(page, context, client, args):
    if args.headless:
        raise LoginExpired("无头模式不能人工登录，请先运行 login。")
    if not re.fullmatch(r"1\d{10}", args.phone):
        raise LoginExpired("需要人工登录，请配置 ZHONGAN_PHONE 后运行 login。")
    page.goto(ORIGIN + "/login/?" + urlencode({"jump": dashboard_url(args)}), wait_until="domcontentloaded")
    print(f"请在独立浏览器窗口完成手机号验证码登录；等待最多 {args.login_timeout} 秒。", flush=True)
    deadline = time.monotonic() + args.login_timeout
    filled = False
    while time.monotonic() < deadline:
        if page.is_closed():
            raise LoginExpired("登录窗口已关闭。")
        if "/login" in urlparse(page.url).path:
            if not filled:
                locator = page.get_by_placeholder(re.compile("手机号|手机号码")).first
                if locator.count() and locator.is_visible():
                    locator.fill(args.phone)
                    filled = True
        else:
            try:
                verify_login(client, args)
                save_session(context, args.session)
                print("登录验证成功，Cookie 和会话状态已保存。", flush=True)
                return
            except LoginExpired:
                pass
        page.wait_for_timeout(1500)
    raise LoginExpired("等待人工登录超时，未保存无效登录态。")


def select_sessions(attribute, args):
    if not isinstance(attribute, dict):
        raise CollectionError("直播场次详情 data 格式变化。")
    sessions = []
    if attribute.get("roomId"):
        sessions.append({k: v for k, v in attribute.items() if k != "attributeOfflineDTOList"})
    offline = attribute.get("attributeOfflineDTOList") or []
    if not isinstance(offline, list) or any(not isinstance(item, dict) or not item.get("roomId") for item in offline):
        raise CollectionError("历史直播场次格式变化。")
    for item in offline:
        if str(item["roomId"]) not in {str(s["roomId"]) for s in sessions}:
            sessions.append(item)
    if not sessions:
        raise CollectionError("该直播间在指定日期没有可查询场次，本轮不更新 Excel。")
    if args.room_id:
        selected = [s for s in sessions if str(s["roomId"]) in args.room_id]
        if {str(s["roomId"]) for s in selected} != set(args.room_id):
            raise CollectionError("指定 room-id 不在该直播间当日场次中。")
        return selected
    return sessions if args.all_sessions else sessions[:1]


def collect_once(client, args):
    run_dir = args.output.parent / "raw" / datetime.now(CHINA).strftime("%Y%m%d_%H%M%S_%f")
    run_dir.mkdir(parents=True, mode=0o700)
    manifest = {"complete": False, "dyNo": args.dy_no, "date": args.date, "platform": args.platform}
    private_json(run_dir / "manifest.json", manifest)
    client.raw_dir = run_dir
    try:
        rooms = verify_login(client, args)
        room = next((r for r in rooms if isinstance(r, dict) and str(r.get("dyNo")) == args.dy_no), None)
        if room is None:
            raise CollectionError("当日列表中未找到指定 dyNo，停止采集以避免写入其他直播间。")
        attribute = client.post("attribute", {"dyNo": args.dy_no, "startDate": args.date})
        sessions = select_sessions(attribute, args)
        batches = []
        for session in sessions:
            room_id = str(session["roomId"])
            metadata = {**room, **session, "livePlatform": args.platform, "dyNo": args.dy_no,
                        "startDate": args.date, "roomId": room_id}
            base = {"livePlatform": args.platform, "dyNo": args.dy_no, "roomIdList": [room_id]}
            # The default range in the frontend removes startDate/endDate for aggregate.
            aggregate = client.post("aggregate", base)
            if not isinstance(aggregate, dict) or not aggregate:
                raise CollectionError("看板 data 为空或格式变化，本轮不写入。")
            orders = collect_orders(
                lambda payload: client.post("orders", payload),
                {**base, "startDate": args.date, "showDetail": "Y"}, args.max_pages)
            batches.append((metadata, aggregate, orders))
            print(f"场次 {room_id}：已读取 {len(orders)} 条订单。", flush=True)
        collected_at = datetime.now(CHINA).isoformat(timespec="seconds")
        export_excel(args.output, batches, collected_at)
        manifest.update(complete=True, collectedAt=collected_at, sessions=len(batches),
                        orders=sum(len(b[2]) for b in batches), workbook=str(args.output))
        private_json(run_dir / "manifest.json", manifest)
        print(f"Excel 已更新：{args.output}")
        return batches
    except Exception as exc:
        manifest.update(errorType=type(exc).__name__, error=str(exc))
        private_json(run_dir / "manifest.json", manifest)
        raise
    finally:
        client.raw_dir = None


def parser():
    load_dotenv(ROOT / ".env")
    result = argparse.ArgumentParser(description="众安看板采集：人工短信验证码登录、游标分页、Excel 增量更新")
    result.add_argument("command", choices=("login", "collect", "import-session"))
    result.add_argument("--curl-file", type=Path, help="Chrome“以 cURL 格式复制”保存的纯文本文件；只解析，不执行")
    result.add_argument("--browser-channel", choices=("chrome", "chromium"),
                        default=os.getenv("ZHONGAN_BROWSER_CHANNEL", "chrome"))
    result.add_argument("--dy-no", default=os.getenv("ZHONGAN_DY_NO", "37365205524"))
    result.add_argument("--date", default=os.getenv("ZHONGAN_DATE", ""), help="YYYY-MM-DD；不填则每轮取北京时间当天")
    result.add_argument("--platform", default=os.getenv("ZHONGAN_PLATFORM", "DOUYIN"))
    result.add_argument("--room-id", action="append", help="指定直播场次，可重复；不填则与页面默认场次一致")
    result.add_argument("--all-sessions", action="store_true", help="逐场采集该日所有直播场次")
    result.add_argument("--headless", action="store_true", help="后台运行；登录失效时通知并退出2")
    result.add_argument("--session", type=Path, default=ROOT / ".secrets/session.json")
    result.add_argument("--output", type=Path, default=ROOT / "output/zhongan.xlsx")
    result.add_argument("--interval", type=int, default=0, help="循环采集秒数，0表示仅一次，最小60")
    result.add_argument("--login-timeout", type=int, default=300)
    result.add_argument("--timeout", type=int, default=30)
    result.add_argument("--max-pages", type=int, default=10000)
    result.add_argument("--pause", type=float, default=0.25, help="查询请求间隔秒数")
    return result


def main(argv=None):
    cli = parser()
    args = cli.parse_args(argv)
    args.phone = os.getenv("ZHONGAN_PHONE", "").strip()
    if args.phone and not re.fullmatch(r"1\d{10}", args.phone):
        cli.error("ZHONGAN_PHONE 必须是11位手机号。")
    if not args.phone and (args.command == "login" or os.getenv("ZHONGAN_SMS_GATEWAY_URL")):
        cli.error("人工登录或短信提醒需要通过 ZHONGAN_PHONE 配置11位手机号。")
    if args.command == "import-session" and not args.curl_file:
        cli.error("import-session 需要 --curl-file。")
    if args.command != "import-session" and args.curl_file:
        cli.error("--curl-file 仅用于 import-session。")
    if args.command == "login" and args.headless:
        cli.error("login 需要可见浏览器，不能使用 --headless。")
    if args.room_id and args.all_sessions:
        cli.error("--room-id 与 --all-sessions 不能同时设置。")
    if args.interval < 0 or 0 < args.interval < 60 or min(args.login_timeout, args.timeout, args.max_pages) < 1 or args.pause < 0:
        cli.error("interval 为0或至少60；超时及页数须为正数；pause不能为负数。")
    fixed_date = args.date
    try:
        if fixed_date:
            date.fromisoformat(fixed_date)
    except ValueError:
        cli.error("date 必须为有效 YYYY-MM-DD 日期。")
    args.date = fixed_date or datetime.now(CHINA).date().isoformat()
    args.output, args.session = args.output.resolve(), args.session.resolve()
    args.session.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    from playwright.sync_api import Error as PlaywrightError, sync_playwright
    try:
        # Prevent a scheduler and manual login from overwriting the same session.
        with FileLock(str(args.session) + ".lock", timeout=0), sync_playwright() as playwright:
            if args.command == "import-session":
                state = session_from_curl(args.curl_file.read_text(encoding="utf-8"))
                api = playwright.request.new_context(storage_state=state)
                try:
                    from types import SimpleNamespace
                    client = Client(SimpleNamespace(request=api, storage_state=lambda: state),
                                    dashboard_url(args), args.timeout, args.pause)
                    verify_login(client, args)
                    state["cookies"] = api.storage_state()["cookies"]
                    private_json(args.session, state)
                    print(f"Chrome 登录态验证成功，已保存：{args.session}")
                finally:
                    api.dispose()
                return 0
            browser = playwright.chromium.launch(
                headless=args.headless, channel="chrome" if args.browser_channel == "chrome" else None)
            try:
                context = browser.new_context(
                    storage_state=str(args.session) if args.session.exists() else None,
                    locale="zh-CN", timezone_id="Asia/Shanghai")
                page = context.new_page()
                page.set_default_timeout(args.timeout * 1000)
                client = Client(context, dashboard_url(args), args.timeout, args.pause)
                page.goto(dashboard_url(args), wait_until="domcontentloaded")
                try:
                    if args.command == "login" and not args.session.exists():
                        raise LoginExpired("首次登录。")
                    verify_login(client, args)
                except LoginExpired:
                    if args.command != "login":
                        try_notify(args)
                    wait_for_login(page, context, client, args)
                save_session(context, args.session)
                if args.command == "login":
                    print(f"登录态已保存：{args.session}")
                    return 0
                while True:
                    args.date = fixed_date or datetime.now(CHINA).date().isoformat()
                    client.referer = dashboard_url(args)
                    page.goto(client.referer, wait_until="domcontentloaded")
                    try:
                        collect_once(client, args)
                    except LoginExpired:
                        try_notify(args)
                        wait_for_login(page, context, client, args)
                        page.goto(client.referer, wait_until="domcontentloaded")
                        collect_once(client, args)  # Restart the entire batch after reauthentication.
                    save_session(context, args.session)
                    if not args.interval:
                        return 0
                    print(f"{args.interval} 秒后再次采集。", flush=True)
                    time.sleep(args.interval)
            finally:
                browser.close()
    except LoginExpired as exc:
        # Cooldown makes this safe if an inner recovery already sent a notification.
        if args.command != "login":
            try_notify(args)
        print(f"采集停止：{exc}", file=sys.stderr)
        return 2
    except (CollectionError, PlaywrightError, OSError, ValueError, LockTimeout) as exc:
        # Never log Playwright's call log: it may contain request headers.
        message = "浏览器操作失败，请确认已安装所选 Chrome/Chromium 或检查网络。" if isinstance(exc, PlaywrightError) else str(exc)
        print(f"采集失败：{message}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("采集已停止。")
        return 0


if __name__ == "__main__":
    sys.exit(main())
