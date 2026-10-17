# ERP_RELEASE_READINESS.md

**Date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech` (base `1be9215`, builds on audit pass 1 / PR #1)

---

## Verdict: **READY AFTER CRITICAL FIXES** — for the tested scope; one P1 operational gap remains

All seven defects confirmed in this pass — including a P1 data-loss bug (AUD-201:
editing a jobcard deleted its entire task history) — are **fixed and regression-tested**
(verified failing pre-fix). Core money, stock, jobwork and manufacturing flows are
correct at the controller/service level and guarded by 846 automated tests. Release to
a new customer still requires the operational items below (backup/restore being the
true blocker) and one replay of the scenario suites against a real MySQL staging DB.

---

## 1. Coverage numbers

| Metric | Count |
|---|---|
| Modules discovered | 17 (see `ERP_ARCHITECTURE_AUDIT.md` §2) |
| Frontend routes inspected | 77 `<Route>` declarations / 63 page files |
| API route handlers | 233 |
| Buttons / inputs / forms inventoried (pass 1 + this pass's control-class re-test) | 320 buttons, 374 inputs, 23 forms |
| Keyboard shortcuts discovered & tested | 13 handler groups — inventory in `KEYBOARD_SHORTCUT_AUDIT.md`, 10 behavioural tests |
| Forms validated (client + server paths) | 23 forms; 83 Zod-validated handlers incl. all stock/money writes |
| Business workflows tested end-to-end | 7 (purchase, sales, jobwork, manufacturing/production, returns, dispatch, customer material) |
| Automated tests | **backend 702 PASS / frontend 144 PASS** (0 fail, 0 skipped, 0 blocked) |
| Bugs fixed this pass | **7** (AUD-201 P1; AUD-202/203/204/206/207 P2; AUD-205 P3) |
| Bugs open | 1 P1-ops (AUD-127 backup/restore), 8 P2 (AUD-107/108/115/119/120/125/126/129/130), 7 P3 — listed in `BUSINESS_LOGIC_BUGS.md` |

## 2. Mandated verification checks

| Check | Result | Evidence |
|---|---|---|
| Inventory: inward / issue / production / returns vs stock ledger — independent match | ✅ **PASS** | 3-way reconciliation (currentStock = ledger Σ = hand formula = 119) |
| Manufacturing: multiple job cards from one inward — remaining qty/weight correct | ✅ **PASS** (after AUD-206 fix) | multi-challan scenario exact at every step; over-issue blocked. Weight: static attribute only — per-movement weight is a scoped feature gap, not a defect |
| Billing: qty, weight, rate, lot charge, tax, totals | ✅ **PASS** (after AUD-204 fix) | hand-reconciled mixed invoice; invoice↔return parity |
| Shortcuts & forms: every shortcut correct; no duplicate rows / double stock on edit | ✅ **PASS** (after AUD-201/207 fixes) | keyboard suite + line-id stability + no-double-movement sweep |
| Regression: one module's fix must not break another | ✅ **PASS** | 800-test baseline green after every change; final 846/846; auth matrix 548/548 |

## 3. Build & test results

```
backend   npx vitest run           →  10 files, 702 passed
frontend  npx vitest run           →   9 files, 144 passed
backend   npx eslint src           →  exit 0
frontend  npx eslint src           →  0 errors, 31 warnings (AUD-114, pre-existing)
frontend  npm run build            →  PASS
backend   src/server.js            →  boots, /health 200 (Prisma stubbed; see §4)
```

## 4. What could NOT be tested in this environment (repeated honestly)

| Area | Why | Unblocking step |
|---|---|---|
| Real-MySQL integration (FK cascades, isolation, migrations on live data) | `prisma generate` host unreachable; no mysqld/Docker | run both suites + scenario replays against seeded staging MySQL 8 |
| Browser E2E, responsive, colour contrast, touch targets | no browser/layout engine here | Playwright + axe on staging |
| Load / performance | no staging target; production out of bounds | agreed staging + written ceiling |
| Dependency vulnerability scan (`npm audit`) | advisory endpoint not allowlisted | CI on a GitHub runner |
| Backup/restore drill (AUD-127) | needs real data + infra | see §5 |

## 5. Must-fix / must-do before a new customer goes live

1. **AUD-127 (P1-ops):** write and *test* a backup + restore procedure (documented RTO/RPO). This system is the financial record of a manufacturing business.
2. **AUD-119 (P2):** add CI (GitHub Actions) running both suites + lint + build on push.
3. **AUD-120 (P2):** graceful `SIGTERM`/`SIGINT` shutdown in `server.js`.
4. **Staging replay:** run `inventoryReconciliation` + `regressionDefects` scenarios against seeded MySQL.
5. Password reset end-to-end (nodemailer wiring) or remove the affordance (pass-1 finding).

## 6. Bottom line

The defects found this pass were exactly the class an ERP cannot ship with — data
vanishing on edit (AUD-201), refunds exceeding charges (AUD-204), customer material
unaccounted (AUD-206), caps bypassable on edit (AUD-202). All are fixed with tests
proven to fail on the old code. What remains is operational scaffolding and the
one environmental gap (real-database replay), not known functional breakage in the
core inventory, jobwork, production or billing flows.
