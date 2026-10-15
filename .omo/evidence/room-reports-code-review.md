# Code-quality review: room reports

- **Goal reviewed:** `docs/superpowers/plans/2026-10-15-room-reports.md`
- **Scope reviewed:** working-tree changes to the room-report domain, store, report/monthly surfaces, operations navigation, docs, and focused tests.
- **Skill-perspective check:** `remove-ai-slops` and `programming` were not available in the supplied skill catalog, and a filesystem search of the configured skill roots found neither `SKILL.md`. Their requested criteria were applied manually. The production diff does not add needless parsing, data extraction, or an untyped escape hatch for the feature. It does violate the `remove-ai-slops` test perspective through a deletion-only UI test described below.
- **Evidence inspected:** full source diff and new files; `src/live-domain.ts`, `src/room-reports.ts`, `src/store.ts`; focused tests. Command run: `npm test -- --run src/room-reports.test.ts src/room-reports-store.test.ts src/pages/RoomReports.test.tsx src/operations-navigation.test.ts` (4 files / 19 tests passed). `git diff --check` passed.

## Findings

### CRITICAL

None.

### HIGH

1. **Hourly reports discard a valid platform rate whenever the adapter omits its optional denominator.**
   - **Location:** `src/room-reports.ts:26`, reached by `asReport` at `src/room-reports.ts:30` and hourly construction at `src/room-reports.ts:46-49`.
   - **Why it is wrong:** `RoomHourly.clickRateDenominator` and `conversionRateDenominator` are optional. `derived()` always replaces `clickRate` and `conversionRate` with `ratio(..., denominator)`, which is `null` when an optional denominator is absent. The existing source-domain contract explicitly preserves the one-hour source rate in that condition (`src/live-domain.ts:54-59`): a platform-provided hourly rate is evidence and must not be re-derived from an unverified denominator.
   - **Reproduction:** supply a valid one-hour `RoomHourly` with `conversionRate: 0.12`, `conversions: 12`, `clicks: 100`, and `conversionRateDenominator: undefined`. `buildRoomReports(...).hourly[0].conversionRate` becomes `null`; the performance report definition exposes this field (`src/room-reports.ts:18`), so the UI renders `未定义` instead of the measured 12% source rate. The same loss occurs for `clickRate`. Multi-hour aggregation may remain undefined without verified denominators; the defect is the one-hour source case.
   - **Required fix:** retain the raw hourly rate when a report row represents one source hour and the associated denominator is absent, matching `aggregate()`; retain `null` for multi-hour/no-verified-denominator aggregations. Add a test for both raw rate fields.

### MEDIUM

1. **The monthly-surface test is a deletion-only, brittle implementation test.**
   - **Location:** `src/pages/RoomReports.test.tsx:10-12`.
   - **Why it matters:** assertions such as `not.toContain('直播统计明细')`, `not.toContain('业务分区')`, and `not.toContain('编辑直播明细')` only verify removal of literal strings from server-rendered markup. They can pass if the old interaction remains reachable but text changes, and fail on harmless copy changes. This is the `remove-ai-slops`/`programming` pattern of a deletion-only prompt/implementation test, rather than behavior coverage.
   - **Required fix:** replace it with a behavior-oriented surface test: render Operations with the monthly section selected and assert that it renders the single monthly table and its intended edit action, while the raw route renders the input surface. Avoid asserting absent legacy copy.

### LOW

None.

## Scope and maintainability assessment

- The six navigation entries and aliases are centralized in `src/operations-navigation.ts`; the native buttons and `aria-expanded`/`aria-current` wiring in `src/App.tsx` are proportionate and accessible.
- Fixed demo definitions and bindings are explicit, shared definitions are actually shared, and unknown rooms render an explicit unbound state rather than taking a fallback definition.
- The correction layering is coherent: hourly corrections feed daily and monthly, daily correction allocation is explicitly downstream-only, and monthly overrides are applied last. Archived snapshots include report data, bindings, definitions, audit, and overrides; old snapshots intentionally retain their frozen monthly values without synthesized reports.
- No unnecessary production normalization/parsing was found for this goal. The `as unknown as Record<string, unknown>` casts in existing store comparison code are localized and do not create a new feature-level boundary escape.

## Result

- **Superseded by the re-review below.**
- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**
- `reportPath`: `.omo/evidence/room-reports-code-review.md`
- `blockers`:
  1. Preserve valid one-hour platform `clickRate` and `conversionRate` when optional denominators are absent, with focused regression coverage.

## Re-review of repairs

Reviewed the repair evidence at `.omo/evidence/room-reports-review-fixes.md` and the resulting production/test diff.

- **HIGH finding resolved:** `src/room-reports.ts:26-35` now retains a source rate only for a single actual measured hour whose numerator has not changed. `src/room-reports.ts:40-43` supplies that evidence to a single-hour daily group only. The implementation correctly keeps a multi-hour group with incomplete denominators at `null`; it does not average source rates. `prepareReportCorrection` and `overlayReportRow` pass the prior source row to the same guarded calculation, so spend/revenue-only changes preserve the evidence while click/conversion changes invalidate their respective rate. Tests at `src/room-reports.test.ts:60-89` cover native hourly/daily rates, spend-only overlay replay, daily replay, per-numerator invalidation, and the no-invented-average case.
- **MEDIUM finding resolved:** `src/pages/RoomReports.test.tsx:15-27` replaced the deletion-only literal-absence assertions with real Operations/monthly and raw-input surface assertions. It verifies the one monthly table, each employee-room edit action, cross-room coverage, filter/export affordances, and actual source record/time-span input content.
- **Additional final change reviewed:** `src/store.ts:94-98,199-202` prevents source identity changes for a raw record referenced by a saved hourly or daily report correction. Its compatibility parser is narrow and needed only for earlier normalized hour identities. The atomic rejection and restore-unlocks-input path are covered at `src/room-reports-store.test.ts:70-79`; unrelated raw insertion remains allowed at `:81-86`.
- **Validation independently run:** `npm test -- --run src/room-reports.test.ts src/room-reports-store.test.ts src/pages/RoomReports.test.tsx` — 3 files, 22 tests passed. `git diff --check` passed. Build success is supported by the supplied repair evidence and was not needlessly repeated.

### Final result

- `codeQualityStatus`: **CLEAR**
- `recommendation`: **APPROVE**
- `reportPath`: `.omo/evidence/room-reports-code-review.md`
- `blockers`: none.
