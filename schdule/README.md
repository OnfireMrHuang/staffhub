# schdule：授权与采集调度

两个独立入口：`schdule-auth` 维护授权，`schdule-collect` 定时采集。设计与流程图见 [SPEC.md](SPEC.md)；四类脚本的参数和数据汇 DDL 见 [scripts/SPEC.md](../scripts/SPEC.md)。

## 安装与离线预览

在本目录执行，需要 Python 3.11+ 和 uv：

```bash
uv sync --locked
uv run schdule-auth --config config/preview.toml \
  --plan-file config/plan.example.json --dry-run
uv run schdule-collect --config config/preview.toml \
  --plan-file config/plan.example.json --dry-run
```

演示计划包含一条重复后台绑定，预览会去重得到5项任务。上述命令不连接 MySQL、不访问业务平台、不创建登录窗口、不发短信。也可使用 `uv run python -m schdule auth` 或 `collect`。

## 部署配置

```bash
cp -n config/example.toml config/local.toml
cp -n config/plan.example.sql config/plan.sql
```

1. 按 [查询投影契约](SPEC.md#3-mysql-计划输入契约) 将 plan.sql 改为已同步 MySQL 原表的 SELECT/JOIN，排除停用绑定。示例 SQL 故意为空，不能直接投入生产。
2. 填写只读计划库连接，直接在 `[mysql]` 的 `password` 中填写密码；调度不创建或同步业务表。
3. sources.<source>.config 指向四类脚本各自的私有 TOML，凭据别名与 SQL 返回值一致。沿用脚本自己的状态目录，才能与单独运行共享授权。
4. 按来源 README 完成各自数据库初始化及首次授权。调度不持有数据汇 DDL，不接受平台密钥参数。
5. 需要授权失败短信时，启用 sms 并填写已审核签名/模板、E.164 号码和腾讯云环境凭据。模板必须与 template_params 顺序匹配。

```bash
# 读取真实 MySQL 关联计划，但不执行来源任务
uv run schdule-auth --config config/local.toml --dry-run
uv run schdule-collect --config config/local.toml --dry-run
# 执行一轮
uv run schdule-auth --config config/local.toml
uv run schdule-collect --config config/local.toml
# 显式回补过去窗口
uv run schdule-collect --config config/local.toml \
  --start 2026-10-20T09:00:00 --end 2026-10-20T12:00:00
```

配置文件内路径相对 TOML。两个入口各有锁，互不占用同一个作业锁；凭据文件与来源范围锁可能让某个任务返回6，等待下一轮或明确重跑。

## 定时触发与排查

[cron.example](cron.example) 给出授权每5分钟、采集每小时第5分钟的部署模板。本项目未自动安装 cron；需要图形浏览器的后台授权应运行在能打开系统 Chrome 的用户会话中。

每次执行记录保存于 `runtime/runs/<run_id>.json`，包括每项状态、总退出码和起止时间。失败返回非零；code5停止后续采集，code6表示锁占用，code7表示通知失败。没有自动补跑队列，漏跑或失败后请根据记录明确回补。被强制终止的运行可能保留 running 状态，不能视为成功。

## 目录与验证

- src/schdule：重新实现的两个调度器及适配器。
- config：调度配置、SQL投影、离线示例。
- data：原始 Excel 输入资料，私有且不提交；当前调度直接读 MySQL，不解析此文件。
- tests：新调度行为测试；来源回归测试归入 scripts/tests。

```bash
uv run python -m unittest discover -s tests -v
uv run python -m unittest discover -s ../scripts/tests -v
```

验证结果与真实环境接入边界见 [VERIFICATION.md](VERIFICATION.md)。
