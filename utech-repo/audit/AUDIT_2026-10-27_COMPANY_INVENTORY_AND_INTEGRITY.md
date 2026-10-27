# Audit, fixes and release report — company inventory import + integrity pass

**Date:** 27 October 2026
**Branch:** `arena/cb4e7282-utech` (base `0c4a7fb`, `main`)
**Scope:** add the company's material stock sheets (`company_inventory/`) to Prisma, prove they belong
to this company, then re-audit and fix the manufacturing ERP with emphasis on the three agreed
guarantees — split job-card allocation, per-kg / per-piece / lot-charge billing consistency, and
transaction safety.

> **Hinglish सारांश (short):** `company_inventory` ki char sheets (Round Bar & Hex, Pipe, Plates,
> Flanges — total 73 material lines, qty 220) ab Prisma item master me hain, `RB-/PP-/PL-/FL-` codes ke
> saath, opening stock + OPENING ledger row ke saath. Har sheet ka printed `Total=` (6,89,200 /
> 10,15,700 / 23,85,000 / 1,89,900) transcribed rows se exactly match hota hai — `npm run
> inventory:verify` khud check karta hai aur mismatch par fail hota hai. Company identity bhi verify
> hoti hai: U-Tech Automation Industries, Chikhali/Pune, state code 27 — wahi identity jo invoice PDF
> aur GST split use karta hai. Isi pass me 6 naye defects fix hue (task history wipe, date-range
> end-day, reserved stock, export truncation, certificate duplicate/unknown reference, dispatch vs
> invoice). Backend 846 tests + frontend 166 tests pass, lint clean, build pass, audit 0
> vulnerabilities, live end-to-end scenario 48/48. **Production readiness: NOT READY** — kyunki real
> MySQL, migrations aur browser E2E is environment me available nahi the (neeche "Open issues" me
> exact reasons).

---

## 1. Environment and honest limitations

| Item | State |
|---|---|
| Repository | `utech-repo/` (Express 4 + Prisma 5 / MySQL 8 schema, React 18 + Vite 8) |
| Node | v22.22.3, npm 10.9.8 |
| Database | **MySQL server is not available in this sandbox** and `npx prisma generate` cannot download the query engine (`binaries.prisma.sh` is outside the allowed network). The app therefore ran on its schema-driven in-memory adapter (`src/config/inMemoryPrisma.js`, `USE_IN_MEMORY_DB=1`), which is explicitly blocked in `NODE_ENV=production`. |
| Consequence | Row locks (`FOR UPDATE`), InnoDB isolation levels, foreign keys, unique indexes, migration application and multi-process concurrency were **not** exercised. Anything below that depends on them is marked as unverified rather than passing. |
| Browser E2E | Not run (Playwright browsers are not downloadable here). UI verification is source-level + jsdom component tests + the live API contract the pages call. |
| Data safety | No production database, backup or business record was read or modified. All test data was created in the disposable in-memory instance. |

## 2. Architecture map and modules discovered

- **Backend:** `server.js` mounts 37 routers; every route is `requireAuth` + `requirePermission('<module>.<action>')`, then a Zod validator (`src/validators/*`), then a controller, then Prisma. Cross-cutting services: `stockService` (the only writer of company stock and of customer-lot movements), `numbering` (atomic `NumberSequence`), `audit`, `notify`, `xlsx`, `invoice.pdf`.
- **Frontend:** React Router app with ~40 pages (dashboard, operator dashboard, parties, items, invoices, quotations, jobcards, tasks/task-progress, jobwork, dispatch, purchase, GRN, quality, projects, expenses, production/shifts, BOM, machines, customer material, vendor work orders, stock, reports, analytics, users/roles/departments/assignments). Shared UI kit + form styles; role-based nav with a restricted-user allowlist.
- **Domain models actually present (from `schema.prisma`, 42 models/13 enums):** auth & RBAC, party (customer/vendor), item + UOM + category, machine, process, stock ledger (company **and** customer-owned), customer material lot + allocation, quotation/invoice/payment, jobcard + lines + operations (tasks) + notes + reverts, jobwork, dispatch, purchase order, GRN, vendor work order, quality check, expense, project/task, BOM, attachment, assignment, audit log, notification, sales/purchase return, back order, shift, production batch/material, number sequence.
- **Modules that do NOT exist** (so scenarios for them are marked N/A): double-entry general ledger (there is a party ledger only), GST e-invoice/e-way-bill integration, Tally *push* (XML export only), certificate **PDF printing** (only a `certificateNo` field), email/WhatsApp/SMS providers.

