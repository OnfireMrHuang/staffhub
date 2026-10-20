# 众安直播数据爬虫

Python 3.11+。默认使用本机外部 Chrome 的独立窗口完成手机号验证码登录，保存 Cookie 和 localStorage；也支持导入日常 Chrome 已登录会话。进入直播看板后查询接口，并向同一个 Excel 文件新增或更新记录。

## 安装与运行

在项目根目录执行：

```bash
cd tools/zhongan_crawler
uv sync
cp .env.example .env
```

默认使用电脑上已安装的 Google Chrome，无需另下载浏览器。如果希望使用 Playwright Chromium，先执行 `uv run playwright install chromium`，运行时传 `--browser-channel chromium`。

编辑 `.env`，填写 `ZHONGAN_PHONE`。也可以通过系统环境变量设置，系统环境变量优先：

```bash
export ZHONGAN_PHONE='你的11位手机号'
uv run python zhongan_collect.py login
```

独立浏览器出现后，脚本会尝试自动填写手机号。**获取登录验证码、验证码输入、账户选择和登录提交由本人在窗口完成**；手机框自动识别失败时也可以手动填写。程序最多等待 300 秒，以直播间查询接口验证登录成功后保存 `.secrets/session.json`。可以用 `--login-timeout 600` 延长等待。

这个窗口使用独立配置，不占用日常 Chrome 的用户目录；日常 Chrome 已登录时可按下节导入。后续采集复用保存的会话，无需每次输入验证码。

### Chrome 已登录时免短信导入

1. 在已登录的 Chrome 中打开示例看板，打开开发者工具 → Network（网络），刷新页面。
2. 过滤 `getDashboardAggregate`，右键成功的查询请求 → Copy（复制）→ Copy as cURL（以 cURL 格式复制）。
3. 将内容保存为本地纯文本文件，例如 `.secrets/request.txt`。这是含 Cookie 的凭据文件，请勿提交到 Git 或发到聊天中。
4. 执行：

```bash
uv run python zhongan_collect.py import-session --curl-file .secrets/request.txt
uv run python zhongan_collect.py collect --headless --date 2026-10-20
```

导入只解析文本，不执行其中的命令；只接受本站四个查询接口，验证 Cookie 有效后才替换会话文件。导入完成后可删除临时请求文本。已有有效会话且未配置短信网关时，可以暂不填写手机号；人工重新登录或启用短信提醒前必须配置 `ZHONGAN_PHONE`。

复现需求中的直播间和日期：

```bash
uv run python zhongan_collect.py collect --dy-no 37365205524 --date 2026-10-20
```

默认输出 `output/zhongan.xlsx`，每次运行都更新该文件：

- `看板统计`：直播间信息、直播场次信息、接口全部统计字段。
- `订单明细`：直播间及场次信息、订单号、订单人、金额、时间、状态，以及接口返回的全部订单字段。

后台每五分钟采集：

```bash
uv run python zhongan_collect.py collect --headless --interval 300
```

未指定 `--date` 且 `ZHONGAN_DATE` 留空时，每轮取北京时间当天，跨午夜会切换日期。指定日期则始终查询该日期。默认采集页面默认场次：当前正在直播的场次，或历史场次列表第一条。

采集当日全部场次，或指定场次：

```bash
uv run python zhongan_collect.py collect --date 2026-10-20 --all-sessions
uv run python zhongan_collect.py collect --date 2026-10-20 --room-id '实际场次ID'
```

`--room-id` 可重复传入，不能与 `--all-sessions` 同时使用。`dyNo` 是主播/直播间账号，`roomId` 是一次直播的场次标识，两者不能替代。

## 鉴权与短信提醒

保存的登录态包括 Cookie，以及存在时的 `ATLANTIS_SESSION_ID`、`SERVICE_NAME`。查询使用共享 Cookie 的浏览器请求上下文，并在有值时附带 `X-Usercenter-Session` 和 `X-Service-Name`；Chrome 导出中的字面值 `undefined` 不当作有效令牌。

HTTP 401、跳转登录页，以及业务码 `401`、`1013`、`1014` 会触发重新登录处理。HTTP 403 是权限错误，避免把无权限误当作会话过期。其他业务失败、异常 JSON、分页不完整都会停止本轮写入。

- 可见模式：过期后通知，打开人工登录窗口；登录成功后重新采集整轮数据。
- `--headless`：过期后通知并以退出码 **2** 停止；在有桌面的环境运行 `login` 后重新启动采集。
- 退出码 **0** 表示成功或用户中断；**1** 表示配置、网络、权限、数据格式或写文件错误。
- 需要无人值守时可由系统调度器重新启动；本脚本不会创建系统定时任务。

