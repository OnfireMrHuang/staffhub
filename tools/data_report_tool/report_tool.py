"""Small Ocean Engine API workbench. Run with uv run report_tool.py --help."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values
from report_profiles import (ToolError, normalize_version, report_endpoint, prepare_query,
                             get_topic_config, aweme_filter_field, add_aweme_filter)

ROOT = Path(__file__).resolve().parent
BASE_URL = "https://api.oceanengine.com"
ENDPOINTS = {
    "token": ("POST", "/open_api/oauth2/access_token/"),
    "refresh": ("POST", "/open_api/oauth2/refresh_token/"),
    "fields": ("GET", "/open_api/v3.0/report/custom/config/get/"),
    "report": ("GET", "/open_api/v3.0/report/custom/get/"),
    "qianchuan_awemes": ("GET", "/open_api/v1.0/qianchuan/aweme/authorized/get/"),
}
SECRET_KEYS = {"secret", "app_secret", "auth_code", "access_token", "refresh_token", "access-token"}
SECRET_KEYS |= {'qianchuan_' + key for key in tuple(SECRET_KEYS)}


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: "***" if k.lower() in SECRET_KEYS else redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def load_config(path: Path, version: str = 'smart') -> dict[str, str]:
    file_values = dotenv_values(path, interpolate=False) if path.exists() else {}
    result = {}
    prefix = 'qianchuan_' if normalize_version(version) == 'qianchuan' else ''
    for key in ("app_id", "app_secret", "auth_code", "access_token"):
        # Either spelling in the process environment overrides either spelling in .env.
        value = next((source[name] for source in (os.environ, file_values)
                      for name in (prefix + key, (prefix + key).upper()) if name in source), None)
        if value:
            result[key] = value.strip()
    return result


def token_cache_path(env: Path, version: str) -> Path:
    name = 'qianchuan-token.json' if normalize_version(version) == 'qianchuan' else 'token.json'
    return env.resolve().parent / '.cache' / name


def read_json(path: Path) -> dict:
    def invalid_constant(value):
        raise ValueError(f"非法 JSON 数值: {value}")
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"), parse_constant=invalid_constant)
    except (OSError, ValueError) as error:
        raise ToolError(f"无法读取 JSON 文件 {path}: {error}") from error
    if not isinstance(value, dict):
        raise ToolError(f"JSON 文件顶层必须是对象: {path}")
    return value


def write_json(path: Path, value: dict) -> None:
    """Atomic replacement, with private permissions even when replacing an old file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".report-", delete=False) as file:
            name = file.name
            json.dump(value, file, ensure_ascii=False, indent=2, allow_nan=False)
            file.write("\n")
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def request_parts(command: str, params: dict, token: str | None = None, version: str = 'smart') -> dict:
    method, path = ENDPOINTS[command]
    if command in ('fields', 'report'):
        path = report_endpoint(command, normalize_version(version))
    headers = {"Accept": "application/json"}
    result = {"method": method, "url": BASE_URL + path, "headers": headers}
    if method == "GET":
        headers["Access-Token"] = token or "***"
        result["params"] = {
            key: value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            for key, value in params.items() if value is not None
        }
    else:
        result["json"] = params
    return result


def create_client(timeout: float) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=False)


def api_request(client: httpx.Client, command: str, params: dict, token: str | None = None,
                version: str = 'smart') -> dict:
    try:
        response = client.request(**request_parts(command, params, token, version))
    except httpx.HTTPError as error:
        # Do not print request bodies or credential-bearing exception URLs.
        raise ToolError(f"网络请求失败（{type(error).__name__}），请检查网络或调整 --timeout。") from error
    try:
        payload = response.json()
    except ValueError as error:
        raise ToolError(f"HTTP {response.status_code}: 接口返回的内容不是 JSON。") from error
    if not isinstance(payload, dict):
        raise ToolError(f"HTTP {response.status_code}: 接口响应必须是 JSON 对象。")
    if not response.is_success or payload.get("code") != 0:
        raise ToolError(
            f"HTTP {response.status_code}, code={payload.get('code', '缺失')}, "
            f"message={payload.get('message', '')}, request_id={payload.get('request_id', '')}",
            payload,
        )
    return payload


def preview_request(command: str, params: dict, version: str) -> dict:
    return {'method': 'GET', 'url': BASE_URL + report_endpoint(command, version),
            'headers': {'Access-Token': '***'}, 'params': redact(params),
            'version': version, 'credential_profile': 'qianchuan' if version == 'qianchuan' else 'marketing'}