## 3. Company inventory import (the primary request)

### 3.1 What was added

`company_inventory/1.jpg … 4.jpg` are photographs of the company's stock register. They have no
machine-readable source, so the 73 lines were transcribed into one declarative module
(`backend/prisma/companyInventory.js`) and imported into Prisma:

| Sheet | File | Items | Codes | Qty | Printed `Total=` | Σ Rate (transcribed) | Σ Qty × Rate |
|---|---|---|---|---|---|---|---|
| Round Bar & Hex | 1.jpg | 18 | `RB-0001…RB-0018` | 32 | 6,89,200.00 | **6,89,200.00 ✔** | 13,45,100.00 |
| Pipe | 2.jpg | 20 | `PP-0001…PP-0020` | 51 | 10,15,700.00 | **10,15,700.00 ✔** | 32,71,200.00 |
| Plates | 3.jpg | 20 | `PL-0001…PL-0020` | 41 | 23,85,000.00 | **23,85,000.00 ✔** | 57,29,000.00 |
| Flanges | 4.jpg | 15 | `FL-0001…FL-0015` | 96 | 1,89,900.00 | **1,89,900.00 ✔** | 13,32,100.00 |
| **Total** | | **73** | | **220** | **42,79,800.00** | **42,79,800.00** | **1,16,77,400.00** |

Each item is `RAW_MATERIAL`, `PCS`, `purchaseRate` = the printed rate, `openingStock` =
`currentStock` = the printed qty, `minStock` 0, GST 18 %, a family HSN (bars 7228, pipe 7304, plate
7219, flange 7307), a new `ItemCategory` per sheet, and a description naming the sheet, line, printed
size, grade + metallurgical family, company and plant. Creating an item also writes exactly one
`OPENING` `StockLedger` row (`ownerType: COMPANY`), so `currentStock` equals the item's ledger sum
from day one.

Seeding is **additive and idempotent**: an existing code is skipped, never re-priced or re-stocked,
so re-running cannot overwrite balances already moved by GRN/dispatch/production. A dedicated
`npm run inventory:seed` imports *only* these items (no demo parties/invoices/admin) and refuses to
write in production without `INVENTORY_IMPORT_CONFIRM=1`.

### 3.2 "Ye isi company ki he?" — evidence, checked in code

`npm run inventory:verify` asserts 33 checks (all pass) before a single row can be seeded. The
same-company evidence:

1. **Provenance** — the four photos live inside this repository under `company_inventory/` as the
   company's own register; every generated item description carries the source file name.
2. **Company identity** — the import uses `U-Tech Automation Industries`, *Gat no. 1403, Sonawane
   Wasti Rd, Chikhali, Pimpri-Chinchwad, Pune 411062*, i.e. exactly what `services/invoice.pdf.js`
   prints on issued tax invoices and what `README.md` / `PROJECT_CURRENT_FLOW_ANALYSIS.md` name.
3. **Tax state** — `COMPANY_STATE_CODE=27` (Maharashtra), the same value that drives the invoice
   CGST/SGST vs IGST split.
4. **Grades** — only grades this plant works with: MS, SS 304, SS 310, SS 321, SS 410, SS 416,
   SS 446, Brass, RA330, Inconel, 20MnCr5, Corton-B. An unknown grade throws instead of importing.
