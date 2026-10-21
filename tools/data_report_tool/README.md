# 巨量引擎报表查询工具

Python 3.11+ / uv 工具。通过 JSON 设置指标、时间、筛选和分页，按账户ID、抖音号和统计平台查询投放数据，保留平台原始响应。

## 统计平台与接口

| --stat-platform（兼容 --version） | 中文名称 | 默认主题 | 报表路径 | 凭据 |
| --- | --- | --- | --- | --- |
| smart | 巨量营销-智擎版 | BASIC_DATA | /open_api/v3.0/report/custom/get/ | app_id 等 |
| legacy | 巨量营销-旧版 | STD_BASIC_DATA | 同上 | 与智擎版共用 |
| qianchuan | 巨量千川 | 无 | /open_api/v1.0/qianchuan/report/advertiser/get/ | qianchuan_app_id 等 |

统计平台参数也接受表中的中文名称。营销版继续请求 `https://api.oceanengine.com` 的自定义报表及字段配置接口；旧版主题仍为 STD_BASIC_DATA。

千川按[获取投放账户数据](https://open.oceanengine.com/labels/12/docs/1697466393573376)文档请求 `https://ad.oceanengine.com/open_api/v1.0/qianchuan/report/advertiser/get/`，使用 `fields`、`filtering`、`start_date`、`end_date`，不使用自定义报表接口或数据主题。千川拒绝 `--data-topic`、`--fields-config` 和旧模板参数，并提示迁移，不静默丢弃筛选条件。

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

缓存是持久化 JSON 文件，包含 `access_token`、`refresh_token`、`app_id`、`expires_in`、绝对过期时间 `expires_at`，以及平台返回的其他 token 信息。退出终端或重启程序不会清空；下次执行 token / fields / report 时会自动读取同一文件，有效时直接复用，不再申请新 token。首次执行正常查询即可自动创建缓存，无需单独执行 token 命令。

两类应用都支持自动刷新：首次使用授权码换取 token，缓存到期前60秒内刷新并保存轮换后的 refresh token。直接设置 access_token / qianchuan_access_token 时手动 token 优先，工具不会刷新它；删除该配置后恢复缓存机制。

缓存生成后不再依赖旧 auth_code，保留 app_id、app_secret 即可继续复用和刷新。仅在首次授权、缓存丢失或 refresh token 失效时需要新授权码；`token --force` 用于主动重新授权，日常请求不要加它。刷新失败会保留原缓存并报告错误，不自动重用已经消费过的授权码。缓存目录已被 Git 忽略。

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
uv run report_tool.py fields --stat-platform qianchuan --output output/qianchuan.fields.json
```

营销的 fields 查询账户及主题配置；根据配置选择 dimensions / metrics。千川的 fields 输出随工具提供的 `qianchuan_advertiser_fields.json` 官方文档目录（96项指标、2项原生返回维度），无需账户、凭据或联网；输出包含 `source=official_document`、`account_verified=false`、文档链接及整理日期，不代表指定账户实测支持，也不能用作营销的 `--fields-config`。

所有 fields 命令都不接受抖音号。主数据、筛选、派生等关联维度在标准表中另有说明，不应加入千川 `fields` 指标数组。

## 按账户和抖音号查询

```bash
cp examples/report.smart.json params.local.smart.json
# 编辑日期、字段后查询；命令行可覆盖账户、统计平台和抖音号
uv run report_tool.py report --params params.local.smart.json \
  --version smart --advertiser-id 1779361682132999 \
  --aweme-id 37365205524 --output output/smart.report.json

cp examples/report.legacy.json params.local.legacy.json
cp examples/report.qianchuan.json params.local.qianchuan.json
# 编辑日期与账户；千川模板默认查询账户直播投放，不限定单一抖音号
uv run report_tool.py report --params params.local.legacy.json --output output/legacy.report.json
uv run report_tool.py report --params params.local.qianchuan.json --output output/qianchuan.report.json
# 按手机端抖音号限定千川查询；工具先解析内部ID，再填 filtering.aweme_ids
uv run report_tool.py report --params params.local.qianchuan.json \
  --aweme-id 66160988329 --output output/qianchuan.aweme.report.json
```

营销参数示例（JSON 中可指定统计平台和抖音号）：

```json
{
  "_context": {"stat_platform": "巨量营销-智擎版", "aweme_id": "37365205524"},
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

_context 是工具配置，不发送给平台。推荐 `_context.stat_platform`，兼容旧名称 `_context.version`；两者冲突且无CLI覆盖时拒绝请求。ID推荐使用字符串避免精度丢失；手机端抖音号可含字母和下划线。千川 `filtering.aweme_ids` 则必须是内部数字ID数组，序列化时转成JSON整数，保持大整数精度。

参数优先级：

1. CLI统计平台、账户、手机端抖音号覆盖 JSON 对应配置；若与已有内部ID筛选冲突则报错，不自动扩大查询范围。
2. 营销版：显式指定统计平台会选择默认主题；`--data-topic` 或 `_context.data_topic` 可覆盖默认主题，CLI优先。
3. 千川：不接受主题及营销参数；切换统计平台时必须使用相应模板，不自动将 dimensions / metrics / filters 转换为另一套语义。
4. 未指定统计平台时沿用营销接口和 JSON 内的主题，未提供主题则默认 BASIC_DATA。原营销 fields/report --params 用法继续可用。

## 千川账户报表参数

```json
{
  "_context": {"stat_platform": "巨量千川"},
  "advertiser_id": "1867684356876288",
  "fields": ["stat_cost", "show_cnt", "click_cnt", "ecp_convert_cnt"],
  "filtering": {"marketing_goal": "LIVE_PROM_GOODS", "order_platform": "QIANCHUAN"},
  "start_date": "2026-10-18",
  "end_date": "2026-10-18",
  "time_granularity": "TIME_GRANULARITY_DAILY",
  "order_field": "stat_cost",
  "order_type": "DESC",
  "page": 1,
  "page_size": 100
}
```

执行前更新示例日期。`start_date` 不得早于上海时区今日前180天；工具按含首尾的查询日期数校验：日粒度最多30天、小时粒度最多7天、不传粒度时区间汇总最多180天。小时粒度使用 `TIME_GRANULARITY_HOURLY`；无月粒度。`page` 为正整数，`page_size` 为1—500。

`filtering.marketing_goal` 必填，可选 ALL / VIDEO_PROM_GOODS / LIVE_PROM_GOODS。它已不在响应中返回，若落库需要，须从请求上下文保存。`order_platform` 是下单平台，不是统计平台 `stat_platform`。工具校验文档明确的枚举以及小店随心推、搜索的筛选限制；`status` 的具体状态枚举由接口校验。

接口响应保留 `data.list`、`data.page_info` 和 `request_id`，不注入派生维度、不换算金额。新文档未明确金额单位，不能沿用旧直播接口除以100000规则。文档标记即将下线的 convert_cnt / convert_cost / convert_rate 仍可查询，目录保留标记，不擅自替换成其他归因指标。

## 主播过滤

营销版指定抖音号时先获取当前账户、主题的字段配置：

- 使用可筛选的手机端抖音号字段，如营销 aweme_id；根据配置的 type、operator 构造精确匹配条件。
- 保留其他 filters；已有主播条件冲突时报错，相同条件不重复添加。
- 校验请求字段、必选维度及声明的互斥关系。不支持或无法安全过滤时停止，不静默删除过滤条件或退回全账户查询。

千川指定 `--aweme-id` / `--room-id` 或 `_context.aweme_id` 时，分页调用 `/open_api/v1.0/qianchuan/aweme/authorized/get/`，按手机端 `aweme_show_id` 唯一匹配内部 `aweme_id`，填入 `filtering.aweme_ids`。不再调用千川自定义字段配置接口；缺失、多重匹配或与参数中的ID集合冲突时停止，不退回全账户查询。

若已掌握核验后的内部ID，可直接在参数中填写 `filtering.aweme_ids`，无需手机端抖音号或授权列表请求。其他 filtering 条件保留。多个ID表示筛选集合，响应仍按账户及时间汇总，不能将一行数据拆成多个直播间数据。

未提供抖音号筛选时查询账户范围。报表仅取 page 指定的一页，需根据 data.page_info 自行翻页；授权抖音号列表的自动翻页仅用于唯一匹配主播。

## 离线预览

```bash
# 不指定主播时直接预览
uv run report_tool.py report --params examples/report.json --version legacy --dry-run

# 指定主播时，提供同账户、同主题的字段响应
uv run report_tool.py report --params params.local.smart.json --fields-config output/smart.fields.json --dry-run

# 千川账户级预览：不联网、不鉴权
uv run report_tool.py report --params examples/report.qianchuan.json --dry-run
```

--dry-run 不读取凭据、不联网、不更新 token，输出脱敏请求、统计平台和凭据配置名称。营销 `--fields-config` 须来自同一账户和主题。千川离线预览若指定手机端抖音号会报错；取消该手机端配置并直接填写已核验的 `filtering.aweme_ids` 即可预览限定范围，不可用手机端号码冒充内部ID。

营销 --fields-config 也可用于正式查询以跳过元数据请求；不会替代真实报表数据。--verbose 输出最终脱敏请求到 stderr；--timeout 60 可调整超时。错误保留 code、message、request_id，指定 --output 时保存错误响应；不会自动重试授权码交换。

## 试点表格

本次读取 docs/直播数据管理设计方案/第一期试点直播间产品 .xlsx：16个账户中，12个智擎版、4个千川，尚无标注旧版的账户。`examples/pilot_accounts.json` 保存账户、版本、产品、直播间及已有抖音号供填参参考。工具不依赖静态清单，不会自动按名称判断版本。

众安风车4个账户的抖音号为 37365205524，黄车4个账户为 66160988329。平安两个直播间的8个账户未填写抖音号，清单保留 null，需业务补齐；不以“1号直播间”“2号直播间”或看板渠道号代替抖音号。

## 测试与接口依据

```bash
uv run python -m unittest discover -s . -v
```

测试通过 HTTP 模拟响应覆盖正确主机/路径、字段编码、凭据隔离、token获取/刷新、营销字段配置、千川内部ID匹配及分页、筛选冲突、时间边界、参数拒绝、离线目录和营销旧用法兼容。测试不调用实际账户数据接口。

营销接口及授权列表参考下列官方SDK固定版本；千川账户报表以用户指定的官方文档为准：

- [营销自定义报表](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/api/ReportCustomGetV30Api.java)
- [营销数据主题](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/model/ReportCustomGetV30DataTopic.java)
- [千川投放账户报表（本次修正的接口）](https://open.oceanengine.com/labels/12/docs/1697466393573376)
- [同一文档的结构化定义](https://open.oceanengine.com/skiff/api/doc/client/schema/markdown/get/?doc_id=1697466393573376)
- [千川授权抖音号列表](https://github.com/oceanengine/ad_open_sdk_java/blob/b9a89b8b4a86ac151935502ed3cd40fc050b53aa/src/main/java/com/bytedance/ads/api/QianchuanAwemeAuthorizedGetV10Api.java)

营销字段以账户当前主题的 fields 响应为准。千川目录按2026-10-21官方文档核对，不表示账户权限或实际可用性已经验证；文档更新时需同步更新目录。
