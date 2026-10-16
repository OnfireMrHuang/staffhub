# 条件加减与字段保薪实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development 按任务实施并验证；当前会话已授权直接修改 DEMO 与规格，无需新增确认。

**Goal:** 保薪条件支持数值加减，保薪时薪可读取员工月度汇总表字段，并新增过去3个月的平均时薪字段。

**Architecture:** 延续现有结构化条件 AST 和月度人工修订层。规则保存固定 `rate` 或字段 `rateField`，命中条件后读取原始月度行，计算证据及归档快照保留实际取值。平均时薪作为可维护的月度输入，不在本次猜测历史平均算法。

**Tech Stack:** React、Vite、Radix UI、Zustand、TypeScript、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-15-compensation-rule-rebuild.md`，`docs/superpowers/specs/2026-10-09-staffhub-phase-one-design.md`。

## 全局约束

- 保持既有固定保薪、条件类型约束、归档不可修改和核算复核流程。
- 只接收有限非负输入；数值减法结果允许负数。月份数值运算不隐式跨年换算。
- 新历史平均字段允许空值，不填不补零，不制造历史薪资。
- 不改变用户当前 DEMO 数据；浏览器验证使用独立本地端口。

## 复核重点

- 原日期与日期提取后的数值严格区分；运算先于比较，证据可读。
- 固定/字段切换不残留另一种来源；非数值字段不能用作时薪。
- 未命中的保薪不读取缺失字段，命中时缺失必须明确报错。
- 保费系数改变有效 ROI 等指标时，不改变保薪字段的原始汇总来源。
- 月度人工值在刷新、持久化、导出和归档中保留；历史缺失值仍为空。

## 任务1：数值条件

**文件：** `src/compensation-rules.ts`、`src/pages/ConditionBuilder.tsx`、`src/compensation-rules.css`、`src/pages/Payroll.tsx`、对应条件测试。

**接口：** `NumericAdjustment={operator:'add'|'subtract';value:number}`；`Condition.adjustment` 与 `compareAdjustment`。

- [x] 测试两侧加减、日期提取、负结果、溢出、非法类型及旧规则兼容。
- [x] 编辑器提供不运算/加/减及常数，切换类型清理配置；核算展示原值和计算值。
- [x] 执行 `npx vitest run src/condition-arithmetic.test.ts src/pages/ConditionBuilder.test.tsx`。

## 任务2：月度平均时薪字段

**文件：** `src/live-domain.ts`、`src/dataset-corrections.ts`、月度表字段/结构/编辑组件及其测试。

**接口：** `LiveMonthly.past3MonthsAvgHourlyRate?:number`，单位元/小时，有限非负数或空值。

- [x] 覆盖缺失、零、小数、非法值、刷新保留和归档冻结。
- [x] 接入统一列定义、编辑、结构及导出，固定列数变为35。
- [x] 同步薪资结果表列数测试：当前46列，历史三范围50列。

## 任务3：字段保薪

**文件：** `src/compensation-rules.ts`、`src/pages/CompensationRuleDefinition.tsx`、`src/pages/compensation-definition.ts`、字段保薪测试。

**接口：** `HourlyItem.rateField?:string`，与 `rate` 互斥；`guaranteeRateFieldOptions` 提供真实月度表中的数值字段。

- [x] 测试固定值兼容、字段值读取、未命中跳过、非法来源拒绝、原始统计取值。
- [x] UI提供固定值/汇总表字段，默认字段为过去3个月的平均时薪，公式显示字段名。
- [x] 核算证据保留字段名和实际时薪；字段值随统计快照冻结。

## 任务4：整体验证

- [x] 更新主规格、规则规格、分层核算规格、示例和 README。
- [x] 执行 `npm test`、`npm run build`、`git diff --check`。
- [x] 隔离浏览器验证数值加减、保薪来源切换、字段编辑和只读详情。
- [x] 独立代码复核并修复发现的问题；不提交、不推送。

## 验证记录

- 2026-10-16：49个测试文件、551项测试通过，生产构建通过（保留已有包体积提示），diff格式检查通过。
- 独立只读代码复核无具体问题。
- 隔离端口52806验证：平均时薪65.25保存与刷新保留；条件数值加3及字段比较；固定值/字段切换；保存草稿、摘要及只读详情均通过。
- 自动审批拦截了测试规则的发布，认为会创建持久核算任务；已取消弹窗，未执行发布及后续浏览器核算。核心字段读取、命中/未命中和薪资金额由自动测试覆盖。
- 验证页面和临时服务器已关闭；真实DEMO数据未通过验证操作修改。截图：`artifacts/2026-10-16-guarantee-field-arithmetic.png`。