短信暂留 HTTP 网关，未配置时只在终端打印提醒，不会真实发短信。配置：

```dotenv
ZHONGAN_SMS_GATEWAY_URL=https://your-sms-gateway.example.com/send
ZHONGAN_SMS_GATEWAY_TOKEN=your-token
ZHONGAN_SMS_COOLDOWN_SECONDS=3600
```

请求为 `POST` JSON：

```json
{
  "phone": "登录手机号",
  "event": "zhongan_login_expired",
  "message": "众安直播数据采集登录已过期，请在采集电脑运行 login 并完成人工登录。"
}
```

配置 token 时增加 `Authorization: Bearer <token>`。网关自行对接短信供应商及已审核模板，必须返回 HTTP 2xx 和 `{"success": true}`。发送成功才记录冷却时间；相同网关和手机号默认一小时只提醒一次，进程重启仍有效。网关出错不影响“登录已失效”的退出码。禁止跟随网关重定向，避免向其他地址转发手机号或 token。

## 数据口径与更新

前端代码与 Chrome 真实请求核对日期：2026-10-20。查询均为 JSON POST：

| 接口（统一前缀 `/newdmapi/lre/dashboardLiveController/`） | 用途与参数 |
| --- | --- |
| `getLiveDy` | `startDate`、`livePlatform`；定位指定 `dyNo`，不自动替换成其他直播间 |
| `getLiveAttribute` | `dyNo`、`startDate`；获取当前 `roomId` 和 `attributeOfflineDTOList` |
| `getDashboardAggregate` | `livePlatform`、`dyNo`、`roomIdList`；整场统计，遵循页面默认整场时间范围 |
| `getOrderList` | 同场次过滤，增加 `startDate`、`showDetail: "Y"`；按最后一条订单的 `nextPage` 继续读取 |

**订单使用游标分页，不使用猜测的 pageNo/pageSize。** `showDetail: "Y"` 请求展开明细。空列表或显式空游标表示结束；缺少游标字段、游标循环、重复订单号或超过页数上限则报错，不把部分结果当完整数据写入。上限可用 `--max-pages` 调整，默认 10000。

看板唯一键为“平台 + dyNo + 统计日期 + 场次ID”；订单唯一键为“平台 + dyNo + 场次ID + orderNo”。同键覆盖接口字段并保留首次采集时间，新增键追加；接口新字段自动扩展列。查询中没有出现的旧记录保留，不推断已删除。状态 `2/3` 标为已支付，`-1` 标为已退保；其余保留原始状态码，不推断业务含义。

金额保留接口原值，不擅自换算元/分。嵌套对象展开为带前缀的列，数组存为 JSON 文本，原始字段也保留；订单号与长整数以文本写入，避免 Excel 精度损失。工作簿是当前已采集记录的最新状态，不是每轮快照历史。

所有选中场次都采集成功后才更新 Excel；用文件锁和同目录临时文件原子替换，失败不会留下半个工作簿。Excel 中显示的字符串按文本保存，不能作为公式执行。每轮原始请求参数、响应和完成标记存放在 `output/raw/<运行时间>/`，不记录鉴权请求头；完整标记为 `manifest.json` 的 `complete: true`。

`.env`、登录态、输出、虚拟环境都已忽略，不进入 Git。登录态和原始 JSON 以仅当前用户可读写权限创建。订单及原始响应含个人信息，请仅存放在授权电脑。Windows 上若 Excel 正打开输出文件，保存可能失败，关闭文件后重试即可。

## 验证

```bash
uv run python -m unittest discover -s . -p 'test_*.py' -v
```

测试使用合成数据和本机 HTTP 服务，覆盖业务鉴权失败、Cookie/令牌复用、Chrome 请求导入、游标分页、场次选择、Excel 增量更新、长标识保真、原子写入及短信网关协议，不发送真实短信。

2026-10-20 已使用 Chrome 现有登录态完成两轮真实采集：示例 `dyNo=37365205524`、场次 `7698502234925009679`，订单分页为 `12 + 12 + 12 + 12 + 1 = 49`，与看板 `orderCnt=49` 一致。第二轮后工作簿仍为 1 条看板记录、49 条唯一订单，首次采集时间保留、最近采集时间更新。真实短信发送尚未验证，需接入网关；人工验证码登录分支仍需用实际手机号验证。

运行时可用 `--output` 指定 Excel 路径、`--session` 指定会话文件、`--timeout` 调整请求超时、`--pause` 调整查询间隔。相同会话不能由两个进程同时操作，以免人工登录与循环任务互相覆盖；先停止采集再运行 `login`。
