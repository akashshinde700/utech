# UTech ERP — Test Execution Report

**Date:** 2026-10-17 · **Framework:** Vitest 2 (backend) + Vitest 2 / jsdom / React
Testing Library (frontend) · **Node:** v22.22.3

---

## 1. Headline

| Suite | Files | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| `backend/tests` | 7 | **668** | **0** | 0 | 4.46 s |
| `frontend/tests` | 7 | **132** | **0** | 0 | 7.84 s |
| **Total** | **14** | **800** | **0** | **0** | 12.3 s |

Both suites run from a clean `npm install` with no database, no environment variables and
no network access. Nothing is skipped, nothing is `.todo`, nothing is `.skip`.

**The repository contained zero automated tests before this audit.** Every test here is
new.

### Commands

```bash
cd backend  && npx vitest run     # 668 passed
cd frontend && npx vitest run     # 132 passed
cd backend  && npx eslint src --ext .js
cd frontend && npx eslint src
cd frontend && npm run build
```

## 2. Test architecture

### Backend — how Prisma is faked

No MySQL and no Docker were available, and `prisma generate` cannot download its query
engine from the sandbox. Rather than write a hand-rolled copy of the app's logic, the suite
loads the **real** `src/app.js` and intercepts `require('@prisma/client')` via a
`Module._load` patch in `tests/helpers/prismaMockSetup.js`, returning a programmable fake
client (`tests/helpers/fakePrisma.js`).

The fake is stub-per-`[model].[method]`, and each stub receives the **actual Prisma args
array** the controller passed. `prisma.$transaction(cb)` gets a Proxy transaction client
sharing the same stubs and call log, so multi-write flows are observable.

This means the tests exercise the real routers, the real auth middleware, the real
validators and the real controllers. **What they cannot catch:** SQL generation, whether an
index exists, transaction isolation, and any bug that lives inside Prisma itself. Those are
marked **NEEDS LIVE DB** wherever relevant.

Two attempts that did **not** work, recorded so nobody repeats them: `vi.doMock` and
vitest `resolve.alias` for `@prisma/client` both fail, because the client is resolved
through a deep `require` chain that neither mechanism intercepts.

### Frontend — jsdom with axios mocked globally

`tests/setup.js` installs `@testing-library/jest-dom`, an `afterEach(cleanup)`, and
polyfills for `matchMedia`, `scrollIntoView` and `Element.prototype.offsetParent` (jsdom
has no layout engine, so `offsetParent` is always `null` — without the polyfill the Modal's
Tab trap silently drops every focusable element). A global `vi.mock('axios')` exposes
`globalThis.__apiMock`, and `tests/helpers/apiStubs.js` provides a hybrid array stub that
carries both array methods and `.items` / `.pagination` / `.count`, because
`DataTable` consumes both shapes.

## 3. Coverage by area

### Backend — 668 tests

| File | Tests | What it actually asserts |
|---|---|---|
| `security/authorization-matrix.test.js` | **548** | Generated from the route files. 230/233 endpoints return 401 with no token; all 218 permission-gated endpoints return 403 for a zero-permission caller; SUPERADMIN never gets 403 on a gated GET; a token signed with the wrong secret is rejected; a deactivated user's valid token is rejected; the exact set of 12 auth-only endpoints matches an allowlist |
| `api/workflows.test.js` | **39** | Invoice totals recomputed server-side (client totals ignored); paid/cancelled invoices reject edit and payment; overpayment blocked; invoice-with-payments refuses deletion; dispatch stock-out blocked at exactly the available quantity and allowed at exactly it; dispatch cancel restores stock; double-cancel blocked; delivered-cancel blocked; jobwork over-receipt blocked; sales-return over-return blocked; user privilege-escalation guards (roleId / password / isActive / cross-department); stock adjustment writes a ledger row; notification IDOR → 404 |
| `api/uiContract.test.js` | **9** | The two return-creation contracts (AUD-102 / AUD-013), including that a malformed body produces **zero** `create` calls |
| `unit/money-and-tax.test.js` | **24** | GST line/tax/total math; rounding over all 100 paisa values; `roundOff` bounded at ±0.5 |
| `unit/helpers.test.js` | **21** | `numberToWords`, date helpers, `parseListQuery` clamping and sort whitelisting |
| `api/validation.test.js` | **21** | Login shape, password change, sales/purchase return schemas, IFSC format, sort injection (`sortBy=;DROP`) |
| `smoke.test.js` | **6** | `/health`, 404 shape, error-handler envelope, helmet headers present |

### Frontend — 132 tests

