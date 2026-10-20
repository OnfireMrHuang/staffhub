# 巨量引擎报表查询工具

使用 **Python 3.11+ 和 uv**，通过 `.env` 配置应用凭据，通过 JSON 文件直接构造 API 参数，用于快速测试报表指标、维度、筛选条件和数据。独立于前端项目，依赖由本目录的 `pyproject.toml` 和 `uv.lock` 管理。

## 快速开始

在项目根目录执行：

```bash
cd scripts/data_report_tool
uv sync --locked
cp .env.example .env
cp examples/fields.json params.local.fields.json
cp examples/report.json params.local.report.json
```

编辑 `.env`：

```dotenv
app_id=你的应用ID
app_secret=你的应用密钥
auth_code=新获取的授权码
```

编辑两个 `params.local.*.json`，将 `advertiser_id` 替换为有权限的广告主 ID。报表文件中的起止时间也需要改为实际查询日期。示例字段仅供起步，请以你的账户和数据主题返回的可用字段为准。

```bash
# 1. 获取 token；有效缓存会直接复用
uv run report_tool.py token

# 2. 查询可用指标、维度，完整响应同时输出到终端和文件
uv run report_tool.py fields --params params.local.fields.json --output output/fields.json

# 3. 根据上一步结果调整 dimensions、metrics、filters，再查询报表
uv run report_tool.py report --params params.local.report.json --output output/report.json
```

也可以跳过第 1 步：查询命令发现没有 token 缓存时，会自动用 `.env` 的授权码获取 token。

## 参数文件

JSON 文件顶层就是 API 请求参数对象，不需要额外包裹 `params` 或 `body`。

可用指标和维度：

```json
{
  "advertiser_id": "1234567890123456",
  "data_topics": ["BASIC_DATA"]
}
```

自定义报表：

```json
{
  "advertiser_id": "1234567890123456",
  "data_topic": "BASIC_DATA",
  "dimensions": ["stat_time_day"],
  "metrics": ["stat_cost", "show_cnt", "click_cnt"],
  "filters": [],
  "start_time": "2026-10-18 00:00:00",
  "end_time": "2026-10-18 23:59:59",
  "order_by": [{"field": "stat_cost", "type": "DESC"}],
  "page": 1,
  "page_size": 100
}
```

- `fields` 使用复数 `data_topics` 数组，`report` 使用单数 `data_topic`。
- 数组和对象保持 JSON 原生结构。工具会将它们序列化并做 URL 编码，不要手动转成字符串。
- `null` 值不发送，空数组 `[]` 保留。未识别的字段原样传给接口，方便验证新增参数和错误场景。
- 广告主 ID 推荐写成字符串，避免被其他 JSON 编辑器处理时丢失精度；Python 也支持完整精度的整数 ID。
- 每次只查询一页。修改 `page` 和 `page_size` 翻页，结合响应中的 `data.page_info` 检查是否还有数据。
- `filters` 中的字段、类型、操作符及值组合应依据可用字段响应和接口文档设置；工具不预设业务规则。
- JSON 必须是标准格式，不支持注释和尾随逗号。

## 调试命令

```bash
# 仅预览请求路径、参数及脱敏请求头，不需要凭据，也不会联网
uv run report_tool.py report --params params.local.report.json --dry-run

# 发起请求，并把脱敏请求信息打印到 stderr
uv run report_tool.py report --params params.local.report.json --verbose --timeout 60

# 使用另一份配置和独立缓存
uv run report_tool.py fields --env .env.test --cache .cache/test-token.json --params params.local.fields.json

# 手动刷新缓存中的 token
uv run report_tool.py refresh

# 更新 .env 中的 auth_code 后，强制重新授权
uv run report_tool.py token --force

uv run report_tool.py --help
uv run report_tool.py report --help
```

默认 `.env` 路径始终是工具目录下的 `.env`，与运行命令时的工作目录无关。默认缓存为所选 `.env` 同目录下的 `.cache/token.json`。显式传入的 `--env`、`--cache`、`--params` 和 `--output` 相对路径均以当前工作目录为基准；多账户使用不同 `--cache`。

从项目根目录执行时，可以写成：

```bash
uv run --project scripts/data_report_tool scripts/data_report_tool/report_tool.py report \
  --params scripts/data_report_tool/examples/report.json --dry-run
```

## Token 与输出

- `.env` 支持小写或大写变量名，例如 `app_id` / `APP_ID`。系统环境变量优先；同一来源同时存在两种写法时，小写优先。文件不会执行 shell 命令或展开变量。
- 工具把 `app_secret` 映射为接口要求的 `secret`，`app_id` 以整数发送。
- 可选配置 `access_token` / `ACCESS_TOKEN`，直接使用已有 token，优先于缓存。手动 token 不会自动刷新；需要恢复缓存机制时删除该配置。
- 缓存记录应用 ID、访问 token、刷新 token 和到期时间。访问 token 到期前 60 秒内会自动刷新；刷新失败不会重复消费旧授权码，也不会覆盖原缓存。
- 换用新的授权身份时，更新 `auth_code` 并执行 `token --force`；仅修改授权码不会替换仍有效的缓存。不要并发刷新同一份缓存。
- `token` / `refresh` 成功时仅输出状态和来源，真实 token 存于缓存文件。缓存及响应文件通过原子替换写入，在 macOS/Linux 上权限为 `0600`。
- `fields` / `report` 在 stdout 输出完整 JSON 响应，包括 `code`、`message`、`request_id` 和 `data`；`--output` 另外保存一份。每次运行会覆盖指定输出文件。
- HTTP 错误、平台业务错误和网络超时均返回非零退出码，错误信息写入 stderr。平台返回的 JSON 错误响应也会写入 `--output`，方便检查 `code` 和 `request_id`。非 JSON 或网络错误没有可保存的 JSON 响应。
- 不会自动重试失败请求，以便观察原始错误，也避免意外消耗授权码。
- 本目录的 `.env*`（保留 `.env.example`）、`.cache/`、`output/`、`params.local*.json` 和 `.venv/` 已加入 Git 忽略。

## 测试

```bash
uv run python -m unittest discover -s . -v
```

测试使用 HTTP 模拟响应，不需要真实凭据。覆盖配置优先级、请求参数编码、token 缓存/刷新、跨应用缓存隔离、离线预览、错误处理及完整响应保存。真实账户的权限、可用字段组合和数据内容需要配置凭据后实际查询验证。

## 接口依据

| 命令 | 方法 | 接口 |
| --- | --- | --- |
| `token` | POST | `/open_api/oauth2/access_token/` |
| `refresh` | POST | `/open_api/oauth2/refresh_token/` |
| `fields` | GET | `/open_api/v3.0/report/custom/config/get/` |
| `report` | GET | `/open_api/v3.0/report/custom/get/` |

- [获取访问 token](https://open.oceanengine.com/labels/34/docs/1696710505596940?origin=left_nav)
- [获取报表可用指标和维度](https://open.oceanengine.com/labels/34/docs/1755261744248832?origin=left_nav)
- [获取自定义报表数据](https://open.oceanengine.com/labels/34/docs/1741387668314126?origin=left_nav)

文档页面为动态加载；本工具另外根据[巨量引擎官方 SDK](https://github.com/oceanengine/ad_open_sdk_java) 的 `Oauth2AccessTokenRequest`、`Oauth2RefreshTokenRequest`、`ReportCustomConfigGetV30Api`、`ReportCustomGetV30Api` 和 `ApiClient.parameterToPairs` 核对了接口路径、凭据字段及数组编码。
