# 主播分层薪酬核算实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将用户确认的三范围规则应用到主播月度核算，交付分组月薪表、规格和可视化。

**Architecture:** 沿用现有规则配置模型，在 calculateCompensation 中增加分范围金额和统计快照。页面、导出、示例消费同一结果；历史快照通过 settlementVersion 区分。

**Tech Stack:** TypeScript、React、Zustand、Vitest、XLSX。

**Spec:** docs/superpowers/specs/2026-10-16-layered-payroll-settlement.md

## Global Constraints

- 保留当前工作区另一个任务的修改，规则配置 UI 不归本任务修改。
- 总计月薪 = max（最终保底金额，累计加成金额）+ 总计补贴。
- 先系数、ROI 与排名，后时薪。统计展示保留来源值。
- 不改写历史归档。

## Review Focus

- 无主播角色行必须排除，混合角色含主播行仍导入。
- 保底在金额层比较，跨时长不会各自取大再相加。
- 无范围规则和无任何命中规则的主播行保持可解释的零结果。
- 保费影响 ROI/排名但不直接计入月薪，排名只在主播集合中计算。
- 旧快照无新增字段时仍能展示。

## Tasks

- [x] 引擎：先新增 src/compensation-settlement.test.ts 并确认失败；扩展 src/compensation-rules.ts 结果字段和分层计算，运行新旧规则测试。
- [x] 页面和导出：新增独立分组表格/明细组件、两行表头 XLSX 构建，接入 src/pages/Payroll.tsx，验证表头、金额和历史回退。
- [x] Store：发布参与人仅主播，整月导入所有有效主播行，冻结新结果，验证参与人和快照。
- [x] 示例和说明：提供固定示例、可重算月薪表、规格和交互流程，验证示例金额与引擎一致。
- [x] 整体验证：npm test、npm run build、页面实测与独立审查；修复发现的问题并记录证据。