| File | Tests | What it actually asserts |
|---|---|---|
| `unit/navPermissionContract.test.js` | **35** | Parses `AppLayout.jsx` nav and every route's `requirePermission`, and asserts each one resolves to a key that exists in the seeded permission set. This is the test that caught AUD-104 |
| `unit/numberToWords.parity.test.js` | **31** | Frontend and backend `numberToWords` are byte-identical across ~5,000 values, so a printed cheque amount can never disagree with the API |
| `components/uiKit.test.jsx` | **24** | Modal focus trap and Escape, `ConfirmDialog` callback contract, `DataTable` loading/empty/error/retry states, `Pagination` range text, `EmptyState`, `FormField`. Includes **axe-core with zero violations** on Modal, DataTable and FormField |
| `unit/libs.test.js` | **24** | `api.js` interceptors, formatters, `utils/*` |
| `routing/restrictedNav.test.jsx` | **8** | The restricted-route redirect set (AUD-101) |
| `components/operatorDashboard.test.jsx` | **5** | A failed fetch renders an error with a working retry, **not** "No projects assigned to you yet" (AUD-105) |
| `unit/authStore.test.js` | **5** | Token persistence and restore |

## 4. axe-core accessibility — executed, with honest exclusions

`components/uiKit.test.jsx` runs `axe.run` against rendered Modal, DataTable and FormField.
**Result: 0 violations.**

Two rules are explicitly disabled, and this matters:

- `color-contrast` — jsdom does not compute styles, so every contrast assertion would be a
  false result. Contrast is **not assessed** (AUD-122).
- `region` — jsdom renders a component fragment with no landmark structure.

So the axe result means *the component markup and ARIA wiring are correct*; it does **not**
mean the application is WCAG 2.2 AA conformant. See `UI_UX_AUDIT.md` for what remains.

## 5. Coverage map against the required areas

| Required area | Status | Evidence |
|---|---|---|
| Authentication & authorization | ✅ Executed | 548-test matrix + privilege-escalation guards |
| Critical business workflows | ✅ Executed | 39 workflow tests across invoice / dispatch / jobwork / returns / stock |
| Form validation (server side) | ✅ Executed | 21 validation tests + both new return schemas |
| Form validation (client side) | ⚠️ Partial | 5 tests on `OperatorDashboard`; the 23 forms were **not** individually exercised |
| CRUD operations | ⚠️ Partial | Read paths and the guarded writes are covered; generic create/update/delete across all 35 controllers are not |
| Navigation & protected routes | ✅ Executed | 8 routing tests + 35 permission-contract tests |
| API success **and** failure paths | ✅ Executed | Every workflow test asserts both the happy path and at least one rejection |
| Database consistency | ❌ **Not executed** | No live database available — see `DATABASE_AUDIT.md` |
| Multi-tenant isolation | ➖ Not applicable | Single-tenant product; no `tenantId` exists |
| Responsive layouts at 6 breakpoints | ❌ **Not executed** | No browser available (AUD-117) |
| Regression test per fixed bug | ✅ Executed | All 6 fixes have one — see `BUG_TRACKER.md` |

## 6. Could not be executed — with the reason and the unblocking step

| Area | Why it could not run | What unblocks it |
|---|---|---|
| **Real-database integration tests** | `prisma generate` needs `binaries.prisma.sh`, unreachable from the sandbox; no `mysqld`, no Docker, no `sqlite3`. The schema cannot be retargeted to SQLite (MySQL-only enums and `@db.*` attributes) | Run the suite inside a container with MySQL 8 + network egress, or provide a `.env` pointing at a staging DB |
| **Browser E2E (Playwright)** | Playwright browsers cannot be downloaded in the sandbox; even installed, they need the backend running, which needs the Prisma client | `npx playwright install --with-deps chromium` in CI, plus a seeded staging database |
| **Responsive layout checks (6 viewports)** | Same — needs a real layout engine | Playwright with `devices` presets |
| **Load testing (k6)** | Needs a staging target; running it against production is out of bounds without written permission | An agreed staging instance + a written ceiling |
| **`npm audit` / Semgrep / CodeQL / OWASP ZAP** | The npm advisory endpoint is not in the allowlist; the SAST binaries are not installed and cannot be fetched | Run these in CI on the GitHub runner, which has unrestricted network access |
| **Accessibility contrast & target size** | jsdom has no computed styles or layout | axe via Playwright against a rendered page |

No result in this report was inferred from unrun tests. Where a check did not execute, it
is listed above and marked as such in every other document.

## 7. How to keep this suite honest

Two rules were followed and should stay enforced:

1. **A test that documents a defect gets rewritten, not deleted, when the defect is fixed.**
   The AUD-013 case in `workflows.test.js` originally asserted the *broken* behaviour (a 201
   on an empty `lines` array) in order to prove the gap existed. After the schema fix it was
   rewritten to assert `400` + `ValidationError` + zero `create` calls. It would have been
   easier to delete it; that would have destroyed the only guard against the bug returning.
2. **Nothing is `.skip`ped and nothing is `.todo`.** A skipped test is a silent failure.

Run both suites in CI on every push (`AUD-119` — there is currently no CI pipeline at all).