5. **No invention** — the flange sheet has **no** grade column, so its 15 items are stored as *grade
   not stated* rather than silently assumed SS 304.

### 3.3 One open business question (documented, not guessed)

The printed `Total=` equals **Σ Rate**, not Σ (Qty × Rate): Round Bar line 1 alone is 3 × 10,500 =
31,500 and Σ Rate reproduces 6,89,200 exactly. We store `Rate` as a per-piece rate (the only reading
dimensionally consistent with a *Rate* column) → inventory value 1,16,77,400. The alternative reading
(Rate = line amount) gives 42,79,800. Both are reported by the verifier; neither is used for
accounting until the company confirms. Details: `docs/COMPANY_INVENTORY_IMPORT.md`.

## 4. Issues found and fixed in this pass

Severity = potential business impact before the fix. Every fix has an executed test.

### AUD-214 — High — Editing a job card destroyed Task Progress history

- **Reproduce (before):** a job card with a task that is assigned/in-progress → `PUT /api/jobcards/:id` with an `operations` array (any older UI or API client) → every `JobcardOperation` was deleted and re-created. Task ids changed, and assignees, approvals, comments (all `onDelete: Cascade`), start/end timestamps and progress were gone; a completed task came back `NOT_STARTED`. Confirmed live: an operation sent with `status: "IN_PROGRESS"` returned `NOT_STARTED`.
- **Root cause:** `jobcardOperation.deleteMany({ where: { jobcardId } })` + nested `create` — "replace all" with no preservation and no history check.
- **Fix:** new `applyOperationSet()` inside the same transaction. The array is still the complete list, but it is applied **by id**: existing tasks are updated in place (never losing id/status/progress), new rows are created, and dropping a task that has any history (status ≠ `NOT_STARTED`, progress > 0, assignee, approval, timestamps, comments) is **refused** with the task names. Tasks referenced as a rework parent/dependency are never deleted. `operations[].id` added to the validator; `id` is stripped on create so a client cannot pin primary keys. Task identity/lifecycle (`title`, `status`, `progressPercent`) remains owned by `/api/tasks`.
- **Files:** `backend/src/controllers/jobcard.controller.js`, `backend/src/validators/jobcard.schema.js`, `frontend/tests/unit/jobcardFormPayload.test.js`, `backend/tests/api/regressionDefects.test.js`.
- **Evidence:** `tests/api/integrity2026-10-27.test.js` (4 tests): in-place update keeps the id and sequence; dropping an in-progress task returns 400 and both rows survive; a foreign task id is rejected; a lines-only save still never touches tasks (AUD-201 stays fixed). Full suites re-run.

### AUD-215 — High — `?to=YYYY-MM-DD` silently dropped records created later that day

- **Reproduce (before, live):** create an invoice dated `2026-10-27T18:30:00Z`; `GET /api/invoices?to=2026-10-27` returned only the 00:00 invoice — the 18:30 one was missing. The same `new Date(to)` pattern existed in 9 list/report endpoints, so "sales up to today", expenses, stock ledger, production batches, returns and the XLSX exports all understated the end day.
- **Root cause:** a bare date parses to midnight, and `lte` midnight excludes the rest of that day. Only `stock.controller.ledger` had a private special case.
- **Fix:** one shared `dateRangeFilter(from,to)` in `utils/dates.js`: a bare `YYYY-MM-DD` upper bound becomes `< next UTC midnight` (whole day inclusive); a full ISO timestamp keeps `lte` verbatim (API clients that mean an instant are unaffected); invalid dates return 400 instead of an empty page or a 500. Applied to invoices, expenses (list **and** summary), sales returns, purchase returns, back orders, production batches, all three report exports, and the stock ledger (which now uses the shared helper).
- **Files:** `backend/src/utils/dates.js`, `backend/src/controllers/{invoice,expense,salesReturn,purchaseReturn,backOrder,production,report,stock}.controller.js`.
- **Evidence:** unit test on the helper (day vs instant vs invalid), plus API tests proving the 18:30 invoice is listed for `to=2026-10-27`, excluded for `to=2026-10-27T12:00:00Z`, that a malformed date is a 400, that the stock ledger and its XLSX agree, and that the expense summary equals the filtered list total.

