# UTech ERP — Bug Tracker

**Date:** 2026-10-17 · **Branch:** `arena/f79889ce-utech`

> **2026-10-27 pass (`arena/2b90aa02-utech`):** AUD-210 (GRN cancel could go negative),
> AUD-211 (no physical-receipt proof for sales returns), AUD-212 (zod v4 update payloads)
> and AUD-213 (dependency advisories, now 0/0) are FIXED — see
> [`HARDENING_2026-10-27.md`](./HARDENING_2026-10-27.md).

**Severity key:** P0 = data loss / security breach / production down · P1 = core workflow
broken for users · P2 = degraded or risky, workaround exists · P3 = hygiene / hardening

**Status key:** `FIXED` = code changed **and** a regression test added that failed before
the change · `OPEN` = diagnosed, not changed · `NOT REPRODUCIBLE` = investigated, no defect

---

## Fixed this pass — 6 defects, each with a regression test

### AUD-102 — P1 — FIXED

**Creating a sales return returned HTTP 500 every single time.**

- **Affected:** `frontend/src/pages/salesReturns/SalesReturnForm.jsx` →
  `POST /api/sales-returns`
- **Repro:** Sales Returns → New → select an invoice → add a line → Submit.
- **Expected:** 201 Created, return recorded, stock restored.
- **Actual:** 500 `Internal server error`. Nothing was saved.
- **Evidence:** the form posted `items: [...]` (with `itemId`, `qty`, `rate`, `amount`).
  `salesReturn.controller.js:68` destructures `const { lines, ... } = req.body`, so `lines`
  was `undefined`, and `salesReturn.controller.js:81` (`for (const l of lines)`) threw
  `TypeError: lines is not iterable` → 500. Reproduced by `api/uiContract.test.js`, which
  asserts the raw request body the axios mock receives and the resulting status.
- **Root cause:** field-name drift between the form and the controller during a refactor.
  The sibling `PurchaseReturnForm.jsx` was already correct (`grnLineId`, `description`,
  `gstRate`, `reason`), which is why only the sales side broke.
- **Fix:** the form now posts the full `lines` array in the shape the controller reads.
- **Regression test:** `backend/tests/api/uiContract.test.js` — fails on the old payload,
  passes on the new one.
- **Verification:** 201, `salesReturn.create` called once with 2 lines and
  `totalRefund` computed server-side.

### AUD-013 — P1 — FIXED

**Both return endpoints accepted a malformed body and produced NaN amounts.**

- **Affected:** `POST /api/sales-returns`, `POST /api/purchase-returns`
- **Repro:** `POST /api/sales-returns` with `{"invoiceId":1,"lines":[]}` → **201 Created**
  with `totalRefund: 0` and no lines. With `{"lines":[{"invoiceLineId":"x","qty":-5}]}` →
  **500**, because `calcLineAmount(undefined, -5)` is `NaN`.
- **Expected:** 400 with a readable validation error, and no row written.
- **Actual:** 201 or 500.
- **Evidence:** `api/uiContract.test.js` asserted 201-on-empty-lines and NaN-before-fix.
- **Root cause:** neither route was wired to `validate()`. 79 of 233 routes had validation;
  these two write routes did not.
- **Fix:** created `backend/src/validators/salesReturn.schema.js` and
  `purchaseReturn.schema.js` (integer ids, `z.number().positive()` qty, non-negative rate,
  `gstRate` 0–100 default 18, `lines` min 1, `z.coerce.date()`), and wired `validate()` into
  both route files.
- **Regression test:** the AUD-013 case in `workflows.test.js` was **rewritten** — it used
  to assert the broken behaviour to prove the gap; it now asserts `400` + `ValidationError`
  + **zero** `salesReturn.create` calls.
- **Verification:** both endpoints return 400 with `details[]`; no write issued.

### AUD-101 — P1 — FIXED

**Three routes were reachable only by SUPERADMIN.**

- **Affected:** `frontend/src/App.jsx`, `RESTRICTED_ALLOWED_PATHS`
- **Repro:** sign in as an Operator → `/my-tasks`, `/tasks`, `/processes` → redirected
  away.
- **Expected:** an Operator can reach their own tasks.
- **Actual:** the allowlist contained 3 of the 6 restricted paths, so a non-superadmin
  hitting the other 3 was bounced.
- **Root cause:** the allowlist was written for the initial restricted-route set and never
  extended when `/my-tasks`, `/tasks` and `/processes` were added.
- **Fix:** 3 → 6 paths.
- **Regression test:** `frontend/tests/routing/restrictedNav.test.jsx` (8 tests) — failed
  before the patch, passes after.
