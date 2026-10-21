# 巨量引擎报表查询工具

Python 3.11+ / uv 工具。通过 JSON 设置维度、指标、时间和分页，通过账户ID、抖音号和巨量版本查询投放数据，保留平台原始响应。

## 版本与应用

| --version | 中文名称 | 默认主题 | 报表接口前缀 | 凭据 |
| --- | --- | --- | --- | --- |
| smart | 巨量营销-智擎版 | BASIC_DATA | /open_api/v3.0 | app_id 等 |
| legacy | 巨量营销-旧版 | STD_BASIC_DATA | 同上 | 与智擎版共用 |
| qianchuan | 巨量千川 | ECP_BASIC_DATA | /open_api/v1.0/qianchuan | qianchuan_app_id 等 |

版本参数也接受表中的中文名称。旧版主题已按本项目业务口径确认。两类接口分别在前缀后接 `/report/custom/get/`（数据）或 `/report/custom/config/get/`（字段配置）。千川默认基础报表，可通过 `--data-topic` 切换账户支持的其他主题，不将全域、实时和基础报表混成一份数据。

这里的“直播间ID”按需求指**手机端可见的抖音号**，例如 37365205524，不是业务直播间编号，也不是直播场次 room_id。`--room-id` 是 `--aweme-id` 的别名。

## 配置

以下命令在工具目录执行：

```bash
cd tools/data_report_tool
uv sync --locked
# 仅在尚无 .env 时：
cp .env.example .env
```

在已有 .env 中配置两套应用，不要用示例覆盖已有凭据：

```dotenv
# 智擎版、旧版共用营销应用
app_id=营销应用ID
app_secret=营销应用密钥
auth_code=营销应用新授权码
# access_token=可选的手动token

# 千川独立应用
qianchuan_app_id=千川应用ID
qianchuan_app_secret=千川应用密钥
qianchuan_auth_code=千川应用新授权码
# qianchuan_access_token=可选的手动token
```

支持相同名称的大写形式，如 QIANCHUAN_APP_ID。系统环境变量优先于 .env；两种来源均按版本隔离。千川**不回退使用营销凭据**。`--env` 可指定其他文件，千川仍读取 qianchuan_ 前缀。

默认缓存位于 .env 同目录的 `.cache/token.json`（营销）和 `.cache/qianchuan-token.json`（千川），校验应用ID并以0600权限保存。智擎版和旧版共享缓存。可用 `--cache` 指定其他路径，不同应用不要指定同一路径。

两类应用都支持自动刷新：首次使用授权码换取 token，缓存到期前60秒内刷新并保存轮换后的 refresh token。直接设置 access_token / qianchuan_access_token 时手动 token 优先，工具不会刷新它；删除该配置后恢复缓存机制。

```bash
uv run report_tool.py token --version smart
uv run report_tool.py token --version qianchuan
# 配置新的授权码后重新授权
uv run report_tool.py token --version smart --force
uv run report_tool.py refresh --version qianchuan
```

## 获取可分析字段

```bash
uv run report_tool.py fields --version smart --advertiser-id 1779361682132999 --output output/smart.fields.json
uv run report_tool.py fields --version legacy --advertiser-id YOUR_LEGACY_ACCOUNT_ID --output output/legacy.fields.json
uv run report_tool.py fields --version qianchuan --advertiser-id 1867684356876288 --output output/qianchuan.fields.json
```

fields 查询账户及主题配置，不接受抖音号。先查询对应主题，再选择报表的 dimensions / metrics；不要直接套用营销版35项指标到千川。

## 按账户和抖音号查询

```bash
cp examples/report.smart.json params.local.smart.json
# 编辑日期、字段后查询；命令行可覆盖账户、版本和抖音号
uv run report_tool.py report --params params.local.smart.json \
  --version smart --advertiser-id 1779361682132999 \
  --aweme-id 37365205524 --output output/smart.report.json

cp examples/report.legacy.json params.local.legacy.json
cp examples/report.qianchuan.json params.local.qianchuan.json
# 编辑旧版模板，填入实际账户ID及抖音号；编辑千川模板的日期/字段
uv run report_tool.py report --params params.local.legacy.json --output output/legacy.report.json
uv run report_tool.py report --params params.local.qianchuan.json --output output/qianchuan.report.json
```

也可以在 JSON 内指定版本和抖音号：