### AUD-216 — Medium — Stock summary always reported `reservedStock: 0`

- **Reproduce (before, live):** reserve 40 pcs of a customer lot to a job card → `GET /api/stock/summary` still returned `reservedStock: 0` while `customerInventory.activeLots` was 1. The dashboard/stock page therefore contradicted the Customer Inventory page.
- **Root cause:** the endpoint was written before `CustomerMaterialAllocation` existed and kept a hardcoded placeholder plus a stale comment claiming no reservation flow exists.
- **Fix:** aggregate active (unreleased) allocations; expose `customerInventory.reservedQty/reservedWeight/reservations`, `reservedStock`, `reservedWeight`, `reservedOwnerType: 'CUSTOMER'`. Company stock has no reservation concept and is documented as such.
- **Files:** `backend/src/controllers/stock.controller.js`.
- **Evidence:** test reserves 25/15 → `reservedStock` 25 and `customerInventory.reservedQty` 25, then releases → both back to 0. Live scenario shows `reserved=40.333` after 40 + 0.333 reservations.

### AUD-217 — Medium — Excel exports were silently truncated; two reporting inconsistencies

- **Reproduce:** export more rows than the hardcoded `take()` cap (5,000 invoices / 2,000 ledger rows) → the workbook simply ended early, with no hint that it was incomplete, so totals reconciled against nothing.
- **Fix:** `sendXlsx` accepts headers and reports `X-Export-Rows`, `X-Export-Row-Limit`, `X-Export-Truncated`; each export fetches `limit + 1` to detect truncation and records `truncated` in the audit log. Also fixed in the same endpoint family: the **expenses** export wrote no audit row at all (every other export does), and the **party ledger** export ordered by date only, so two same-day entries could produce a different running balance per run (now `date, id`).
- **Files:** `backend/src/utils/xlsx.js`, `backend/src/controllers/report.controller.js`.
- **Evidence:** headers asserted on a normal export, and a test that mocks 5,001 invoice rows returns `X-Export-Truncated: true` with `X-Export-Rows: 5000`.

### AUD-218 — High — Quality certificates could point at nothing and share numbers

- **Reproduce (before):** `POST /api/quality {refType: "JOBCARD", refId: 999999}` was accepted (no such job card), and two PASS certificates could both be saved with certificate number `CERT-2026-001` (free text, no check). Both are exactly what a customer/ISO audit looks for.
- **Fix:** the referenced document must exist for its declared type (`GRN`, `JOBCARD`, `DISPATCH`, `TASK`) → 400 naming the missing id; certificate numbers are trimmed and must be unique case/whitespace-insensitively → 409 quoting the quality check that owns it; editing a check keeps its own number valid. App-level guard because existing installations may already contain duplicates that a DB unique index would refuse (a cleaning step + migration is listed as follow-up).
- **Files:** `backend/src/controllers/quality.controller.js`.
- **Evidence:** 2 API tests (unknown reference, duplicate on create and on update, self-edit allowed). Live check returns `No JOBCARD with id 999999 exists — record the quality check against a real document`.

### AUD-219 — High — A dispatch challan could contradict the invoice it references