def resolve_qianchuan_aweme(client: httpx.Client, token: str, advertiser_id: str, show_id: str) -> str:
    """Map the phone-visible Douyin handle to its internal ID, across every page."""
    ids = set()
    page = 1
    while True:
        response = api_request(client, 'qianchuan_awemes',
            {'advertiser_id': advertiser_id, 'page': page, 'page_size': 100}, token, 'qianchuan')
        data = response.get('data')
        if not isinstance(data, dict) or not isinstance(data.get('aweme_id_list'), list):
            raise ToolError('千川授权抖音号列表响应格式无效。')
        for row in data['aweme_id_list']:
            if not isinstance(row, dict):
                raise ToolError('千川授权抖音号记录格式无效。')
            if str(row.get('aweme_show_id')) == show_id:
                internal = row.get('aweme_id')
                if isinstance(internal, bool) or not isinstance(internal, (str, int)) or not str(internal).isdigit():
                    raise ToolError('匹配的千川抖音号缺少有效内部ID。')
                ids.add(str(internal))
        info = data.get('page_info')
        total = info.get('total_page') if isinstance(info, dict) else None
        if isinstance(total, bool) or not isinstance(total, int) or total < 0:
            raise ToolError('千川授权抖音号列表缺少有效 total_page，无法确认唯一匹配。')
        if page >= total:
            break
        if page >= 1000:
            raise ToolError('千川授权抖音号列表超过1000页，停止以避免无限分页。')
        page += 1
    if len(ids) != 1:
        raise ToolError(f'千川账户的授权抖音号列表中，{show_id} 匹配到 {len(ids)} 个内部ID，无法唯一定位主播。')
    return next(iter(ids))


def scoped_report(params: dict, fields: dict, aweme: str, version: str,
                  client: httpx.Client | None = None, token: str | None = None) -> dict:
    config = get_topic_config(fields, params['data_topic'])
    field, internal_id = aweme_filter_field(config, version)
    if internal_id:
        if client is None:
            raise ToolError('该千川主题只能按内部主播ID筛选；离线预览不能将手机端抖音号直接当作内部ID，请联网查询以自动匹配。')
        aweme = resolve_qianchuan_aweme(client, token, params['advertiser_id'], aweme)
    return add_aweme_filter(params, config, field, aweme)


