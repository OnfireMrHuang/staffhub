# 直播业务流程 DEMO 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** 用固定直播记录与平台小时数据生成全岗位月度统计，成功核算后归档并统一阻断历史数据写入。
**Architecture:** 保留账号、员工及三层薪酬计算函数。新增独立直播业务类型/统计函数，Zustand 管理来源和归档状态，运营页只消费该接口。
**Tech Stack:** React / Vite / Radix UI / Zustand / TypeScript，现有 XLSX。
**Spec:** docs/superpowers/specs/2026-10-13-staffhub-business-flow-revision.md 及本轮确认。

## Global Constraints
- 无后端、无真实平台授权、无发布；新小时数据明确模拟，原实际月度资料不伪造小时明细。
- 三模型：直播记录、投放基础数据、直播间基础数据；两张运营统计表字段固定。
- 三岗位均按员工+项目+年月汇总；同一人兼岗不重复同一记录，岗位贡献金额不相加为项目总额。
- 金额来源仅直播间基础数据；保费=营销成交金额；夜班[02:00,06:00)，早班[06:00,08:00)，ROI同项目同月竞争排名。
- 员工姓名唯一，项目不含员工关联；密钥和授权码不持久化。
- archivedMonths 持久化，全月份成功核算与归档一次提交；失败不归档；原/新日期及同步都检查。
- 新持久化命名空间保留旧版浏览器数据，不静默重新解释旧源文件。

## Review Focus
- 编辑移出归档月仍必须拒绝；上传混合归档和未归档行整批拒绝。
- 多账户聚合不混加投放消耗；三岗位贡献展示不会让项目总额翻倍。
- 同一人兼任多角色只能有一条员工项目月度行。
- 缺小时源、非整小时尚未确认分配方法、人员/项目重复或不匹配不能静默默认零。
- 锁定/发布操作使用成功核算时冻结依据，之后改其他月份不影响归档工资。

## 文件及接口契约

### 核心统计：core worker 所有权
`src/live-domain.ts`, `src/live-domain.test.ts`, `src/live-seed.ts`, `src/domain.ts` 中 Project 类型, `src/real-seed.ts` 的项目初始化适配。
Project 保留 id/name/code/account/platform/active/access，删除 employeeIds，增加 liveAccountIds:string[]；access 增加可选 authCodeConfigured:boolean。
LiveRecord: id, projectId, date YYYY-MM-DD, start/end HH:mm（支持24:00）, hostId/buyerId/controlId, version。
AdHourly: id/projectId/date/start/end/spend/payment/impressions/clicks/conversions/conversionCost/conversionRate/orders。
RoomHourly: id/projectId/accountId/date/start/end/spend/revenue/clicks/clickRate/clickCost/conversions/conversionRate/conversionCost/roi/orders/viewers/fans/tips。
LiveDetail extends LiveRecord: projectCode/projectName/hostName/buyerName/controlName + RoomHourly 数值字段。
LiveMonthly extends WorkRow: roles:string[], hostNames:string[], year:number, nightHours/earlyHours/nightSpend/earlySpend, roiRank, sessions/nightSessions/earlySessions。
Functions:
- generateLiveTemplate(projectIds:string[],date:string,start:string,end:string,stepMinutes:number): {projectId,date,start,end}[]。
- validateLiveRecord(record:LiveRecord,employees:Employee[],projects:Project[],existing:LiveRecord[],archivedMonths:string[]):void。
- buildLiveStatistics(records:LiveRecord[],rooms:RoomHourly[],employees:Employee[],departments:Department[],projects:Project[],month:string):{details:LiveDetail[],monthly:LiveMonthly[]}。
- 用户已确认仅整小时对齐，不支持比例分配；场次按连续同项目同三岗组合合并。
Seeds: demoProjects:Project[], demoRecords:LiveRecord[], demoAdHours:AdHourly[], demoRoomHours:RoomHourly[], demoScheme:Scheme, demoMonth='2026-10'。复用 seedEmployees/seedDepartments/seedRules；选择有时薪规则的2-3真实项目名称，用虚构10月小时数据。demoScheme明确选择这些项目的主播员工，固定薪资0。

