# 第一期直播数据采集

从产品和直播间的业务关系出发，采集巨量营销、巨量千川、平安、众安数据。四个来源分别由 `scripts/marketing/`、`qianchuan/`、`pingan/`、`zhongan/` 独立维护，直接接收业务参数并完成鉴权、采集和入库。`scripts/utils/` 提供共用基础能力；`live_data/` 只从 MySQL 业务目录生成计划、调度来源模块及处理失败策略。

先读 [技术规格与架构图](SPEC.md)，再按本说明运行。[主数据模型](MASTER_DATA.md) 说明 Excel 怎样转为业务表；[验证记录](VERIFICATION.md) 区分离线验证与生产联调。

## 1. 安装和配置

要求 Python 3.11+、MySQL 8.0。浏览器授权使用系统 Google Chrome，需要图形桌面。广告适配器复用仓库 `tools/data_report_tool` 的协议构造，所以不要单独搬走本目录而删掉旧工具。

以下命令在本目录运行：

```bash
uv sync --locked
cp -n config/workbook.example.toml config/local.toml
uv run python -m scripts.manage validate-config --config config/local.toml
```

`workbook.example.toml` 对应用户提供的本地工作簿。它包含非敏感的应用/后台绑定；MySQL连接、真实认证键、SMS模板及号码需要按部署环境填写。路径相对TOML文件；默认状态在 `runtime/`。

| 环境变量 | 用途 |
| --- | --- |
| LIVE_MYSQL_PASSWORD | MySQL密码，业务采集和管理命令需要 |
| LIVE_MARKETING_APP_ID / LIVE_MARKETING_APP_SECRET / LIVE_MARKETING_AUTH_CODE | 营销应用；首次或重新授权才需要新AUTH_CODE |
| LIVE_QIANCHUAN_APP_ID / LIVE_QIANCHUAN_APP_SECRET / LIVE_QIANCHUAN_AUTH_CODE | 千川独立应用 |
| TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY | 启用腾讯云SMS时需要 |

OAuth也可在对应credentials段指定私有 `env_file`，内容使用同样前缀，进程环境优先。私有文件不得提交。Excel含真实凭据，保留原文件并已加入本目录Git忽略规则；导入不会复制其中secret、token示例、密码或手机号。cron不会自动读取交互终端的环境变量，需要受限启动脚本或服务环境注入。

## 2. 先验证四个独立脚本

独立脚本不要求同步主数据。以下使用演示业务ID及账户，仅验证参数，`--dry-run` 不连接数据库、不鉴权、不访问外部接口：

```bash
uv run python scripts/marketing.py collect --config config/local.toml \
  --product-id demo-product --room-id demo-room --credential marketing_app \
  --advertiser-id 123 --app-id 456 --account-scope --version smart --dry-run

uv run python scripts/qianchuan.py collect --config config/local.toml \
  --product-id demo-product --room-id demo-room --credential qianchuan_app \
  --advertiser-id 123 --app-id 789 --account-scope --dry-run

uv run python scripts/pingan.py collect --config config/local.toml \
  --product-id demo-product --room-id demo-room --credential pingan_room_1 \
  --channel DEMO_CHANNEL --dry-run

uv run python scripts/zhongan.py collect --config config/local.toml \
  --product-id demo-product --room-id demo-room --credential zhongan_windmill \
  --dy-no DEMO_DY --platform DOUYIN --dry-run
```

真实采集需替换为真实业务目录ID、账户/渠道及对应授权应用，并先创建事实表、完成授权。去掉 `--dry-run` 后执行“鉴权→全量分页→清洗→单任务事务入库”。不要把演示ID用于生产，否则会改变结果归属。

| 参数 | 说明 |
| --- | --- |
| collect / check-auth / authorize / init-db | 四模块独立提供命令；init-db仅需config，创建本源表/视图及公共审计 |
| --product-id / --room-id / --credential | 业务归属、部署凭据别名 |
| --advertiser-id / --app-id | 广告账户、预期授权应用；ID按文本处理 |
| --account-scope 或 --aweme-id | 账户全量与指定手机端抖音号二选一 |
| --version | 营销smart或legacy，默认smart |
| --channel | 平安merchantChannel |
| --dy-no / --platform | 众安抖音号与平台，平台默认DOUYIN |
| --start / --end | collect可选，成对整小时半开区间，默认上一完整小时 |
| --metrics | 广告可选逗号分隔列表；默认字段来自来源契约 |
| --task-file | 单任务JSON，替代显式业务字段，不能混用 |
| --wait-seconds | authorize等待1–1800秒，默认15秒 |