- **Reproduce (before):** `POST /api/dispatch {invoiceId: <another customer's invoice>}` was accepted; so was shipping 100 pcs against a 2-pc invoice (only stock sufficed). Invoice, dispatch and stock ledger then told three different stories.
- **Fix:** when `invoiceId` is supplied, the invoice must exist, not be cancelled, belong to the same party, and each dispatched item must be billed — with cumulative (already-dispatched, non-cancelled) quantities capped by the invoiced quantity. Cancelling a challan returns the quantity to the invoice's remaining balance.
- **Files:** `backend/src/controllers/dispatch.controller.js`.
- **Evidence:** test covers foreign invoice (400), over-shipment (400), item not on invoice (400), two partial dispatches, then 400 on the third, then cancel + redispatch; live API returns `Invoice INV-26-00001 belongs to Scenario Buyer Pvt Ltd, not to this challan's party`.

### CI-01 — Data — Company material inventory imported (section 3)

Files: `backend/prisma/companyInventory.js`, `backend/prisma/verifyCompanyInventory.js`,
`backend/prisma/seedCompanyInventory.js`, `backend/prisma/seed.js`, `backend/package.json`
(`inventory:verify`, `inventory:seed`), `docs/COMPANY_INVENTORY_IMPORT.md`, `README.md`,
`backend/tests/unit/companyInventory.test.js` (11 tests).

### CI-02 — Tooling — Dead sidebar links were only caught by clicking

- **Problem:** `AppLayout` and `App.jsx` are edited independently, and nothing failed when a menu
  entry pointed at a route that does not exist — the router silently falls through to `NotFound`.
- **Fix:** new source-level contract test `frontend/tests/unit/navRoutesResolve.test.js` (6 cases):
  every sidebar target must match a declared `<Route>` (catch-all excluded), the multi-line index
  route must be found, route paths must be unique, `*` must be last, and no page import may be
  unused. Mutation-checked: `/invoices` → `/invoicez` fails with
  `expected [ '/invoicez' ] to deeply equal []`. The first version of the test missed that because
  `*` matched every path; the final version excludes it.
- **Scope:** test-only, no runtime change.

## 5. The three agreed guarantees — verification

| Guarantee | What was exercised | Result |
|---|---|---|
| **Inventory integrity:** one inward item split across job cards must never show a wrong remaining qty/weight | 100 pcs / 250 kg customer lot → allocate 60/150 to JC-1 → remaining **40/100** → allocate 40/100 to JC-2 → remaining **0/0** → over-allocation of 1 qty rejected → release JC-1's 60/150 → remaining exactly **60/150** → allocate **0.333/0.777** → remaining **59.667/149.223** (3-decimal exact) | ✔ Pass (live API + 11 existing allocation tests + new reservation-summary test) |
| **Billing accuracy:** per-kg, per-piece and lot-charge totals identical in the saved invoice, the printed invoice and reports | Invoice with 12.345 kg × ₹1,050.50 (per-kg), 7 pcs × ₹333.33 (per-piece), 1 lot × ₹5,000 (lot charge), ₹100.05 discount | saved subtotal 20,301.73 = Σ saved line amounts; stored total 23,838.00 = subtotal − discount + CGST 1,818.15 + SGST 1,818.15 + round-off 0.02; PDF text contains the same three lines, subtotal, discount, taxable, CGST/SGST, round-off and 23,838.00; XLSX report row matches Subtotal/Discount/Total/Paid/Balance; over-payment refused; partial payment sets PARTIALLY_PAID. ✔ Pass |
| **Transaction safety:** a failed job card/invoice save must not leave stock or balances half-updated | 14 rollback tests re-run green, including 3 added in this pass: **(1)** invoice save fails on the receivable write → no invoice, no line, no ledger row, and `Item.currentStock` + `StockLedger` count unchanged; **(2)** dispatch cancellation fails on the ledger insert *after* `moveCompanyStock` already incremented the item → stock returns to its pre-cancel 6 (not 10), challan stays `DRAFT`, zero `DISPATCH_CANCEL` ledger rows; **(3)** job-card save fails while creating a second operation → the first operation's rename and the line set are both rolled back | ✔ Pass in the in-memory adapter; **MySQL/InnoDB rollback not verified** (no server) |

