# REGRESSION_TEST_REPORT.md

**Date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech` · **Base:** `1be9215` (post PR #1)

---

## 1. Final results (after all fixes)

| Suite | Files | Tests | Result |
|---|---|---|---|
| Backend `npx vitest run` | 10 | **702** | **PASS 702 / FAIL 0 / BLOCKED 0 / NOT RUN 0** |
| Frontend `npx vitest run` | 9 | **144** | **PASS 144 / FAIL 0 / BLOCKED 0 / NOT RUN 0** |
| Backend `npx eslint src` | — | — | exit 0 |
| Frontend `npx eslint src` | — | — | 0 errors (31 pre-existing `exhaustive-deps` warnings — AUD-114) |
| Frontend `npm run build` | — | 2,440 modules | PASS (8.6 s) |

Baseline before this pass: 668 backend + 132 frontend = 800, all green. **No existing
test was modified, skipped, or disabled** — the 800-test baseline ran green after every
fix (intermediate runs recorded in the working log).

## 2. New tests added this pass (46)

| File | Tests | Covers |
|---|---|---|
| `backend/tests/api/inventoryReconciliation.test.js` | 10 | mandated check #1 & #2: independent 3-way stock reconciliation; multi-challan inward remaining-qty invariant; race/over-issue/no-half-write |
| `backend/tests/api/regressionDefects.test.js` | 18 | AUD-201…206 — each failing pre-fix (verified by stash-run: 14 failed on old controllers) |
| `backend/tests/api/billingCalculation.test.js` | 6 | mandated check #3: piece/weight/lot-charge lines, GST splits, paise rounding, round-off, server-recompute |
| `frontend/tests/unit/jobcardFormPayload.test.js` | 2 | AUD-201 frontend guard (payload never carries `operations`) |
| `frontend/tests/unit/keyboardShortcuts.test.jsx` | 10 | mandated check #4: Escape layering (AUD-207 — 2 failed pre-fix), Enter-confirm guards, arrow navigation, listener cleanup |

## 3. Pre-fix verification (evidence that the tests catch the bugs)

Method: `git stash` of the source fix, run the new tests, `git stash pop`.

| Stashed fix | Failures on old code | Restored |
|---|---|---|
| 4 backend controllers | **14 / 18** regressionDefects tests failed (AUD-202×6, 203×2, 204×3, 205×1, 206×2) | ✓ all pass |
| `SearchableSelect.jsx` | **2 / 10** keyboard tests failed (AUD-207 layering + cleanup) | ✓ all pass |
| `JobcardForm.jsx` | payload-level defect — covered by source-guard + backend contract tests (mechanism pinned both sides) | ✓ all pass |

## 4. Cross-module regression (mandated check #5)

- Each fix is scoped (one handler or one payload); every module touching the changed
  code re-tested via the full suites after each change: jobcard↔tasks, returns↔stock↔party
  ledger, jobwork↔customer lots, stock summary↔jobwork lines, invoices↔GST.
- Authorization matrix re-ran after every change: **548/548**.
- Full-suite runs green at baseline, mid-pass and final (documented in commit history).
- Nothing skipped: `fileParallelism: false` keeps the shared Prisma stub deterministic.

## 5. Test status board (mandated categories)

| Category | Status | Where |
|---|---|---|
| Inventory movements & reconciliation | **PASS** | inventoryReconciliation (10) |
| Inward / multi-job-card remaining qty | **PASS** | inventoryReconciliation + AUD-206 (2) |
| Billing (qty/weight/rate/lot charge/tax/totals) | **PASS** | billingCalculation (6) + money-and-tax (24) |
| Job cards / production | **PASS** | workflows (39) + regressionDefects AUD-201 (4) |
| Invoicing & accounting mirror | **PASS** | workflows + money-and-tax + billing |
| Permissions / unauthorized | **PASS** | authorization-matrix (548) |
| Keyboard shortcuts | **PASS** | keyboardShortcuts (10) |
| Dynamic form rows / edit-save integrity | **PASS** | AUD-201/202 tests + uiContract (9) |
| Navigation | **PASS** | restrictedNav (8) + navPermissionContract (35) |
| API failure / rollback semantics | **PASS (simulated)** | no-half-write & race tests; real DB rollback **NOT RUN** (sandbox) |
| Concurrent requests | **PASS (simulated)** | conditional-decrement race test; real multi-connection **NOT RUN** |
| Browser E2E / responsive / contrast | **NOT RUN** | no browser in sandbox — unblocked by Playwright + staging |
| Real-database integration | **NOT RUN** | `prisma generate` blocked in sandbox — unblocked by MySQL staging |

## 6. Files changed this pass

| File | Why |
|---|---|
| `backend/src/controllers/jobwork.controller.js` | AUD-206: restore rejected customer material to lot ledger |
| `backend/src/controllers/salesReturn.controller.js` | AUD-202 shared line guard; AUD-203 null-item skip; AUD-204 discount-before-tax |
| `backend/src/controllers/purchaseReturn.controller.js` | AUD-202 shared line guard; AUD-203 null-item skip |
| `backend/src/controllers/stock.controller.js` | AUD-205: at-vendor outstanding net of rejects |
| `frontend/src/pages/jobcards/JobcardForm.jsx` | AUD-201: never send `operations` |
| `frontend/src/components/ui/SearchableSelect.jsx` | AUD-207: Escape consumed on window capture |
| `backend/tests/api/{regressionDefects,inventoryReconciliation,billingCalculation}.test.js` | new regression nets |
| `frontend/tests/unit/{jobcardFormPayload.test.js,keyboardShortcuts.test.jsx}` | new regression nets |
| `audit/*.md` | required audit reports (this document set) |