- **Verification:** all 6 restricted paths render for a non-superadmin.

### AUD-104 — P2 — FIXED

**The BOMs menu item was invisible to everyone except SUPERADMIN.**

- **Affected:** `frontend/src/components/layout/AppLayout.jsx` L77-79
- **Repro:** sign in as MANAGER (holds all `bom.*` permissions) → the "BOMs" nav item is
  absent, though `GET /api/boms` returns 200 for that user.
- **Expected:** visible to anyone with `bom.read`.
- **Actual:** the nav declared `perm: 'bom.read'`, but the route is gated on `item.read`.
  A MANAGER has `bom.read` (seeded) — so the real problem was the mismatch: the nav and the
  route disagreed, and the nav key was not the one the backend enforces.
- **Root cause:** 16 permission keys are seeded but enforced nowhere (AUD-113), so a nav
  item could reference a key that gates nothing and silently diverge from the route.
- **Fix:** nav `perm` → `'item.read'`, matching `/api/boms`.
- **Regression test:** `frontend/tests/unit/navPermissionContract.test.js` (35 tests) —
  parses the nav JSX and every route's `requirePermission` and asserts both resolve to a
  seeded key. Caught this on its first run.
- **Verification:** BOMs visible to MANAGER and SUPERADMIN; hidden from OPERATOR.

### AUD-105 — P2 — FIXED

**A failed load showed "No projects assigned to you yet" — a false empty state.**

- **Affected:** `frontend/src/pages/operator/OperatorDashboard.jsx`
- **Repro:** sign in as an Operator with the API returning 500 on
  `GET /api/tasks/dashboard`.
- **Expected:** an error with a retry.
- **Actual:** the loading flag cleared in `.finally`, the array stayed `[]`, and the page
  told the user they had no work. An Operator would go home.
- **Root cause:** `.finally` with no `.catch` and no `error` state — the same pattern still
  present at `ActivityTimeline.jsx:36` (AUD-116).
- **Fix:** added `error` state plus a `reloadKey` retry; the empty state now renders only
  when the fetch actually succeeded.
- **Regression test:** `frontend/tests/components/operatorDashboard.test.jsx` (5 tests).
- **Verification:** failure renders the error and the retry button re-issues the request;
  genuine empty still renders the empty state.

### AUD-106 — P2 — FIXED

**Backend linting was a no-op that reported success.**

- **Affected:** `backend/eslint.config.js`
- **Repro:** append `return undefinedVariable.foo` to `src/utils/gst.js`, then run
  `npx eslint src`. **Exit code 0, no output.**
- **Evidence:** that experiment was run and then reverted from `/tmp/gst.bak`. The config
  declared no rule sets, so ESLint parsed the files and checked nothing.
- **Impact:** every "lint passes" claim in the repository history was meaningless.
- **Fix:** rewrote the config with `js.configs.recommended`, Node 18 globals, and
  `no-unused-vars` / `no-redeclare` options. That surfaced 4 real errors: two unused
  `config` parameters in `tally.controller.js` (renamed to `_config`, L102/L115) and two
  controllers that export a handler named `process`, shadowing the Node global (handled
  with `'no-redeclare': ['error', { builtinGlobals: false }]`).
- **Verification:** `npx eslint src --ext .js` → exit 0. Re-injecting the defect now
  reports `no-undef`.

---

## Open — 18 findings

