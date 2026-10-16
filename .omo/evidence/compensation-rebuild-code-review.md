# Code-quality review: compensation rebuild

## Verdict

- `codeQualityStatus`: **CLEAR**
- `recommendation`: **APPROVE**
- Reviewed plan: `docs/superpowers/plans/2026-10-15-compensation-rebuild.md`
- ULW attempt path: unavailable. `omo ulw-loop status --json` returned `ULW_LOOP_PLAN_MISSING`; this report therefore uses the required fallback location.

## Evidence reviewed

- Current uncommitted diff, including the compensation core, store integration, source/correction pipeline, UI components, and the follow-up provenance repair.
- Focused test command run by reviewer:
  `npm test -- --run src/compensation-rules.test.ts src/compensation-store.test.ts src/dataset-corrections.test.ts src/live-domain.test.ts src/room-reports.test.ts src/pages/CompensationPages.test.tsx src/pages/CompensationRuleEditor.test.tsx`
  Result: 7 files / 139 tests passed.
- The parent reports a post-repair targeted run (119 tests) and build passed. No output artifact was provided, so that run is recorded as executor-reported rather than independently rerun; the parent still owns final full-suite verification.

## Skills perspective

The required `remove-ai-slops` and `programming` skills were unavailable in the supplied skill catalog and were not present in the workspace skill search, so their documented review criteria were applied directly. The repaired diff does not introduce an untyped escape hatch, needless abstraction, or production normalization outside the stated data boundary. The regression tests exercise provenance state transitions rather than merely checking copied implementation constants.

## Findings

### CRITICAL

None.

### HIGH

None. The prior HIGH provenance finding is resolved: [dataset-corrections.ts:61](/Users/huangwenwu/meimei/staffhub/src/dataset-corrections.ts:61) now makes `earlyPremium` unknown when the time span changes, when no original contribution exists, or when a zero-revenue source becomes nonzero. For an unchanged nonzero source span, it retains the explicit existing allocation ratio during a revenue correction. This matches the plan's permitted, traceable correction allocation instead of deriving an amount from hours.

The downstream report path uses the same rule: [room-reports.ts:33](/Users/huangwenwu/meimei/staffhub/src/room-reports.ts:33) preserves a known contribution only with a nonzero provenance denominator; [room-reports.ts:32](/Users/huangwenwu/meimei/staffhub/src/room-reports.ts:32) turns the aggregate unknown if any contributing amount is unknown. The focused coverage verifies time-change invalidation, zero-to-nonzero invalidation, monthly verified repair, and the daily-report propagation path at [dataset-corrections.test.ts:130](/Users/huangwenwu/meimei/staffhub/src/dataset-corrections.test.ts:130) and [room-reports.test.ts:131](/Users/huangwenwu/meimei/staffhub/src/room-reports.test.ts:131).

### MEDIUM

None.

### LOW

None.

## Confirmed strengths

- The core performs the required phase order: it applies matching allowance/premium rules, uses the maximum matching coefficient, recalculates effective ROI and room/month rank, then groups hourly calculations by duration and takes `max(guarantee, additions)` ([compensation-rules.ts:247](/Users/huangwenwu/meimei/staffhub/src/compensation-rules.ts:247), [compensation-rules.ts:274](/Users/huangwenwu/meimei/staffhub/src/compensation-rules.ts:274), [compensation-rules.ts:309](/Users/huangwenwu/meimei/staffhub/src/compensation-rules.ts:309)).
- Month-end reference dates, employee boolean defaulting, scope/condition validation, task row-key drift checks, mixed legacy/new task blocking, and atomic new-model batch persistence are present in the inspected source.
- Condition and trace UI expose nested conditions, band boundaries, formulas, and calculation evidence; the targeted UI render tests cover their main required controls.

## Blockers

None.
