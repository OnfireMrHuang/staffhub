"""Read Ping An's dashboard APIs using the same parameters as its frontend.

Python 3.10+; collection itself needs only the standard library.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
ORIGIN = "https://open.health.pingan.com"
CHINA = timezone(timedelta(hours=8))
ENDPOINTS = {
    "title": "obtainTikTokBoardTitle",
    "summary": "queryCommonRealtimeTargets",
    "offline": "queryCommonOfflineTargets",
    "funnel": "obtainTikTokBoardFunnel",
    "orders": "orderInfo",
}
STATUSES = {1: "新建", 10: "审核中", 20: "待支付", 21: "已支付", 30: "已确认", 90: "已超时", 99: "已关闭", 100: "已完成"}
METRICS = {
    "validPolicyCnt": "保单数（件）", "annualPremium": "年化保费（元）",
    "orderCnt": "订单数（件）", "calcBindCardRate": "绑卡率（%）",
    "calcSurrenderRate": "保单退保率（%）", "undwrtPremium": "当日投保保费（元）",
    "undwrtPremiumAnnual": "当日投保保费-年缴（元）",
    "undwrtPremiumMonthly": "当日投保保费-月缴（元）", "annualPolRate": "年缴单占比（%）",
    "multiApplicantPolRate": "多人单占比（%）", "bindPolicyCnt": "绑卡保单数（件）",
}
FUNNEL = {"ctr": "外层点击率", "liveDuration60sUCountToLiveWatchUCountRate": "超一分钟观看率",
          "liveComponentCtr": "组件点击率", "orderCommitRate": "订单提交率", "policyTransRate": "保单转化率"}


class CollectionError(RuntimeError):
    pass


class LoginExpired(CollectionError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def write_json(path: Path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def load_token(session_path: Path):
    token = os.environ.get("PINGAN_TOKEN", "").strip()
    if not token:
        try:
            token = json.loads(session_path.read_text(encoding="utf-8-sig")).get("token", "").strip()
        except (OSError, ValueError, AttributeError) as exc:
            raise LoginExpired("未找到有效登录态。请运行 npm run login 后重试。") from exc
    if not token:
        raise LoginExpired("登录态为空。请运行 npm run login。")
    return token


class Client:
    def __init__(self, token, channel, timeout=20, retries=2):
        self.token, self.channel = token, channel
        self.timeout, self.retries = timeout, retries
        self.opener = urllib.request.build_opener(NoRedirect())

    def post(self, endpoint, data):
        if endpoint not in ENDPOINTS:
            raise CollectionError("只允许调用已确认的看板查询接口。")
        for attempt in range(self.retries + 1):
            request_id = str(time.time_ns() // 1_000_000)
            request = urllib.request.Request(
                f"{ORIGIN}/web/merchant/board/{ENDPOINTS[endpoint]}",
                data=json.dumps({"data": data, "requestId": request_id}).encode("utf-8"),
                headers={"Content-Type": "application/json", "X-Access-Token": self.token,
                         "requestId": request_id, "Origin": ORIGIN,
                         "Referer": f"{ORIGIN}/v2/home?merchantChannel={self.channel}"},
                method="POST",
            )
            try:
                with self.opener.open(request, timeout=self.timeout) as response:
                    result = json.load(response)
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403):
                    raise LoginExpired("登录失效或无权限，请运行 npm run login。") from exc
                if exc.code not in (429, 500, 502, 503, 504) or attempt == self.retries:
                    raise CollectionError(f"{endpoint} 查询失败，HTTP {exc.code}") from exc
                time.sleep(2 ** attempt)
                continue
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                if attempt == self.retries:
                    raise CollectionError(f"{endpoint} 网络请求失败，重试已耗尽。") from exc
                time.sleep(2 ** attempt)
                continue
            except ValueError as exc:
                raise CollectionError(f"{endpoint} 返回内容不是 JSON。") from exc
            if not isinstance(result, dict):
                raise CollectionError(f"{endpoint} 返回格式发生变化。")
            if result.get("code") in (401, 403):
                raise LoginExpired("登录令牌失效或权限不足，请运行 npm run login。")
            if result.get("code") != 200 or result.get("success") is False:
                raise CollectionError(f"{endpoint} 查询失败，业务码 {result.get('code')}。")
            return result
        raise CollectionError("请求失败。")


def percent(numerator, denominator):
    if not numerator or not denominator:
        return "0"
    value = (Decimal(str(numerator)) * 100 / Decimal(str(denominator))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{value.normalize():f}%"


def display_metrics(row):
    values = dict(row)
    values.update({
        "calcBindCardRate": percent(row.get("bindPolicyCnt"), row.get("validPolicyCnt")),
        "calcSurrenderRate": percent(row.get("surrenderPolicyCnt"), row.get("validPolicyCnt")),
        "annualPolRate": percent(row.get("annualPolicyCnt"), row.get("validPolicyCnt")),
        "multiApplicantPolRate": percent(row.get("multiApplicantCnt"), row.get("allApplicantCnt")),
    })
    for field in ("annualPremium", "undwrtPremium"):
        if field in values:
            values[field] = int(Decimal(str(values[field] or 0)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    # These three values are rendered as literal dashes by the current frontend.
    return {"GMV简易ROI": "-", "业绩ROI": "-", "投放消耗(元)": "-",
            **{label: values.get(field) for field, label in METRICS.items()}}


def collect_orders(client, base, statuses, raw_dir, name, max_pages=10000, pause=0.25):
    records, seen_pages = [], set()
    expected = None
    for page in range(1, max_pages + 1):
        payload = {**base, "orderStatusList": statuses, "pageIndex": page,
                   "pageSize": 10, "sortKey": "updated_date", "sortMode": "desc"}
        response = client.post("orders", payload)
        write_json(raw_dir / f"orders_{name}_{page:05d}.json", response)
        data = response.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("orderInfoList"), list):
            raise CollectionError(f"{name} 订单响应格式发生变化。")
        rows = data["orderInfoList"]
        try:
            total = int(data["totalCount"])
            total_pages = int(data["totalPage"])
        except (KeyError, ValueError, TypeError) as exc:
            raise CollectionError(f"{name} 缺少有效分页信息。") from exc
        if total < 0 or total_pages < 0:
            raise CollectionError("分页信息不能为负数。")
        if expected is None:
            expected = total
        if total != expected:
            raise CollectionError(f"{name} 采集期间总数变化，需重新采集，避免漏单。")
        fingerprint = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
        if rows and fingerprint in seen_pages:
            raise CollectionError(f"{name} 接口返回重复页，采集已停止。")
        seen_pages.add(fingerprint)
        records.extend(rows)
        if page % 10 == 0:
            print(f"{name}: 已读取 {page} 页，{len(records)}/{expected} 条", flush=True)
        if not rows or page >= total_pages:
            if len(records) != expected:
                raise CollectionError(f"{name} 数量不完整：读取 {len(records)}，接口总数 {expected}。")
            return {"totalCount": expected, "pagesRead": page, "statuses": statuses, "records": records}
        if pause:
            time.sleep(pause)
    raise CollectionError(f"{name} 超过页数上限 {max_pages}，结果不完整。")


def csv_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    text = str(value)
    if isinstance(value, str) and text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def write_csv(path, rows, fields):
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: csv_value(row.get(field)) for field in fields})


def export_csv(run_dir, snapshot):
    metrics = [{"分区": "数据概况", "指标": key, "值": value}
               for key, value in snapshot["displayMetrics"].items()]
    metrics += [{"分区": "漏斗数据", "指标": key, "值": value} for key, value in snapshot["displayFunnel"].items()]
    write_csv(run_dir / "metrics.csv", metrics, ["分区", "指标", "值"])
    rows = []
    for group, data in snapshot["orders"].items():
        for order in data["records"]:
            applicant = order.get("applicant") or {}
            rows.append({"列表": group, "产品": order.get("itemName"), "订单状态": STATUSES.get(order.get("orderStatus"), order.get("orderStatus")),
                         "下单时间": order.get("orderTime"), "更新时间": order.get("updatedDate"),
                         "保费": order.get("actualAmount"), "缴费方式": {"2": "月缴", "5": "年缴", "1": "趸缴"}.get(order.get("premType"), order.get("premType")),
                         "投保人": applicant.get("name"), "投保人年龄": applicant.get("age"),
                         "被保人": order.get("insurantList"), "postId": order.get("postId")})
    fields = ["列表", "产品", "订单状态", "下单时间", "更新时间", "保费", "缴费方式", "投保人", "投保人年龄", "被保人", "postId"]
    write_csv(run_dir / "orders.csv", rows, fields)


def parse_datetime(value):
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=CHINA) if parsed.tzinfo is None else parsed.astimezone(CHINA)


def run_once(args):
    now = datetime.now(CHINA).replace(microsecond=0)
    midnight = now.replace(hour=0, minute=0, second=0)
    start = parse_datetime(args.from_time) if args.from_time else midnight - timedelta(hours=1)
    end = parse_datetime(args.to_time) if args.to_time else now
    if start >= end:
        raise CollectionError("开始时间必须早于结束时间。")
    if end > now:
        raise CollectionError("结束时间不能晚于当前时间。")
    run_dir = Path(args.output) / datetime.now(CHINA).strftime("%Y%m%d_%H%M%S_%f")
    raw_dir = run_dir / "raw"
    raw_dir.mkdir(parents=True)
    manifest = {"complete": False, "startedAt": now.isoformat(), "channel": args.channel,
                "period": args.period, "orderFrom": start.isoformat(), "orderTo": end.isoformat(),
                "orderSort": "updated_date desc", "statusScope": args.status_scope,
                "notes": "订单为查询区间内所选状态的记录；接口查询基于更新时间，不是不可变交易快照。"}
    write_json(run_dir / "manifest.json", manifest)
    try:
        client = Client(load_token(Path(args.session)), args.channel)
        responses = {}
        responses["title"] = client.post("title", {"merchantChannelCode": args.channel})
        stat_date = now if args.period == "today" else now - timedelta(days=1)
        summary_payload = {"pageNo": 1, "pageSize": 999, "advertPlat": args.channel, "statDate": stat_date.strftime("%Y%m%d")}
        summary_endpoint = "summary"
        if args.period != "today":
            summary_endpoint = "offline"
            summary_payload["statType"] = {"week": "近七天", "month": "近三十天"}[args.period]
        responses["summary"] = client.post(summary_endpoint, summary_payload)
        responses["funnel"] = client.post("funnel", {"merchantChannelCode": args.channel,
                                                   "fromTime": midnight.strftime("%Y-%m-%d %H:%M:%S"), "toTime": now.strftime("%Y-%m-%d %H:%M:%S")})
        for key, value in responses.items():
            write_json(raw_dir / f"{key}.json", value)
        summary_rows = responses["summary"].get("data")
        funnel = responses["funnel"].get("data")
        if not isinstance(summary_rows, list) or not summary_rows or not isinstance(summary_rows[0], dict):
            raise CollectionError("汇总没有数据或响应格式变化，不能将空响应当作零业绩。")
        if not isinstance(funnel, dict):
            raise CollectionError("漏斗数据格式变化。")
        base = {"merchantChannelCode": args.channel, "fromTime": start.strftime("%Y-%m-%d %H:%M:%S"), "toTime": end.strftime("%Y-%m-%d %H:%M:%S")}
        groups = {"待支付": [10, 20], "已支付": [21, 30, 100]} if args.status_scope == "dashboard" else {"全部状态": sorted(STATUSES)}
        orders = {}
        for name, statuses in groups.items():
            orders[name] = collect_orders(client, base, statuses, raw_dir, name, args.max_pages)
            print(f"{name}: {orders[name]['totalCount']} 条，{orders[name]['pagesRead']} 页", flush=True)
        snapshot = {"collectedAt": datetime.now(CHINA).isoformat(), "room": responses["title"].get("data"),
                    "period": args.period, "summaryStatDate": stat_date.strftime("%Y%m%d"), "summaryRaw": summary_rows,
                    "displayMetrics": display_metrics(summary_rows[0]), "funnelRaw": funnel,
                    "funnelPeriod": "today", "displayFunnel": {label: (f"{funnel[field]}%" if funnel.get(field) else "/") for field, label in FUNNEL.items()},
                    "orders": orders, "orderQuery": base,
                    "realtimeChanges": {"available": False, "reason": "当前前端该组件仅定义空列表，没有数据请求。"}}
        write_json(run_dir / "snapshot.json", snapshot)
        export_csv(run_dir, snapshot)
        manifest.update(complete=True, finishedAt=datetime.now(CHINA).isoformat(),
                        orderCounts={name: data["totalCount"] for name, data in orders.items()},
                        files=["snapshot.json", "metrics.csv", "orders.csv", "raw/"])
        write_json(run_dir / "manifest.json", manifest)
        print(f"采集成功: {run_dir.resolve()}")
        return run_dir
    except Exception as exc:
        manifest.update(errorType=type(exc).__name__, error=str(exc), finishedAt=datetime.now(CHINA).isoformat())
        write_json(run_dir / "manifest.json", manifest)
        raise


def main():
    parser = argparse.ArgumentParser(description="平安看板接口采集，默认与页面今日视图一致。")
    parser.add_argument("--session", default=str(ROOT / ".secrets/pingan-session.json"))
    parser.add_argument("--output", default=str(ROOT / "导出/脚本采集"))
    parser.add_argument("--channel", default="PAJKBX")
    parser.add_argument("--period", choices=["today", "week", "month"], default="today")
    parser.add_argument("--from", dest="from_time", help="订单开始时间，例如 2026-10-14T00:00:00")
    parser.add_argument("--to", dest="to_time", help="订单结束时间，默认当前北京时间")
    parser.add_argument("--status-scope", choices=["dashboard", "all"], default="dashboard")
    parser.add_argument("--max-pages", type=int, default=10000)
    parser.add_argument("--interval", type=int, default=0, help="循环采集间隔秒数，0为单次，最小60")
    args = parser.parse_args()
    if args.max_pages < 1 or args.interval < 0 or 0 < args.interval < 60:
        parser.error("max-pages至少1；interval为0或至少60秒")
    try:
        while True:
            run_once(args)
            if not args.interval:
                return 0
            time.sleep(args.interval)
    except LoginExpired as exc:
        print(f"采集停止: {exc}", file=sys.stderr)
        return 2
    except (CollectionError, ValueError, OSError) as exc:
        print(f"采集失败: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("采集已停止。")
        return 0


if __name__ == "__main__":
    sys.exit(main())