| ID | Sev | Finding | Affected |
|---|---|---|---|
| **AUD-127** | **P1** (ops) | **No documented backup or restore procedure** for a system that is the financial record of a manufacturing business | repository-wide |
| **AUD-126** | P2 | No down-migrations; a bad deploy means restoring a backup | `prisma/migrations/` |
| **AUD-119** | P2 | **No CI pipeline at all** — `.github/` does not exist, so nothing runs these 800 tests on push | repo root |
| **AUD-120** | P2 | No `SIGTERM`/`SIGINT` handler in `server.js`; container restarts drop in-flight requests mid-transaction | `backend/src/server.js` |
| **AUD-107** | P2 | 8 XLSX export endpoints run unbounded `findMany` with full `include`; `invoices()` dereferences `r.party.name` unguarded | `report.controller.js` |
| **AUD-108** | P2 | No route-level code splitting — 1.63 MB JS / 446 kB gzip in one bundle | `frontend/src/App.jsx`, `vite.config.js` |
| **AUD-115** | P2 | 54 write routes (28 POST/PUT/PATCH + 26 DELETE) have no `validate()` | 26 route files |
| **AUD-125** | P2 | N+1 aggregation inside the create loop — one `aggregate` per returned line | `salesReturn.controller.js`, `purchaseReturn.controller.js` |
| **AUD-124** | P3 | 7 high-traffic child tables have no index on their foreign key | `prisma/schema.prisma` |
| **AUD-129** | P2 | `Item.currentStock` is a denormalised cache with no reconciliation job against `StockLedger`; drift would be invisible | `services/stockService.js` |
| **AUD-130** | P2 | Dates stored as timezone-naive `DateTime` but formatted server-local — a document's printed date can shift one day around midnight *(NEEDS LIVE DB to confirm)* | `prisma/schema.prisma`, `report.controller.js` |
| **AUD-109** | P3 | JWT in `localStorage`; `REFRESH_EXPIRES_IN` is read into config and never used | `frontend/src/store/auth.js`, `config/env.js` |
| **AUD-111** | P3 | Rate limiting is scoped to `/api/auth` only; no global limiter | `backend/src/server.js` |
| **AUD-112** | P3 | `/uploads` is served by `express.static` unauthenticated (UUID filenames are the only protection) | `attachment.routes.js` |
| **AUD-113** | P3 | 16 permission keys are seeded and grantable in the UI but enforced nowhere | `prisma/seed.js` |
| **AUD-114** | P3 | 31 `react-hooks/exhaustive-deps` warnings; each is a `useEffect` calling an unstable `load` fn | 20+ frontend files |
| **AUD-116** | P3 | `ActivityTimeline.jsx:36` still uses `.finally` with no `.catch` — same class of bug as AUD-105 | `components/ActivityTimeline.jsx` |
| **AUD-110** | P3 | No `robots.txt`, no `X-Robots-Tag`; a publicly reachable domain exposes the login page and `/health` to crawlers | `public/`, helmet config |
| **AUD-121** | P3 | Buttons missing `type="button"` inside forms can submit unintentionally | multiple forms |
| **AUD-122** | P3 | Colour contrast **not assessed** — jsdom has no computed styles, so axe `color-contrast` was disabled | repository-wide |
| **AUD-123** | P3 | Touch-target sizes partly unmeasured (needs a real layout engine) | repository-wide |
| **AUD-128** | P3 | `StockLedger.refType` comment lists 13 valid values but omits `DISPATCH_CANCEL`, which the code writes | `prisma/schema.prisma:435` |
| **AUD-014** | P3 | `calcLineAmount` has no numeric guard; unreachable now that both return routes validate, but a third caller would reintroduce NaN | `utils/gst.js` |

### Feature gaps found in source (not bugs, but they will be reported as them)

| Item | Detail |
|---|---|
| **Password reset does not work** | `nodemailer` is installed but OTP delivery only `console.log`s (`TODO: integrate nodemailer`). No email is ever sent, so a user who forgets their password cannot recover it. The OTP `purpose: 'reset'` is accepted by the schema, but `verifyOtp` only issues a token for `purpose: 'login'` — so even a manually-read code would not complete a reset |
| No UI for `/api/tally/*` | Backend routes exist, no page calls them |
| No UI for `/api/quotation-templates/*` | Same |
| No BOM stepwise workflow | BOMs are stored and read; there is no stage-wise production flow |
| No project-budget workflow | Projects exist with no budget tracking |
| No batch/shift-wise production reports | `Shift` and batch fields exist in the schema; no report consumes them |
| Dead code | `allItems` / `removeItem` in `SalesReturnForm.jsx` (ESLint-flagged) |
| Read-only views missing | `/sales-returns/:id` and `/back-orders/:id` render the editable Form, so "viewing" a record means entering edit mode |
| Unverified response shape | `AssignmentsPage.jsx:75` assumes one of envelope-or-array; not confirmed against a live response |
| `utils/audit.js` | Swallows its own failures and truncates notes at 4,096 characters — correct behaviour, but it means a failed audit write is invisible |

---

## Not reproducible / already fixed before this pass

Three findings from `docs/BACKEND_AUDIT.md` and `docs/FRONTEND_AUDIT.md` (both describing
commit `a2f2e14`) were re-verified against current `master`:

- **C1, C5, C6** — already fixed. Not re-opened.
- **"No ErrorBoundary"** — **false.** `ErrorBoundary` exists and is mounted in
  `frontend/src/main.jsx`. Confirmed by reading the file.

## Previously-fixed defects that now have a regression net

Two bugs fixed before this audit had no test guarding them. Both are now covered, so they
cannot silently return:

| Bug | Guard |
|---|---|
| Cancelling a dispatch left stock permanently lost (phantom inventory loss) | `workflows.test.js` asserts `DISPATCH_CANCEL` ledger rows and restored `currentStock` |
| Overpayment on an invoice was accepted | `workflows.test.js` asserts 400 when `amountPaid + amount > total` |