Note on terminology: the ERP has no structured "charge type" (per-kg/per-piece/lot). Every line is
`qty × rate`, and the three cases above are descriptions with the appropriate unit and quantity. That
is consistent end-to-end (verified), but it means the system cannot enforce, say, ₹/kg against a
weighed quantity automatically. Recorded as an open item, not silently "implemented".

## 6. Commands executed and actual results

```
backend   npm ci                                     → 468 packages
backend   npm test (vitest run)                      → 24 files, 846 tests passed
frontend  npm ci                                     → 460 packages
frontend  npm test (vitest run)                      → 14 files, 166 tests passed
backend   npm run lint (eslint src)                  → exit 0, 0 problems
frontend  npm run lint                               → exit 0, 0 problems
frontend  npm run build (vite build)                 → success (1.80 s); chunk-size warning only
backend   npm audit / npm audit --omit=dev           → 0 vulnerabilities
frontend  npm audit                                  → 0 vulnerabilities
backend   npm run inventory:verify                   → 33/33 checks, sheets reconcile, exit 0
backend   npm run inventory:seed (dev)               → 73 created, 73 opening ledger rows
backend   NODE_ENV=production inventory:seed         → refused without INVENTORY_IMPORT_CONFIRM=1
backend   npx prisma generate                        → FAILED (no network to binaries.prisma.sh) — in-memory adapter used
live      scenario harness (48 assertions)           → 48/48 passed
```

Representative output of the live harness (`/tmp/scenario-final.txt`):

```
PASS  company inventory item RB-0001 exists in Prisma — stock=3 rate=10500
PASS  GRN increased company stock by 5 — stock=8        PASS  dispatch moved stock out (8 → 6)
PASS  remaining after 1st allocation = 40 qty / 100 wt  PASS  remaining after 2nd allocation = 0
PASS  3-decimal allocation is exact (60 - 0.333 = 59.667) — 59.667/149.223
PASS  stock summary reports the live reservation (40 + 0.333) — reserved=40.333
PASS  completion added finished goods — 10 → 12          PASS  completion consumed material exactly once — 6 → 5
PASS  stored total reconciles with subtotal - discount + tax + round-off — 23838 vs 23838
PASS  report Total matches the saved invoice total — 23838     PASS  report Balance equals total - paid — 13838
PASS  items with ledger history: current stock equals the last posted balance — 40 items, 0 mismatches
PASS  negative invoice qty rejected / qty beyond 3 decimals rejected / vendor invoice rejected
PASS  unauthenticated invoice list refused / tampered token refused
```

## 7. Manufacturing workflow verification

| Scenario | Result |
|---|---|
| Customer + vendor → master items → PO → approve → GRN → stock | ✔ PO-26-00001 → GRN-26-00001 raised RB-0001 from 3 → 8 with a matching ledger balance |
| Inward with multiple items → allocate only eligible remaining items to several job cards → verify remaining after each | ✔ (section 5) — over-allocation refused, release restores exact qty/weight |
| Job card through each process stage → output / rejected / rework → WIP and finished stock | ◐ Task stages verified (`/api/tasks` transitions, assignees, approvals); production batch verified (plan → start → complete moves output in, consumption out exactly once, second completion refused). **Job card `qtyProduced` is not driven by production batches and job-card completion does not require tasks/production to be finished** — see open items. |
| Job card complete → certificate → invoice → printed documents | ◐ Job-card completion (blocked by open drawing assignments) and certificate numbering/reference integrity verified (AUD-218); **no certificate PDF exists**; invoice PDF + totals verified; invoice does not move stock (dispatch does) — by design |
| Payment → invoice balance, party balances, reports | ✔ 10,000 of 23,838 → PARTIALLY_PAID, party ledger debit/credit rows, XLSX balance 13,838 |
| Edit/cancel transactions → ledger, balances, references remain consistent | ✔ GRN cancel (with shortfall refusal), dispatch cancel restores stock, invoice cancel refused once paid, production second completion refused, delivery cannot move backwards |
| Duplicate submissions, invalid quantities, unauthorized access, simultaneous allocation | ✔ validation 400s, conditional claims/409s, token/auth 401s, concurrent allocation protected by lot locks (in-memory only) |
| Dashboard/report reconciliation against transactions | ✔ invoice/stock-ledger/party-ledger exports match; dashboard KPIs read the same tables; **reports UI exposes no date filter controls** (API supports `from`/`to`) |

