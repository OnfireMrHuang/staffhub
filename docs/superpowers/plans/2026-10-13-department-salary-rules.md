# 部门薪酬规则 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将薪酬规则改为部门下的独立规则，弹窗配置指标、时薪和项目集，发布生成月度核算任务。

**Architecture:** 保留历史来源类型与资料；新增 DepartmentRule 引擎替代当前三层方案。指标先按员工及绑定项目集汇总，ROI、时耗重算，每项分别乘绑定时长后相加。发布保存不可变规则快照，同月全部已发布任务原子核算成功后形成工资表并归档。

**Tech Stack:** React、Vite、Radix UI、Zustand、TypeScript、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-09-staffhub-phase-one-design.md`；本次用户确认：各项薪资相加，关联指标范围决定该档位时薪。

## Global Constraints
- 现有六条来源规则迁入直播部；绩效提成、月薪目标不再是当前规则实体。
- 数据集固定字段分类：hours/nightHours/earlyHours 为时长，其余统计数值为常规指标。
- 投放部、素材部新增月薪规则显示“待开发”。
- 所有归档月份拒绝来源变更、规则任务追加和重新核算。
- 仅本地 DEMO；不提交、不发布外部服务，不变更原飞书数据。

## Review Focus
- 开放上下限及闭开边界必须准确，重叠、多命中、缺失阻止核算。
- 不同时长各自乘时薪；零时长项贡献为零，不触发不必要的档位匹配。
- 关联指标按关联字段范围匹配，与自身指标档位唯一命中。
- 草稿修改不改变已发布任务快照，重复发布同规则同月拒绝。
- 当月多任务全部成功才归档；任一失败不写部分结果。

### Task 1: 规则类型与引擎
**Files:** 新增 `src/payroll-rules.ts`、`src/payroll-rules.test.ts`；修改 `src/domain.ts` 为工资明细增加可选组件。
**Interfaces:** DepartmentRule 包含 id/name/departmentId/version/status/metrics/expression/projectIds/sourceNote/sourceFloor；RuleMetric 包含 id/field/durationField/rate/bands；RuleBand 包含 keyType/exact/min/max/includeMin/includeMax/rate/relatedField。导出 monthlyMetricOptions、migrateHourlyRules、validateDepartmentRule、calculateDepartmentRules。
- [x] 先写并运行开放区间、关联匹配、不同 duration、项目集重算、部门过滤、来源低 ROI 保底、排名多项目拒绝测试（红）。
- [x] 实现上述接口；rank 不可跨项目相加或平均，绑定多个项目且使用排名时明确拒绝。
- [x] 跑专项测试（绿），保留原来源档位，sourceFloor 明确作为历史来源优先条件，不静默删除。

### Task 2: 草稿、发布与任务
**Files:** `src/store.ts`、`src/store.test.ts`、`src/live-store.test.ts`；新增任务专项测试。
**Interfaces:** departmentRules、payrollTasks；saveDepartmentRule(rule)、publishDepartmentRule(id,month)。任务包含不可变规则快照，状态待核算/已核算。runPayroll 原子计算当月任务，汇总员工各规则结果，归档后保留原锁定/工资发布流程。
- [x] 写并运行草稿不产任务、发布快照、重复发布、归档发布拒绝、多任务失败原子性测试（红）。
- [x] 新本地存储 key 保留旧 key 作为历史资料，现有六条规则全为直播部草稿，示例三个项目绑定前三条规则。
- [x] 实现任务生命周期，更新既有归档测试为先发布规则，验证全部通过。

### Task 3: 部门规则弹窗及薪酬核算页面
**Files:** `src/pages/Rules.tsx`、新增规则弹窗组件及样式；`src/pages/Payroll.tsx`。
- [x] 规则列表按直播/投放/素材部门切换；新增、编辑、查看全部弹窗，保存与发布分离。
- [x] 指标从固定月度表选取；常规指标指定时长并维护 exact/range/related 档位；时长直接填时薪。
- [x] 通过选择第一指标、追加指标形成 + 表达式；单选多选项目；只读详情完整显示规则。
- [x] 薪酬核算展示发布生成的任务，工资明细展示每项指标、匹配字段、时薪、时长和金额。
- [x] 真实浏览器验证新增、保存、详情、发布、任务、核算、归档及待开发入口。

### Task 4: 规格与整体验证
**Files:** 主规格、变更规格、README、App 导览与流程。
- [x] 替换三层模型、数据库表、数据流图、发布任务与工资公式，保留来源及边界说明。
- [x] `npm test`、`npm run build` 全部通过；独立审阅后修复实际缺陷；截图交付。

## Rulings
- 同月所有已发布规则任务一次核算，全部成功后立即归档，避免部分任务归档阻塞剩余任务。
- 已有低 ROI 来源保底作为迁移规则显式只读优先条件保留；新规则不自动添加该条件。
- 不叠加旧方案固定薪资；新月薪为表达式各项薪资之和。已有固定薪资资料保持员工基础数据不变。
- 本次使用已有工作目录；不撤销既有改动，不新建外部发布。


## 验证记录

- 新增规则引擎14项、任务生命周期16项；完整11文件130项通过，最终构建通过。
- 浏览器：六条规则迁入直播部；投放和素材新增显示待开发；新增弹窗包含ROI开放上下限、夜班直接时薪、时耗关联ROI并绑定早班时长；三项表达式、两个项目保存成功，保存不产生任务。
- 发布确认展示实际员工、表达式和叠加提示；两任务核算8人合计17320，菅心茹组合1560+来源1600=3160，后续草稿v2不改变已发布v1任务。归档持久化、锁定及发布正常。
- 浏览器撤回任务后有效任务为0，核算禁用；原v1已撤回保留，编辑发布v2后仅一条有效任务可核算。
- 独立审阅发现并修复新增参与员工静默遗漏：名单任何增减阻止整月核算；补充待核算任务软撤回及修正版发布；原历史快照不可变。
- 最终浏览器恢复六条来源草稿的初始汇报状态。截图：artifacts/department-rules-demo.png、artifacts/department-rule-editor.png、artifacts/department-payroll-detail.png。
- Ruling: 待核算任务允许软撤回，保留版本与名单历史，再发布修正版；已核算或归档任务不允许撤回。修正规则错误或名单变化无需覆盖历史。