任务文件示例（不含密钥）：

```json
{
  "source": "pingan",
  "product_id": "demo-product",
  "room_id": "demo-room",
  "credential": "pingan_room_1",
  "account_id": "",
  "options": {"channel": "DEMO_CHANNEL"}
}
```

```bash
uv run python scripts/pingan.py collect --config config/local.toml --task-file task.json --dry-run
```

也可用 `python -m scripts.marketing`（或其他来源名）运行同样命令。`scripts/*.py` 和根目录四个脚本只转发到各自来源模块的 `cli.main`。独立运行不导入 `live_data`，也不需要业务目录。

每个采集器拥有自己的 `cli.py`、`task.py`、`auth.py`、`collector.py`、`repository.py`、`contracts.py`、`fields.json` 与 `schema.sql`。修改某来源的参数、接口或入库逻辑就在该模块完成。调度器调用本源 `cli.collect_task(config, route, window)` / `cli.check_task(config, route, ...)`，单独执行和批量执行走同一份本源实现。

单独初始化一个来源可执行：

```bash
uv run python -m scripts.pingan init-db --config config/local.toml
```

全量初始化、原表导入属于 `scripts.manage`；`live_data` 仅接受采集与授权调度命令。

## 3. 创建数据库并导入业务目录

由数据库管理员创建目标库、授权运行用户；初始化需要CREATE及CREATE VIEW，日常采集需要读写事实表和审计。网络加密和数据库访问策略由部署环境配置。

```sql
CREATE DATABASE live_data CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
```

```bash
uv run python -m scripts.manage init-db --config config/local.toml
# 只读Excel并校验；不连接MySQL、不输出秘密
uv run python -m scripts.manage sync-sources --config config/local.toml --dry-run
# 校验通过后，事务发布来源镜像和八张业务表
uv run python -m scripts.manage sync-sources --config config/local.toml
# 从业务目录生成任务，展示每项task/route ID；不访问业务平台
uv run python -m live_data schedule --config config/local.toml --dry-run
```

当前工作簿预期得到3产品、4直播间、16账户、2应用、4后台绑定，生成16个广告任务和4个保单任务。应用/后台的纵向布局及产品账户表的merge由专用导入器解析；普通空白不会猜测填充。三镜像用于追溯，运行查询八张业务表的两个任务视图。不存在实体 `live_route`。

本工作簿导入按账户全量统计：每个账户只绑定一个房间。众安dyNo仅供保单查询。重复账户跨房间必须另行提供明确筛选，否则拒绝导入。名字没有独立源ID时会用于首次生成稳定业务ID；改名需显式迁移，不能按行号覆盖历史归属。

整个导入校验完成后才开始事务，来源镜像和业务表一起提交。失败保留旧目录；移除绑定停止未来任务，历史事实数据保留。旧版镜像需要重新sync-sources，旧live_route若存在会被忽略，不自动删除。旧人工ID产生的事实数据不能直接和新版ID汇总，需要受控迁移。

`config/example.toml` + `master.example.json` 仍提供不依赖真实Excel的合成导入演示。通用Feishu读取适配器保留用于普通表头格式；本工作簿含纵向分组，应使用xlsx配置，不能直接拿旧Feishu列占位模板运行。

## 4. 首次授权与恢复

独立脚本的check-auth/authorize不要求MySQL，只需要明确任务参数和凭据配置。广告先配置APP_ID/APP_SECRET/有效AUTH_CODE；调用authorize交换或刷新token，再验证账户权限：

```bash
uv run python scripts/marketing.py authorize --config config/local.toml \
  --product-id YOUR_PRODUCT_ID --room-id YOUR_ROOM_ID --credential marketing_app \
  --advertiser-id YOUR_ADVERTISER_ID --app-id YOUR_APP_ID --account-scope
```

平安token_key及众安auth_cookie_names需从已登录页面核实，不能用追踪Cookie代替认证键。两个平安后台使用独立credential，避免同一浏览器状态被另一账户覆盖。

```bash
uv run python scripts/pingan.py authorize --config config/local.toml \
  --product-id YOUR_PRODUCT_ID --room-id YOUR_ROOM_ID --credential pingan_room_1 \
  --channel PAJKBX --wait-seconds 1800
```

