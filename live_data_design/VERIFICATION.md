# 独立脚本与数据汇验证记录

日期：2026-10-22。本轮完成根目录 scripts 拆包、六张来源数据汇 DDL、参数精简和独立规格重写。主数据目录仍是候选实现，生产接入尚未验证。

## 本轮结果

| 检查 | 结果 |
| --- | --- |
| 采集与编排回归套件 | 140 项：135 通过、5 项 MySQL 集成测试跳过 |
| 独立项目补充检查 | 7 项全部通过；合计 147 项，142 通过、5 跳过 |
| 四来源独立依赖 | 各自 uv.lock 和 .venv 安装成功；营销/千川不安装 Playwright 或腾讯云 SDK |
| 任意目录独立入口 | 各自 .venv 从 /tmp 运行 python -m scripts.<type> collect --dry-run，四源均返回 0 |
| 来源字段 DDL | 六表逐列覆盖原字典 266 字段；SPEC 中 SQL 与四份 schema.sql 一致 |
| 模块边界 | 来源无 live_data 导入；utils 无来源分派；每源持有 CLI、参数、鉴权、采集、SQL和字段契约；live_data 仅 5 个调度文件 |
| 参数精简 | 无 product-id、room-id、app-id、metrics、task-file、account-scope CLI；授权无时间窗口，众安只用 date |
| 原表同步预览 | 私有工作簿只读解析成功：3 产品、4 房间、16 账户、2 应用、4 后台绑定、20 计划；未写数据库 |
| Python 编译 | 调度、目录、管理命令和四来源/公共包通过 |

验证命令在 live_data_design/ 执行：

```bash
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m unittest discover -s ../scripts/tests -v
.venv/bin/python -m manage sync-sources --config config/workbook.example.toml --dry-run
.venv/bin/python -m compileall -q live_data catalog manage.py registry.py notifications.py \
  ../scripts/marketing ../scripts/qianchuan ../scripts/pingan ../scripts/zhongan ../scripts/utils
```

来源独立安装使用各自 pyproject/uv.lock；验证时复用已缓存依赖，未修改系统数据库或浏览器安装。真实私有工作簿存在，本轮相应两项测试实际执行；CI 缺少私有文件时会明确跳过。

## 关键行为

- 广告完整分页、总数检查、来源字段可用性检查、跨日小时裁剪、精确数值和事务失败回滚保留原覆盖。
- 保单缺页、重复游标、场次归属冲突、真实观察小时、订单 upsert 和首次时间保留有回归覆盖；真实数据库行为仍需隔离实例测试。
- 平安固定 `-`、派生率两位百分比、漏斗百分号/缺失 `/` 与 raw_payload 保留有独立断言。
- check-auth/authorize 不连接 MySQL；dry-run 不建立 HTTP 客户端；来源可以在阻断 live_data 导入时执行。
- 来源 Task 不含产品/业务房间；计划 ID 和采集范围 ID 分开。同步应用绑定转换到凭据配置，不重新引入 app-id 参数。
- OAuth 轮换原子保存、认证域/期限校验、私有文件权限、失败审计及编排通知原有测试继续通过。

## 映射边界

| 来源 | 现状 |
| --- | --- |
| 营销 42 列 | 35 请求指标及 7 维度/上下文；当前账户实际字段权限尚待联调 |
| 千川 111 列 | aweme_nick_name 映射未确认，列保留 NULL，已移除无用途昵称配置 |
| 平安统计 20 列 | gmvSimpleRoi/performanceRoi/adSpend 按原字段说明固定 `-`；原映射状态仍标为 unsupported，不能声称有真实指标来源 |
| 平安订单 12 列 | applicant_age_group 源路径未确认，列为 NULL |
| 众安统计 49 列、订单 32 列 | 17＋8 个来源类型未确认字段分别使用 JSON 列保留原值 |

物理列不代表全部真实平台字段已经验证。原值保留在 raw_payload，未知映射不会从汇表删列；不可加总的累计值、比例与空值语义见 [独立规格](../scripts/SPEC.md)。

## 尚未执行

- 真实 MySQL 执行六张 DDL 和 5 项集成测试。本轮没有配置 LIVE_TEST_MYSQL_SOCKET；SQL/事务模拟检查不能替代 MySQL 实测。测试已更新为新物理表，仅允许隔离实例，会创建并删除随机测试库。
- 四来源的生产授权、真实账户权限与数据核对。未将工作簿 token 示例视为有效登录态，未调用真实采集接口。
- 腾讯云真实短信送达、cron 安装、生产写库及旧数据迁移。

旧前端和 tools 下旧采集工具未修改，本轮未重复运行它们的测试。没有执行生产数据库变更。
