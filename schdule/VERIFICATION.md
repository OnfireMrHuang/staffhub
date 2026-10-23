# 调度层与采集脚本验证

日期：2026-10-23。

## 已验证

| 项目 | 结果 |
| --- | --- |
| 新调度行为与入口测试 | 35 项通过 |
| 独立来源回归测试 | 74 项通过；来源相关测试归入 scripts/tests |
| 数据汇定义 | 六张汇表删除原始响应和范围/维度摘要列；广告表统一 stats 后缀；规格内 DDL 与可执行文件一致 |
| 广告业务键写入 | SQLite 执行仓储 SQL 验证账户/小时替换、千川内部主播 ID 隔离、小时/天同零点共存、空结果只清理本粒度、审计失败回滚；没有执行真实 MySQL DDL |
| 营销参数 | 账户级采集，CLI 与 Python 接口均拒绝主播筛选 |
| 千川原生参数 | MockTransport 验证原生 GET 地址、Access-Token、JSON 字段/筛选、内部 aweme_ids、逐页请求及小时/天枚举；校验日期跨度、180天回看和配置覆盖优先级 |
| 单套授权 | 四类配置统一 auth；移除 CLI/Task/计划中的 credential；多账户复用并仅刷新一次 OAuth 缓存，浏览器来源复用缓存 Cookie，来源目录隔离 |
| 预建表与映射 | 移除 init-db 和自动建表代码；四类写入、删除与审计均使用 mysql.tables；无效映射在连接前失败，调度在采集前校验全部映射 |
| 数据库密码 | 四类来源和调度直接使用 mysql.password；模拟连接确认环境变量不覆盖或补全密码，缺失或类型错误在连接前失败，错误输出不包含密码 |
| 两个安装入口 | schdule-auth、schdule-collect 可运行，离线示例去重为5个目标 |
| 正式执行路径 | 使用模拟 MySQL 计划及模拟来源API，验证入口组装、逐项运行记录及最终 JSON 一致 |
| 授权分组 | 每类脚本仅维护一次，每个账户逐一探测；首目标失败仍检查其余目标 |
| 采集策略 | continue / skip-room / abort；存储失败强制停止；剩余任务明确标为 skipped |
| 午夜时间适配 | 众安按窗口涉及日期逐日调用；00点结束的窗口仅包含前一天；千川天粒度由来源扩展为完整日期，预览和运行记录使用实际范围 |
| 锁和记录 | 两类锁独立，同类互斥；记录0600，异常状态持久化，日志不可写停止后续任务 |
| MySQL读取 | 模拟只读事务、最大行数、连接关闭、异常脱敏；拒绝非查询SQL、空计划及超限结果 |
| 通知 | 模拟逐号码结果、失败重试、成功后冷却、SDK异常脱敏；本机SDK构造和请求模型可加载 |
| 依赖边界 | 来源包在阻断 schdule 和旧调度模块导入时仍可加载 |
| 旧目录 | live_data_design 已删除，包括旧代码、规格、配置、测试和虚拟环境 |
| 原始资料 | Excel 移至 schdule/data，目录已忽略；不属于新调度执行逻辑 |

执行命令：

```bash
# 在 schdule/ 下
uv sync --locked --offline
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m unittest discover -s ../scripts/tests -v
.venv/bin/schdule-auth --config config/preview.toml --plan-file config/plan.example.json --dry-run
.venv/bin/schdule-collect --config config/preview.toml --plan-file config/plan.example.json --dry-run
```

## 接入边界

未连接真实 MySQL 或业务API、未执行真实授权、未发短信、未安装 cron。正式运行要求已同步的原表、真实只读连接，以及根据最终表结构编写的 config/plan.sql；plan.example.sql 仅展示投影契约，故意返回空结果。

模拟数据库及 SQLite 事务检查不等于实际 MySQL DDL、权限、查询计划和关联正确性验证。本轮已更新来源数据汇定义和仓储代码，未迁移已有数据库。已有库需要按 scripts/SPEC.md 的迁移边界先处理历史数据，再执行独立的表结构迁移；脚本仅使用配置中的已有表，不执行建表或结构升级。真实表接入后先使用两个入口的 --dry-run 核对范围，再执行受控授权和采集。