class TokenManager:
    def __init__(self, config: dict[str, str], cache: Path, client: httpx.Client):
        self.config, self.cache, self.client = config, cache, client

    def cached(self) -> dict:
        if not self.cache.exists():
            return {}
        saved = read_json(self.cache)
        if saved.get("app_id") != self.config.get("app_id"):
            return {}
        return saved

    def credentials(self) -> dict:
        for key in ("app_id", "app_secret"):
            if not self.config.get(key):
                raise ToolError(f"缺少 {key}，请配置 .env（参考 .env.example）。")
        try:
            app_id = int(self.config["app_id"])
            if app_id <= 0:
                raise ValueError
        except ValueError as error:
            raise ToolError("app_id 必须是正整数。") from error
        return {"app_id": app_id, "secret": self.config["app_secret"]}

    def save(self, response: dict) -> str:
        data = response.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("access_token"), str) or not data["access_token"]:
            raise ToolError("token 响应缺少 data.access_token，未更新缓存。")
        try:
            expires_in = float(data["expires_in"])
            if not math.isfinite(expires_in) or expires_in <= 0:
                raise ValueError
        except (KeyError, ValueError, TypeError) as error:
            raise ToolError("token 响应缺少有效 expires_in，未更新缓存。") from error
        saved = {**data, "app_id": self.config["app_id"], "expires_at": time.time() + expires_in}
        write_json(self.cache, saved)
        return data["access_token"]

    def exchange(self) -> str:
        body = self.credentials()
        if not self.config.get("auth_code"):
            raise ToolError("缺少 auth_code，请获取新的授权码并配置 .env。")
        body["auth_code"] = self.config["auth_code"]
        return self.save(api_request(self.client, "token", body))

    def refresh(self) -> str:
        body = self.credentials()
        cached = self.cached()
        if not cached.get("refresh_token"):
            raise ToolError("缓存中没有 refresh_token，请配置新的 auth_code 并执行 token --force。")
        body["refresh_token"] = cached["refresh_token"]
        return self.save(api_request(self.client, "refresh", body))

    def get(self) -> str:
        if self.config.get("access_token"):
            return self.config["access_token"]
        cached = self.cached()
        if not cached:
            return self.exchange()
        try:
            valid = float(cached.get("expires_at", 0)) > time.time() + 60
        except (TypeError, ValueError):
            valid = False
        if valid and isinstance(cached.get("access_token"), str) and cached["access_token"]:
            return cached["access_token"]
        return self.refresh()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="巨量引擎报表查询工具（Python + uv）")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command, help_text in (("token", "获取/复用访问 token"), ("refresh", "刷新缓存中的 token"),
                               ("fields", "获取可用指标和维度"), ("report", "查询一页自定义报表")):
        sub = subparsers.add_parser(command, help=help_text)
        sub.add_argument('--version', help='smart/legacy/qianchuan，或巨量营销-智擎版/巨量营销-旧版/巨量千川')
        sub.add_argument("--env", type=Path, default=ROOT / ".env", help="凭据文件，默认工具目录/.env")
        sub.add_argument("--cache", type=Path, help="token 缓存；默认 .env 同目录/.cache/，营销和千川分别保存")
        sub.add_argument("--timeout", type=float, default=30, help="网络超时秒数，默认 30")
        if command == "token":
            sub.add_argument("--force", action="store_true", help="使用新的 auth_code 重新换取 token")
        if command in ("fields", "report"):
            sub.add_argument("--params", type=Path, help="请求参数 JSON 文件；report 必填")
            sub.add_argument('--advertiser-id', help='投放账户ID，覆盖 JSON 中的值')
            sub.add_argument('--data-topic', help='覆盖默认数据主题')
            sub.add_argument('--aweme-id', '--room-id', dest='aweme_id', help='手机端抖音号（不是直播场次ID）')
            sub.add_argument('--fields-config', type=Path, help='该账户/版本/主题的字段配置响应，用于离线过滤校验')
            sub.add_argument("--output", type=Path, help="保存完整响应 JSON，API 错误响应也保存")
            sub.add_argument("--dry-run", action="store_true", help="只预览请求，不鉴权、不联网")
            sub.add_argument("--verbose", action="store_true", help="在 stderr 输出脱敏请求")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if not math.isfinite(args.timeout) or args.timeout <= 0:
            raise ToolError("--timeout 必须是大于 0 的有限数字。")
        version = normalize_version(args.version)
        aweme = None
        if args.command in ("fields", "report"):
            if args.command == 'report' and not args.params:
                raise ToolError('report 需要 --params 指定指标、维度和时间范围。')
            version, params, aweme = prepare_query(args.command, read_json(args.params) if args.params else {},
                version=args.version, advertiser_id=args.advertiser_id, aweme_id=args.aweme_id, data_topic=args.data_topic)
            if aweme and args.dry_run and not args.fields_config:
                raise ToolError('指定抖音号的离线预览需要 --fields-config；先执行 fields 保存该主题配置。')
            if args.dry_run:
                if aweme:
                    params = scoped_report(params, read_json(args.fields_config), aweme, version)
                preview = preview_request(args.command, params, version)
                print(json.dumps(preview, ensure_ascii=False, indent=2))
                return 0
        config = load_config(args.env, version)
        if version == 'qianchuan' and not config:
            raise ToolError('缺少千川凭据：请在 .env 配置 qianchuan_app_id、qianchuan_app_secret、qianchuan_auth_code，或 qianchuan_access_token。')
        cache = args.cache or token_cache_path(args.env, version)
        with create_client(args.timeout) as client:
            manager = TokenManager(config, cache, client)
            if args.command in ("token", "refresh"):
                if args.command == "refresh":
                    manager.refresh()
                elif args.force:
                    manager.exchange()
                else:
                    manager.get()
                print(json.dumps({"ok": True, "source": "env" if config.get("access_token")
                                  and args.command == "token" and not args.force else str(cache)}, ensure_ascii=False))
                return 0
            token = manager.get()
            if aweme:
                fields = read_json(args.fields_config) if args.fields_config else api_request(client, 'fields',
                    {'advertiser_id':params['advertiser_id'], 'data_topics':[params['data_topic']]}, token, version)
                params = scoped_report(params, fields, aweme, version, client, token)
            if args.verbose:
                print(json.dumps(preview_request(args.command, params, version), ensure_ascii=False, indent=2), file=sys.stderr)
            payload = api_request(client, args.command, params, token, version)
        if args.output:
            write_json(args.output, payload)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except (ToolError, OSError) as error:
        if isinstance(error, ToolError) and error.response is not None and getattr(args, "output", None):
            try:
                write_json(args.output, redact(error.response))
            except OSError as write_error:
                print(f"保存错误响应失败: {write_error}", file=sys.stderr)
        print(f"错误: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
