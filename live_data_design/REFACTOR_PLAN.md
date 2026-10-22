# 采集器自治重构计划

用户明确：各采集器独立维护逻辑和数据库操作，共用部分位于scripts/utils；不得依赖live_data，live_data只调度。本计划替代SPEC v2的模块归属，业务范围、数据契约、身份算法和错误码保持一致。

## 目录与依赖方向

```
live_data/                  # 仅批量CLI、调度器、来源分派
scripts/
  manage.py                 # 主数据导入、全量初始化与预览
  registry.py               # 延迟加载四模块的公开接口
  marketing/                # cli, collector, auth, repository, task, fields.json, schema.sql
  qianchuan/                # 同上，拥有自己的千川协议和SQL
  pingan/                   # 同上，拥有自己的渠道/浏览器认证和SQL
  zhongan/                  # 同上，拥有自己的场次/游标/浏览器认证和SQL
  utils/                    # model/config/transport/database/auth/browser/tasks/cli/runtime/fields
  catalog/                  # 业务目录、来源导入、目录repository、目录schema
```

仅允许 live_data → scripts公开模块 → scripts/utils；utils不依赖live_data，不承载按source分派的采集器实现。catalog属于配置管理，共用基础设施放utils，不混进采集器生命周期。registry只加载模块，不实现平台逻辑。

各来源拥有自己的参数定义、任务范围规范化、采集请求/分页、权限探测、浏览器会话提取或OAuth探测、事实SQL及字段契约。跨来源真实共用的HTTP重试、OAuth token轮换、私有文件锁、MySQL连接/事务、审计、CLI文件读取和JSON结果输出留utils。不能只把script_cli/AdsCollector/PolicyCollector整体改名移到utils。

## 公开接口

- 各模块task.make_task(product_id,room_id,credential,account_id='',options=None)->Route；task.validate(route)验证并返回范围描述；数据身份保持已有算法。
- 各模块collector.Collector(transport,max_pages=10000).collect(route,window,state)->Batch；保单还支持check(route,state)。query/post均在本模块。
- 各模块auth.Auth(config,client=None,probe=None,capture=None).ensure(route,renew=False,wait_seconds=15,force=False)->state。
- 各模块repository.Repository(Database).write(route,window,batch)拥有事实SQL；init_schema()初始化本来源表/视图及公共审计。
- 各模块cli.parser()/read_task(args)/execute(args)/main(argv=None)构造具体组件；collect/check-auth/authorize/init-db，无需主目录。
- utils.runtime.CollectionService(repository,auth,collector).execute(route,window)->结果，不接source factory，不决定具体来源。
- utils.database.Database：connect(config)、close、lock(name)、transaction()、failure/audit；没有平台分支和业务事实SQL。
- scripts.registry.get(source)返回来源模块，make_task统一分派给该模块；调度从来源模块创建Auth/Repository/Collector，不持有协议细节。

## 分工和验证

1. 先写依赖边界失败测试：禁止scripts导入live_data；屏蔽live_data后四脚本仍可dry-run；live_data只允许调度文件；四repository有本地write SQL。
2. 共用设施和catalog迁移；来源模块拆分；主任务调整registry、调度、测试和文档，保持单向依赖。
3. 四来源单独执行参数/鉴权/采集/事务的合成测试；旧的100项行为测试迁移到新模块，保留生产MySQL跳过边界。
4. 验证真实工作簿仍为20任务、ID一致、字段契约及SQL视图不丢失；独立审查不能仅凭目录形状判定完成。

不执行真实生产API、登录、SMS或数据库写入。所有输出在live_data_design，原Excel保持不变。

## 完成记录

计划已实施：四源自治、共用设施迁移、目录管理分离、中央实现删除，规格和使用文档同步更新。139项测试134通过，5项MySQL条件跳过；真实工作簿20项任务及身份保持一致。详见VERIFICATION.md。
