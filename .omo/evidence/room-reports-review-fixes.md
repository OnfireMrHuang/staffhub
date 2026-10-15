# Room reports review repairs

The HIGH rate finding was reproduced with three new failing tests before the fix. Both optional denominators were omitted while source hourly `clickRate=0.17` and `conversionRate=0.12` remained valid measured values. The tests failed because both reports became null.

`src/room-reports.ts` now uses explicit native-rate evidence only for one measured hour and its single-hour daily grouping. A correction or persisted overlay preserves that evidence only when the corresponding numerator still equals the source numerator. Changing clicks invalidates clickRate alone; changing conversions invalidates conversionRate alone. Verified denominators still drive recalculation. Multi-hour daily groups with incomplete denominators stay null and never average source rates. This also applies to correction previews, refreshed hourly overlays, single-hour daily overrides, and downstream allocation. The schema explanation now states this contract.

Coverage in `src/room-reports.test.ts`:

- Native hourly and single-hour daily rates survive missing optional denominators.
- Spend-only changes preserve both measured rates through override replay.
- Single-hour daily revenue-only override preserves both measured rates.
- Click and conversion numerator edits invalidate only the corresponding rate.
- Replayed numerator-changing overlays retain that invalidation.
- Multiple one-hour measured rates remain visible hourly while their daily rates are undefined.

The MEDIUM deletion-only test was replaced. `src/pages/RoomReports.test.tsx` now renders the real Operations monthly default, asserts exactly one table with the intended edit action for every employee/room row across rooms, and verifies filtering/export affordances. Separate real hourly/daily surfaces assert their room, fixed definition, source time/date grain, and actual row counts. The raw input surface asserts a real source record ID/date/span and its entry/import/export actions. No legacy-copy absence assertions or business mocks remain.

Report tables retain the monthly table's shared sticky right action-column styles.

Validation performed:

```
npm test -- src/room-reports.test.ts src/room-reports-store.test.ts src/pages/RoomReports.test.tsx
Test Files  3 passed (3)
Tests       22 passed (22)
```

`npm run build` passed; Vite continues to warn that the main bundle exceeds 500KB. No server or browser was used for these repairs. The final full-suite run is reserved for the parent task after review.