系统Chrome打开独立持久配置目录，管理员在窗口内完成登录和验证码；程序读取目标域认证Cookie/localStorage，实际探测成功后原子保存私有状态。首次不会自动导入日常Chrome登录态。成功或超时后关闭窗口；超时需重跑。

OAuth缓存含绝对到期时间、应用ID及轮换token。刷新成功后先保存新refresh token，再验证账户权限；失败不会清空旧缓存。彻底失效时需要新授权码及新凭据别名，更新目录绑定后重新authorize，不要反复消费旧授权码。

## 5. 批量调度与授权保活

```bash
# 本轮依次处理直播间→广告账户→该直播间保单一次
uv run python -m live_data schedule --config config/local.toml
# 从目录按来源筛选
uv run python -m live_data collect --config config/local.toml --source marketing
# 显式回补，示例时间需替换为实际区间
uv run python -m live_data collect --config config/local.toml \
  --route-id YOUR_DERIVED_TASK_ID --start 2026-10-20T09:00:00 --end 2026-10-20T12:00:00
# 独立维护登录，默认距到期<=1800秒时刷新
uv run python -m live_data auth-maintain --config config/local.toml
```

目录在一致事务中读成计划后释放；本轮固定使用该计划，新导入影响下一轮。导入锁、调度锁、单来源范围锁和凭据文件锁分别保护各自职责。单节点运行，不支持各机器保存独立refresh token并同时刷新。

`continue`记录错误并继续下一任务；`skip-room`跳过同产品同房间剩余任务；`abort`终止。存储或审计失败始终中止，部分失败仍返回非零。保单不会因一个房间有多个广告账户而重复采集。

[cron.example](cron.example) 展示每小时第5分钟同步后采集、每5分钟独立授权维护。只提供模板，不自动安装。失败窗口不会自动排队，需根据live_run及日志回补。剩余有效期未知时实际探测；众安没有当天场次时仅标记范围未验证。

授权维护失败发送“管理员需在半小时内登录”的SMS。配置sms.enabled、已审核签名与模板、真实管理员E.164号码及腾讯云环境凭据；逐个检查发送结果，成功后才启动冷却。模板可用{source}/{credential}/{error}/{minutes}，不包含原始异常正文。未启用时明确返回disabled。

## 6. 数据查询和返回结果

物理事实表保留原始来源字段，六类视图按Excel字段字典对外提供数据：

- `v_marketing_hourly`、`v_qianchuan_hourly`：真实小时维度，业务账户元数据与来源指标分开。
- `v_pingan_stats`、`v_pingan_orders`：日累计观察快照、按更新时间查询的来源订单。
- `v_zhongan_stats`、`v_zhongan_orders`：场次累计和订单。

[营销字段契约](scripts/marketing/fields.json)、[千川字段契约](scripts/qianchuan/fields.json)、[平安字段契约](scripts/pingan/fields.json) 和 [众安字段契约](scripts/zhongan/fields.json) 记录266个字段的映射路径、类型及支持状态，其中5个未确认字段明确为NULL（详见验证记录），众安25个类型未确认字段保持原JSON。NULL表示来源缺失/不适用，不能当0；比率不能直接求和；金额不使用展示层四舍五入值。API不支持请求字段会使该任务失败，不静默减少字段。

保单observed_at是实际观察时刻，source_date是源日期，回补不重建过去小时快照。postId是接口记录标识，未经验证不能称为保单号。统一时报、日报及直播排班的业务计算不在本期采集脚本中实现。

所有命令stdout最终输出JSON。退出码：0成功、2配置、3授权、4来源/数据、5存储、6锁占用、7短信、130人工中止。批量结果保留每项状态；来源脚本保留task_id/source/status/rows或安全错误。数据库中的订单JSON按公司访问权限与保留周期管理。

## 7. 验证

```bash
uv run python -m unittest discover -s tests -v
```

默认使用合成接口和本地参数验证，不发真实短信。真实MySQL测试只在显式设置 `LIVE_TEST_MYSQL_SOCKET` 时执行，会创建并删除随机测试数据库，必须指向隔离测试实例：

```bash
LIVE_TEST_MYSQL_SOCKET=/absolute/path/to/disposable/mysql.sock \
  uv run python -m unittest discover -s tests -p test_mysql.py -v
```

当前实测结果及未验证边界以 [VERIFICATION.md](VERIFICATION.md) 为准。
