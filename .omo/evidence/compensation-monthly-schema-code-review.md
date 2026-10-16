# Code-quality review: 2026-10-16 monthly schema

## Verdict

- `codeQualityStatus`: **CLEAR**
- `recommendation`: **APPROVE**
- ULW attempt path: unavailable; `omo ulw-loop status --json` reports `ULW_LOOP_PLAN_MISSING`, so this is stored at the fallback evidence path.

## Evidence reviewed

- Current uncommitted source and focused tests covering `live-domain`, `room-reports`, `dataset-corrections`, `compensation-rules`, and the monthly table/export.
- The exact 33-column list is independently confirmed in [LiveMonthlyTable.test.tsx:11](/Users/huangwenwu/meimei/staffhub/src/pages/LiveMonthlyTable.test.tsx:11), and both rendering and export share `monthlyColumns` at [LiveDatasets.tsx:34](/Users/huangwenwu/meimei/staffhub/src/pages/LiveDatasets.tsx:34) and [LiveDatasetFields.ts:34](/Users/huangwenwu/meimei/staffhub/src/pages/LiveDatasetFields.ts:34).
- No server, browser, or full suite was run. Post-change execution evidence was not supplied as an inspectable artifact, so this report does not independently claim the targeted suite passed.

## Skills perspective

`remove-ai-slops` and `programming` remain unavailable in the supplied catalog/workspace, so their requested criteria were applied directly. The 33-column field list is a useful shared source for the table and export, and the new tests assert a real contract rather than a deletion-only change. No needless parser, untyped escape hatch, or implementation-mirroring test was found in this focused layer.

## Findings

### CRITICAL

None.

### HIGH

None. The prior finding was incorrect and is withdrawn. The actual current [catalogNames](/Users/huangwenwu/meimei/staffhub/src/dataset-corrections.ts:33) returns `roomOpenedOn`, and [prepareDetailCorrection](/Users/huangwenwu/meimei/staffhub/src/dataset-corrections.ts:63) spreads that target-room metadata after the old row. The added regression at [dataset-corrections.test.ts:180](/Users/huangwenwu/meimei/staffhub/src/dataset-corrections.test.ts:180) follows reassignment through correction application and export, asserting the target room's `2026-06-01` date. Re-reading the actual current implementation supports that result.

### MEDIUM

None.

### LOW

None.

## Confirmed behavior

- The 33 business columns and their order are centralized and shared by table/export; internal roles, hosts, and session count are excluded.
- Monthly metadata is initially snapshotted from employee/room source values; missing historical values render as undefined rather than being backfilled.
- Night/early provenance stays unknown if a detail time edit invalidates it. Daily correction allocation keeps known source proportions only when a nonzero observed denominator exists.
- `regularPremium` is derived as total minus night and early premium, while effective compensation uses `regular + early × coefficient`; the effective regular field avoids a second night deduction ([compensation-rules.ts:152](/Users/huangwenwu/meimei/staffhub/src/compensation-rules.ts:152), [compensation-rules.ts:267](/Users/huangwenwu/meimei/staffhub/src/compensation-rules.ts:267)).
- `spendRank` is a descending competition rank scoped to live room and month, including zero spend, and AD/policy cost render “待定义” without a fabricated formula.

## Blockers

None.
