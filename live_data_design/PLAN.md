# 直播采集架构 v3 实施计划与完成记录

需求：每个采集器独立维护参数、认证、采集、字段及数据库操作；共用基础能力位于scripts/utils，不依赖live_data；live_data仅保持调度。业务目录仍按原表同步MySQL后关联查询，没有实体live_route。

技术栈保持Python3.11+、httpx、PyMySQL、Playwright、unittest；工作簿读取使用标准库ZIP/XML。架构与接口见[SPEC.md](SPEC.md)，运行见[README.md](README.md)。

## 1. 共用设施与业务目录

- [x] 将模型、通用配置、HTTP、缓存/锁、OAuth轮换、浏览器生命周期、数据库事务/审计迁到scripts/utils。
- [x] CollectionService接收具体repository/auth/collector对象，不含来源选择逻辑。
- [x] scripts/catalog拥有来源导入、八业务实体、范围汇总校验、镜像/目录事务、目录schema。
- [x] scripts.manage独立提供init-db/inspect-sources/sync-sources/validate-config；与调度CLI分离。
- [x] 验证真实工作簿3产品/4房间/16账户/2应用/4后台/20任务，身份与改造前一致。

## 2. 四个自治采集器

- [x] scripts/marketing、qianchuan、pingan、zhongan各自拥有cli/task/auth/collector/repository/contracts/fields.json/schema.sql。
- [x] 来源入口直接调用本源cli，保留scripts/*.py和根目录兼容入口。
- [x] 来源拥有参数/范围规范化、请求/分页/清洗、权限探测、会话提取、事实SQL及字段契约。
- [x] collect_task/check_task由各源组装具体对象并关闭资源，调度仅调用这两个公开接口。
- [x] 单源init-db只初始化本源事实表/视图与公共审计，不要求业务目录。
- [x] 保留任务ID、范围锁、观察时间、请求指标、6视图和266字段。

## 3. 调度与依赖边界

- [x] live_data只保留__init__/__main__/cli/dispatch/runner。
- [x] 删除旧中央script_cli、AuthManager、AdsCollector/PolicyCollector、Store及聚合字段/SQL副本。
- [x] scripts.registry仅做延迟模块查找；utils不依赖registry、来源模块或live_data。
- [x] Runner保留先广告后单次保单、continue/skip-room/abort、存储失败中止、独立授权维护。
- [x] 平安summary唯一性与SQL guard属于pingan.contracts，utils只执行显式回调。

## 4. 验证与交付

- [x] 先运行架构失败测试，再实现：屏蔽live_data仍可独立运行、来源类型/SQL归属、单向依赖。
- [x] 保留原100项行为回归，新增39项来源自治、公共设施、调度接口与边界验证。
- [x] 139项全量测试：134通过，5项真实MySQL环境条件跳过。
- [x] 四源任意工作目录入口、工作簿只读同步预览、编译检查。
- [x] 更新规格架构图、目录结构、运行命令、cron模板及验证记录。

不改动原工作簿，不复制或输出其中密钥，不执行生产API、短信、数据库写入或安装cron。真实MySQL与生产联调的未验证范围见[VERIFICATION.md](VERIFICATION.md)。