### 状态/归档：store worker 所有权
`src/store.ts`, `src/store.test.ts` 改为新来源场景, `src/live-store.test.ts`。保留认证接口兼容 auth-store.test.ts。
新增公开状态 liveRecords:LiveRecord[], adHours:AdHourly[], roomHours:RoomHourly[], archivedMonths:string[], liveDetails:LiveDetail[], monthlyRows:LiveMonthly[]。
保留 dataset.rows 为 monthlyRows 的 WorkRow 兼容视图，dataset/month/revision/version/published；移除可配置fields/事实录入的产品接口，旧 Fact 核心测试可以独立保留。
Methods: saveLiveRecords(records:LiveRecord[]):void（原子批量upsert；同时检查被替换旧日期），sync():void（针对选中月份，归档月拒绝），cleanDataset():void（固定两表构建，归档月拒绝覆盖快照），已有 saveEmployee/saveProject/saveRules/runPayroll/lockBatch/publishBatch。
runPayroll 成功后更新 batch/batches 与 archivedMonths，同步冻结当前数据依据；已归档月拒绝重算覆盖。lockBatch 不因其他月份变化或后续基础档案编辑否认已归档依据；发布后本人薪资条照常。
持久化export partialize保留来源与归档集合；新key meimei-staffhub-live-v1（旧数据不删）。

### 运营页面：UI worker 所有权
`src/pages/Operations.tsx`、`src/pages/ProjectConfig.tsx`、新增运营子组件、`src/project-access.ts/test.ts`，仅新CSS文件 `src/live-operations.css`（从 Operations import，避免覆盖父代理styles.css）。
项目列完整：编码、名称、三平台、投放账户、状态、多直播账户、应用ID/密钥/授权码；无员工配置。Access helper支持各平台应用标识为文本；新增授权码输入仅保存标记。
数据录入三模型，直播记录完整字段/过滤/编辑、全参数模板、多项目选择、XLSX上传/表单同一saveLiveRecords检查；导入用唯一姓名解析ID、核对编码名称，批量失败不写入；模板员工参考页。
两基础模型固定全字段，按月/日/项目/账户筛选，来源模拟标签，sync调用store；archive显示只读并禁写。
固定运营表两个标签完整字段，统计明细包含三岗位，月度行包含roles/hostNames展示；无字段配置按钮，允许导出和固定统计刷新。

### 父代理整合所有权
App.tsx 业务流程弹窗/导览/来源提示；Rules/Payroll/Profile/Roles/People 文案和新来源绑定；主规格/变更草案/README。

## 执行任务
- [x] 核心：先写失败测试（模板48行、班次边界、人员归属、同人兼岗、多账户、排名、防重/缺口）；实现再通过。
- [x] 状态：先写失败测试（归档拒绝各入口、旧新日期、混合上传、失败不归档、跨月快照、姓名唯一）；实现再通过。
- [x] 页面：实现完整字段及交互，构建验证，实际浏览器生成/上传/编辑/统计/核算归档/再编辑拒绝。
- [x] 父代理更新规格：确认来源、岗位、班次、排名；替换旧受影响章节，补MySQL表和验收，保留账号背景。
- [x] 综合检查所有测试及构建，独立代码复核，截图和可用预览。

## Ledger
- Ruling: 复用当前工作区并按文件所有权分工，不创建丢失未提交DEMO的 worktree，不提交/部署。
- Ruling: 小时数据使用模拟10月样例，真实9月源资料保留原文件与旧命名空间；新数据明确模拟。

- Ruling: 用户进一步确认整小时记录与连续同人员组合合并场次；不做小时比例分摊。
- Ruling: 比率只采用明确平台分母，未知或成本零分母返回null、显示未定义；模拟源显式提供虚构分母，观看人次不作为通用点击率分母。
- Ruling: 新项目平台/账户修改只在无来源历史时允许；已有来源绑定冻结，名称/启停/凭据可改，避免重解历史。
- 核心、状态和UI均先失败后通过有意义测试；复核3项（率分母、历史账户修改、任职校验）已修正并复核通过。
- 浏览器验证：双项目全天模板48行+员工参考；上传48行后总78，编辑原记录version1→2；缺小时阻断，模拟sync补当前日期后来源AD216/ROOM288；刷新得12位全岗位汇总，6位主播工资10620。10月核算自动归档；刷新重新登录限制仍生效；11月表单新增成功，10月仍可锁定/发布；员工菅心茹仅本人薪资4000。
- UI修正：新记录默认日期即使归档，仍可改为开放日期（只禁止保存）；已存在归档记录仍整表只读。长姓名表单网格不横向溢出。
- 截图：artifacts/live-workbench-monthly.png，artifacts/live-record-archived.png。旧实际源及旧浏览器namespace保留；无提交、推送、外部发布。

- 最终统一验证：100/100测试通过，npm run build成功；最后定向复核通过，无阻断问题。本地服务5174保留，IAB统计预览保留。