Scenarios that **cannot** be tested here: anything requiring MySQL row locks/InnoDB isolation,
migration application, real concurrent HTTP writers against MySQL, browser-level printing/A4 layout,
and Tally/ERP push integrations (not implemented).

## 8. Security status

- Authentication: JWT required on every route except `/health` and `/api/auth/*`; tampered/garbage token → 401 (verified live).
- Authorization: 559-case permission matrix passes; object-level checks (job card scope, allocation detail hiding, department scope in tasks/work orders) re-verified.
- Injection: all Prisma calls parameterized; the two raw-SQL helpers are tagged-template (parameterized) row locks.
- Validation: Zod on all write routes, with precision limits matching `DECIMAL(14,3)/(14,2)`; the new date helper rejects malformed dates (previously an `Invalid Date` could reach Prisma).
- Uploads: no public static mount; attachments/images served only through permission-checked APIs (pre-existing, re-tested).
- Secrets: only `.env.example` is tracked; no credential pattern found in `src/`; production boot refuses placeholder `JWT_SECRET` and the in-memory adapter.
- Dependencies: `npm audit` — 0 vulnerabilities (backend prod+dev, frontend).
- Data exposure in errors: HttpError messages are business-safe; the generic 500 body remains `Something went wrong.`
- New surface added in this pass: export headers expose only row counts (no data); certificate/date validation errors echo ids the caller already sent.

## 9. Database integrity and migrations

- **No schema change** was required by this pass (company inventory uses the existing `Item`, `Uom`, `ItemCategory`, `StockLedger` models; task protection uses existing columns; the job-card validator change is not a column). Therefore **no new migration** was added and no existing one was modified.
- Follow-ups that would need migrations (not applied here, no MySQL to test them): a case-insensitive unique index on `QualityCheck.certificateNo` (after cleaning existing duplicates), and optional indexes to support the new dispatch→invoice cumulative query.
- Company inventory write path preserves the ledger invariant: one `OPENING` row per new item, `currentStock = qty`, asserted in tests and by the live reconciliation check (40 items, 0 mismatches).

## 10. UI / navigation / print

A static walkthrough was run over the whole SPA (no browsers are installable here, so this is source-level
plus jsdom, not click-through):

| Check | Result |
|---|---|
| `<Route>` declarations in `App.jsx` | 75 (incl. one catch-all), no duplicate paths, catch-all last |
| Sidebar targets in `AppLayout.jsx` (`NAV_SECTIONS` + restricted nav) | 41 — **all 41 resolve to a declared route** |
| Hard-coded in-page links (`<Link to="/…">`, `navigate('/…')`) | 0 pointing at an undeclared route |
| `<button>` elements | 339 — 0 with `href="#"`, 0 with an empty `onClick`, 0 placeholder `TODO`/`FIXME` handlers |
| Restricted-user visibility vs openability | `OPERATOR`/`Department Head` may open every link they can see (`restrictedNav`) |
| Nav permission key vs the key the API actually requires | matches for every link (`navPermissionContract`) |

The first two rows are now enforced by a new test, `frontend/tests/unit/navRoutesResolve.test.js`
(6 cases: count sanity, the multi-line index route, dead-link scan, catch-all last+unique, no
duplicate routes, no unused page import). It was mutation-checked: changing one sidebar target to
`/invoicez` makes it fail with `expected [ '/invoicez' ] to deeply equal []`; reverting restores green.
The first version of this test passed the mutation because the `*` catch-all matched everything — the
test now excludes the catch-all so a typo'd link cannot hide behind it.