```json
{
  "_context": {"version": "巨量营销-智擎版", "aweme_id": "37365205524"},
  "advertiser_id": "1779361682132999",
  "dimensions": ["stat_time_day"],
  "metrics": ["stat_cost"],
  "filters": [],
  "start_time": "2026-10-18 00:00:00",
  "end_time": "2026-10-18 23:59:59",
  "order_by": [{"field": "stat_cost", "type": "DESC"}],
  "page": 1,
  "page_size": 100
}
```

_context 是工具配置，不发送给平台。ID推荐使用字符串，避免超长ID精度丢失；抖音号支持字母和下划线。

参数优先级：

1. CLI版本、账户、抖音号覆盖 JSON 的对应值。
2. 显式指定版本（CLI或 _context.version）会选择版本默认主题，覆盖参数文件原有 data_topic / data_topics，避免切版本后仍查旧主题。
3. --data-topic 或 _context.data_topic 可显式覆盖版本默认主题，CLI优先。
4. 未指定版本时沿用原营销接口和 JSON 内的主题，未提供主题则默认 BASIC_DATA。原 fields/report --params 用法继续可用。

## 主播过滤

指定抖音号时默认先获取当前账户、主题的字段配置：

- 支持营销 data.list / filter_able 和千川 data.custom_config_datas / filterable 两种结构。
- 优先使用可筛选的手机端抖音号字段，例如营销 aweme_id、千川 anchor_show_id / aweme_show_id；根据返回的 type、operator 构造精确匹配条件。
- 千川只提供内部 aweme_id / anchor_id 时，分页调用 `/open_api/v1.0/qianchuan/aweme/authorized/get/`，按 aweme_show_id 精确匹配并取得内部 aweme_id。缺少唯一匹配时报错，不将手机端号码当作内部ID；此步骤需要授权抖音号列表权限。
- 保留其他 filters；已有主播条件冲突时报错，相同条件不重复添加。
- 校验请求字段、必选维度及声明的互斥关系。不支持或无法安全过滤时停止，不静默删除过滤条件或退回全账户查询。

不指定抖音号时保持原有账户级调试行为，由上游校验字段。报表仅取 page 指定的一页，需根据 data.page_info 自行翻页；授权抖音号列表的自动翻页仅用于唯一匹配主播。

## 离线预览

```bash
# 不指定主播时直接预览
uv run report_tool.py report --params examples/report.json --version legacy --dry-run

# 指定主播时，提供同账户、同主题的字段响应
uv run report_tool.py report --params params.local.smart.json --fields-config output/smart.fields.json --dry-run
```

--dry-run 不读取凭据、不联网、不更新 token，输出脱敏请求、版本和凭据配置名称。字段响应不含账户ID，需要用户保证 --fields-config 来自同一账户和当前主题。千川需要在线解析内部ID时，离线预览会明确报错。

--fields-config 也可用于正式查询以跳过元数据请求；不会替代真实报表数据。--verbose 输出最终脱敏请求到 stderr；--timeout 60 可调整超时。错误保留 code、message、request_id，指定 --output 时保存错误响应；不会自动重试授权码交换。

## 试点表格

本次读取 docs/直播数据管理设计方案/第一期试点直播间产品 .xlsx：16个账户中，12个智擎版、4个千川，尚无标注旧版的账户。`examples/pilot_accounts.json` 保存账户、版本、产品、直播间及已有抖音号供填参参考。工具不依赖静态清单，不会自动按名称判断版本。

众安风车4个账户的抖音号为 37365205524，黄车4个账户为 66160988329。平安两个直播间的8个账户未填写抖音号，清单保留 null，需业务补齐；不以“1号直播间”“2号直播间”或看板渠道号代替抖音号。

## 测试与接口依据

```bash
uv run python -m unittest discover -s . -v
```

测试通过 HTTP 模拟响应覆盖版本路由、凭据隔离、token获取/刷新、两种配置结构、主播过滤、千川内部ID匹配及分页、冲突校验、离线预览和旧用法兼容。

接口路径、参数及枚举参考官方SDK固定版本：

- [营销自定义报表](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/api/ReportCustomGetV30Api.java)
- [营销数据主题](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/model/ReportCustomGetV30DataTopic.java)
- [千川自定义报表](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/api/QianchuanReportCustomGetV10Api.java)
- [千川字段配置](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/api/QianchuanReportCustomConfigGetV10Api.java)
- [千川数据主题](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/model/QianchuanReportCustomGetV10DataTopic.java)
- [千川授权抖音号列表](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/api/QianchuanAwemeAuthorizedGetV10Api.java)

实际字段以对应账户当前主题的 fields 响应为准。
