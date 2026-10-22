# 来源导入与业务目录

本说明对应 [SPEC.md](SPEC.md) v3。live_route仅是关系的抽象表达；程序既不创建实体live_route，也不让Excel排版决定业务表结构。

## 从Excel到业务模型

```mermaid
flowchart LR
    X[产品账户横表 + 应用/后台纵向组] --> P[布局适配和字段校验]
    P --> S[三张来源镜像]
    P --> B[八张规范业务表]
    S -.同一发布事务.-> B
    B --> A[v_live_ad_task]
    B --> I[v_live_policy_task]
    A --> T[单账户广告任务]
    I --> U[单房间保单任务]
```

来源镜像保存已映射的非敏感业务列、工作表ID、源行和文件版本，供追溯。业务目录保存独立产品、直播间、广告平台、保单平台、OAuth应用、广告账户、房间账户绑定、房间后台绑定。运行从业务表读取；产品拥有的账户和平台通过直播间关系取得。

## 真实工作簿解析

`config/workbook.example.toml`的xlsx模式使用本目录 `第一期试点直播间产品.xlsx`：

- 产品账户信息：读取保险产品、直播间、保费看板地址、账户ID、账户名称、账户类型、账户平台。仅按真实merge范围展开前三列的共享值；纯空白尾行忽略。
- 巨量引擎应用信息：按纵向分组读取app_id及平台来源；secret、授权码获取链接、token示例不写入业务快照。
- 产品统计后台信息：按纵向分组读取看板地址；依据明确主机与merchantChannel/dyNo/livePlatform匹配账户表中的看板，不用显示名称猜测。登录账号/密码/手机号不写入业务快照。

布局适配后转为canonical tables：accounts、applications、backends。它们与普通JSON快照走同一映射和关系校验。XLSX配置的columns是适配后的英文字段，不能误认为原Excel首行已有这些英文列。

文件摘要作为统一版本，读取过程中改变即拒绝。任意未知来源、关联缺失、外键空白、重复范围均在提交前拒绝，旧镜像与业务目录保持不变。

## 身份、范围和认证

本工作簿没有独立产品/房间ID，以产品名称及产品+房间名称生成确定性ID，名称单独保存。重排行不会改变ID；改名会产生新ID，需显式迁移。不同产品可以有同名房间。

账户关联应用优先使用显式app_id；未映射该列时仅允许同来源唯一启用应用，已映射但为空则拒绝。一个应用对应一个独立凭据别名和环境前缀；运行前核对环境APP_ID。

本试点按账户全量统计，每账户仅归属一房间；同账户跨房间时必须明确广告筛选范围，禁止自动复制账户总量。众安看板dyNo是保单选择器，不自动当广告aweme。每房间的保单任务只生成一次，且同一个后台选择器不能无过滤复制给多个产品。

`application_credentials`键为来源:应用ID；`backend_credentials`键为来源:后台选择器。这是部署认证别名映射，不是另一份业务归属清单。真实密钥只存在受限环境或私有缓存。

任务ID只由source/product_id/room_id/account_id及真实范围（版本、账户/aweme、channel或dyNo+platform）决定；credential、app_id、指标列表、Excel行号不参与ID。独立脚本、任务JSON和目录调度使用同一个实现。

## 事务、视图和运行

sync-sources持导入锁，完整解析与校验后，在同一事务替换三镜像及业务目录。删除或停用的绑定不再生成未来任务，历史事实保留。目录读取使用同一一致快照，读取后提交；调度不长期占用目录事务。

`v_live_room_sources`用于展示关系；采集读两个独立任务视图，避免横向账户×后台关系导致保单重复。调度持scheduler锁，单任务持查询范围锁；授权维护仅使用每凭据文件锁。

主数据由 `scripts/catalog/` 维护，建表及同步入口为 `python -m scripts.manage`。`live_data` 仅消费目录并调度。

## 命令边界

| 命令 | 数据来源 | 是否连接MySQL |
| --- | --- | --- |
| inspect-sources | 源文件/远程普通表头，仅输出安全表头信息 | 否 |
| sync-sources --dry-run | 完整来源解析和关系验证 | 否 |
| sync-sources | 来源→镜像及业务目录事务发布 | 是 |
| schedule --dry-run | 业务目录→任务计划 | 是，但不采集 |
| scripts/*.py collect --dry-run | 明确参数或任务JSON | 否 |
| scripts/*.py check-auth/authorize | 明确任务+私有认证状态 | 否 |
| scripts/*.py collect | 明确任务+业务接口→事实表 | 是，不依赖业务目录 |

通用JSON及Feishu普通表头适配仍可用于其他输入，但不会自动解释本工作簿的纵向分组。当前推荐来源是已提供的xlsx，不再要求补充飞书API令牌才能验证这份试点数据。