- The job-card form still never sends `operations`, so a save cannot touch tasks (contract test now pins the new backend path too).
- Verified print artefact: invoice PDF text extraction matches the saved invoice line-for-line (including a per-kg quantity of 12.345 and a lot-charge line). No visual/A4 approval was performed (no browser), and there is no certificate print layout to review.
- The reports page offers no date-range inputs even though the API supports them (open item RPT-02).

## 11. Performance observations (measured, not benchmarked)

- `GET /api/items?pageSize=100` → ~62 KB / ~2 ms in-process; lists are paginated (max 100) and index-backed.
- `GET /api/stock/summary` now adds one aggregate over active allocations (indexed on `lotId`, `releasedAt`); it still does two full scans of the (small) item master for count + valuation.
- Exports are capped at 5,000 rows and stream one workbook; no load test was run, and no claim about production capacity is made.
- Frontend build emits one >500 KB chart chunk (warning only); `charts` is the largest lazy chunk.

## 12. Open issues (not fixed) and why

| ID | Sev | Issue | Why open |
|---|---|---|---|
| DEP-01 | Blocker for release | MySQL never exercised: no server, no `prisma generate`, migrations not applied | Environment; must run `prisma migrate deploy`, the suites against a disposable MySQL, and multi-process concurrency tests before go-live |
| MFG-04 | High | Production batches do not update `Jobcard.qtyProduced/qtyRejected`; job-card completion does not require tasks or production output | Needs a business decision (is a batch the only source of produced qty? is a job card completable with zero output?). Guessing would change existing workflows |
| MFG-05 | Medium | Rejected quantity is recorded but no scrap/rework stock movement is posted | Business rule unknown (scrap may be re-melted, returned, or written off) |
| QC-02 | Medium | No certificate PDF/print; quality check is not a completion gate on the job card | Feature gap, preserves existing print formats as instructed |
| QC-03 | Low | `certificateNo` uniqueness is app-level only (no DB index) | Existing data may contain duplicates; needs a cleaning script + migration on a real DB |
| BILL-03 | Medium | No structured per-kg / per-piece / lot-charge rate types (all lines are qty × rate) | Design change with pricing/rounding implications; consistency was verified, semantics were not invented |
| RPT-02 | Low | Reports UI has no `from`/`to` controls although the API supports them | UI work, not a correctness defect |
| INV-02 | Medium | Company inventory `Rate` reading ambiguous (Σ Rate vs Σ Qty × Rate) | Requires one-line confirmation from the company |
| JC-02 | Low | `PUT /api/jobcards/:id` still accepts `qtyOrdered/qtyProduced/qtyRejected` (planning fields) with no production linkage | Tied to MFG-04 |
| E2E-01 | Blocker for release | No browser E2E or visual print verification in this environment | Playwright browsers unavailable here |

## 13. Release readiness

**NOT READY for production.**

What *is* solid: the repository builds, lints and passes **846 backend + 166 frontend** automated
tests; the company's material register is imported with a reproducible, failing-loud verification of
every printed total and the company's identity; the three agreed guarantees were exercised end-to-end
against a live API (48/48 assertions) including split allocation, per-kg/per-piece/lot billing
consistency across saved/printed/exported figures, and rollback behaviour; six real defects
(AUD-214 … AUD-219) were fixed with regression tests, and two of them (task-history wipe, dispatch vs
invoice) were confirmed as reproducible before the fix.

What keeps it out of production: **no MySQL-backed verification of migrations, foreign keys, row
locks, isolation or concurrent writers; no browser/visual print verification; and three functional
gaps that need a business decision (production ↔ job-card quantity linkage, scrap/write-off posting,
certificate document/print).** Recommended next step is a staging deployment on real MySQL with
`prisma migrate deploy`, the two suites pointed at it, and a signed-off answer to the three open
business questions.
