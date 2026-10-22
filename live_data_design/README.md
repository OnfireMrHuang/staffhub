# 第一期直播数据编排

本目录负责原表同步、业务关系和批量调度。四类来源项目位于仓库根目录 [scripts/](../scripts/)，各自维护依赖、配置、参数、授权、采集和数据库写入。

- [主规格](SPEC.md)：业务关系、原表同步和调度方向；主数据物理表仍是候选方案。
- [独立脚本规格](../scripts/SPEC.md)：六张数据汇 DDL，以及每类脚本的配置、参数、功能与用例。
- [主数据实现](MASTER_DATA.md)：当前工作簿适配、候选目录模型。
- [验证记录](VERIFICATION.md)：本次检查与尚未执行的集成验证。

## 安装与配置

要求 Python 3.11+、MySQL 8.0.16+；后台授权另需系统 Chrome 和图形桌面。以下命令在 `live_data_design/` 执行：

```bash
uv sync --locked
cp -n config/workbook.example.toml config/local.toml
uv run python -m manage validate-config --config config/local.toml
```

编排环境依赖四个本地来源包及 utils，但来源包不依赖此目录。`workbook.example.toml` 对应用户工作簿；`config/example.toml` 和 `master.example.json` 提供合成演示。

TOML 内路径相对配置文件。真实应用和登录资料按 Page 获取并存放于私有环境；数据库、认证键、SMS 模板等部署值应补齐。工作簿包含真实凭据，已忽略，不提交、不将其 secret/token/密码导入普通业务目录。

| 编排环境变量 | 用途 |
| --- | --- |
| LIVE_MYSQL_PASSWORD | MySQL 密码 |
| LIVE_MARKETING_APP_ID / LIVE_MARKETING_APP_SECRET / LIVE_MARKETING_AUTH_CODE | 营销应用；首次/重新交换需要有效码 |
| LIVE_QIANCHUAN_APP_ID / LIVE_QIANCHUAN_APP_SECRET / LIVE_QIANCHUAN_AUTH_CODE | 千川独立应用 |
| TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY | 启用腾讯云通知时使用 |

独立来源的配置与变量前缀以各自模板为准，见 [scripts/README.md](../scripts/README.md)。脚本参数、初始化与授权操作只在独立规格和来源 README 维护。

## 原表同步与计划

目标库由部署方创建并授权。以下 init-db 创建候选目录、六张来源汇表和审计；不会删除或自动迁移旧事实表。

```bash
uv run python -m manage init-db --config config/local.toml
# 只读解析并校验，不连接 MySQL、不输出秘密
uv run python -m manage sync-sources --config config/local.toml --dry-run
# 校验通过后事务发布原表镜像和候选业务目录
uv run python -m manage sync-sources --config config/local.toml
# 从 MySQL 关联查询生成本轮计划，不访问来源平台
uv run python -m live_data schedule --config config/local.toml --dry-run
```

当前私有工作簿对应 3 产品、4 直播间、16 账户、2 应用、4 后台绑定，生成 20 项任务。这是样本数据，不是容量限制。没有实体 live_route；内存 Route 仅表示带产品/房间归属的编排计划，调用来源前转换为不含这些字段的 Task。

导入完整校验后才发布，失败保留旧版本；目录查询使用一致快照。应用绑定在适配层转换为凭据配置校验，采集器不读取业务目录表。

## 批量调度

```bash
uv run python -m live_data schedule --config config/local.toml
uv run python -m live_data collect --config config/local.toml --source marketing
uv run python -m live_data collect --config config/local.toml \
  --route-id YOUR_PLAN_ID --start 2026-10-20T09:00:00 --end 2026-10-20T12:00:00
uv run python -m live_data auth-maintain --config config/local.toml
```

每房间先广告账户，后一次保单任务；不因多个广告账户重复采集相同后台范围。主数据绑定冲突在执行前拒绝。continue/skip-room/abort 控制失败后的编排；存储和审计失败始终停止继续写入。

授权维护独立运行，调用本源公开接口。通知适配器在 `notifications.py`，live_data 负责调用与结果处理。短信配置和真实送达需要部署验证。

[cron.example](cron.example) 为模板：每小时第 5 分钟同步后采集，每 5 分钟维护授权。模板没有自动安装；凭据需由服务环境注入，日志需轮转。跨天众安收集按所选窗口涉及的日期取累计快照；独立脚本只接受实际使用的 --date。

## 验证

```bash
uv run python -m unittest discover -s tests -v
uv run python -m unittest discover -s ../scripts/tests -v
```

默认使用合成接口，不发真实通知。设置 `LIVE_TEST_MYSQL_SOCKET` 后的 MySQL 测试会在指定隔离实例创建并删除随机测试库，不能指向生产实例。结果及限制见 [VERIFICATION.md](VERIFICATION.md)。
