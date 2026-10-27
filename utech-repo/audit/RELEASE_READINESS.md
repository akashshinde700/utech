# UTech ERP — Release Readiness Assessment

**Date:** 2026-10-17 · **Branch:** `arena/f79889ce-utech` (base `55e9ab4`)

---

## Verdict: **READY AFTER FIXES**

The product is functionally substantial and, after the six fixes in this pass, its core
money and stock workflows are correct and guarded by tests. It is **not** ready to be
handed to a new customer today, for three reasons that are operational rather than
functional: there is no CI running the test suite, no documented backup/restore procedure,
and password reset does not work end to end.

| Gate | Status |
|---|---|
| Core workflows correct | ✅ 668 backend + 132 frontend tests pass |
| No known P0 defect | ✅ none found |
| P1 defects open | ⚠️ **1** — AUD-127, no backup/restore procedure |
| Security vulnerabilities confirmed | ✅ **none** |
| Security hardening open | ⚠️ 5 findings (all P3) |
| CI/CD | ❌ **absent** |
| Dependency vulnerability scan | ✅ **run 2026-10-27** — 0 advisories in both apps (was 16 backend / 21 frontend); see `HARDENING_2026-10-27.md` |
| Browser E2E / responsive / accessibility contrast | ✅ **Playwright available since 2026-10-17** — 13 specs pass, incl. the two new inventory safeguards |
| Real-database testing | ❌ **not run** — Prisma client cannot be generated in the sandbox |

---

## 1. What was verified

**800 tests, 0 failures**, all newly written (the repository had none):

```
backend   npx vitest run   →  7 files, 668 passed, 4.46 s
frontend  npx vitest run   →  7 files, 132 passed, 7.84 s
backend   npx eslint src --ext .js   →  exit 0
frontend  npx eslint src             →  0 errors, 31 warnings
frontend  npm run build              →  PASS
```

- **230 of 233 endpoints reject an unauthenticated request.** The 3 that do not are the
  login/OTP pair — correct by design.
- **218 of 218 permission-gated endpoints return 403** to a caller holding zero
  permissions. SUPERADMIN never gets 403 on a gated GET.
- **Privilege escalation is blocked** on all four attempted paths (roleId, password,
  isActive, cross-department), while a legitimate in-department edit still succeeds.
- **Money is always recomputed server-side**; client-supplied totals are discarded.
- **Stock cannot go negative**, and cancelling a dispatch returns the stock.
- **Over-return, over-receipt and overpayment are all rejected** with a 400.
- **Security headers are correct** — measured from a booted server, not read from config.
- **No secrets in the repository.** No `dangerouslySetInnerHTML`, `eval` or `innerHTML`.
- **axe-core reports zero violations** on Modal, DataTable and FormField.

## 2. What blocks release

### Must fix before a new customer goes live

| ID | Sev | Item | Why it blocks |
|---|---|---|---|
| **AUD-127** | **P1** | **No documented backup or restore procedure.** There is no script, no schedule, no documented RTO/RPO anywhere in the repository. | This system *is* the financial record of a manufacturing business. Shipping it without a tested restore path is an unacceptable operational risk regardless of code quality |
| **AUD-119** | P2 | **No CI pipeline.** `.github/` does not exist. | 800 tests that nobody runs automatically will rot within a quarter. A single GitHub Actions workflow is a one-file change |
| **AUD-120** | P2 | **No `SIGTERM`/`SIGINT` handler** in `server.js`. | Container restarts and deploys drop in-flight requests mid-transaction. With multi-write flows like dispatch and returns, that is a real path to inconsistent data |
| **Password reset** | P2 | `nodemailer` is installed but OTP delivery only `console.log`s (`TODO: integrate nodemailer`). Separately, `verifyOtp` only issues a token for `purpose: 'login'`, so a `reset` OTP cannot complete a reset even if delivered. | A user who forgets their password cannot recover it without an admin editing the database. Either ship it or remove the UI affordance |

### Should fix before scaling past a handful of users

| ID | Sev | Item |
|---|---|---|
| AUD-107 | P2 | 8 XLSX exports run unbounded `findMany` with full `include`; `invoices()` dereferences `r.party.name` unguarded |
| AUD-108 | P2 | No code splitting — 1.63 MB JS / 446 kB gzip in a single bundle |
| AUD-115 | P2 | 54 write routes (28 POST/PUT/PATCH + 26 DELETE) take an unvalidated body |
| AUD-125 | P2 | N+1 `aggregate` inside the return-create loops |
| AUD-129 | P2 | `Item.currentStock` is a denormalised cache with no reconciliation against `StockLedger` |
| AUD-126 | P2 | No down-migrations |
| AUD-130 | P2 | Timezone-naive dates formatted server-local — printed dates can shift one day *(NEEDS LIVE DB to confirm)* |

### Hardening (P3, no deadline but all cheap)

AUD-109 (JWT in `localStorage`, dead `REFRESH_EXPIRES_IN`), AUD-110 (no
`robots.txt`/`X-Robots-Tag`), AUD-111 (rate limiting on `/api/auth` only), AUD-112
(`/uploads` served unauthenticated), AUD-113 (16 seeded permissions enforced nowhere),
AUD-114 (31 lint warnings), AUD-116 (`.finally` with no `.catch` in
`ActivityTimeline.jsx:36`), AUD-121 (buttons missing `type="button"`), AUD-124 (7 child
tables missing FK indexes), AUD-128 (stale `refType` comment), AUD-014 (no numeric guard in
`calcLineAmount`).

## 3. Build and deploy status

| Step | Result |
|---|---|
| `npm install` (backend) | ✅ exit 0 |
| `npm install` (frontend) | ✅ exit 0 |
| `npm run build` (frontend) | ✅ PASS — 2,440 modules, 8.9 s |
| Backend boots | ✅ `src/server.js` served `GET /health` → 200 |
| Lint | ✅ backend exit 0; frontend 0 errors / 31 warnings |
| `prisma generate` | ❌ **blocked** — `binaries.prisma.sh` unreachable from the sandbox |
| `prisma migrate deploy` | ❌ **not run** — requires the generated client and a target database |
| `npm run seed` | ❌ **not run** — same |
| Container / deployment scripts | ❌ **none exist** in the repository |

**The app is runnable** in an environment with network egress and a MySQL instance. That
was confirmed by booting `src/server.js` and serving a request — but it was booted with the
Prisma client stubbed, so a real end-to-end startup with a live database was **not**
verified here.

## 4. What could not be tested, and what would unblock it

| Untested area | Reason | Unblocking step |
|---|---|---|
| Real-database integration | `prisma generate` needs `binaries.prisma.sh`; no `mysqld`, no Docker, no `sqlite3`; schema cannot move to SQLite (MySQL-only enums, `@db.*`) | Run the suite in a container with MySQL 8 + egress, or point `.env` at staging |
| Browser E2E (Playwright) | Browsers cannot be downloaded here; the backend needs the Prisma client | `npx playwright install --with-deps chromium` in CI + a seeded staging DB |
| Responsive at 6 viewports | Needs a real layout engine | Playwright `devices` presets |
| Colour contrast / target size | jsdom has no computed styles; axe `color-contrast` was disabled rather than faked | axe via Playwright on a rendered page |
| Load / performance | No staging target; production is out of bounds without written permission | Agreed staging instance + a written ceiling |
| Semgrep / CodeQL / OWASP ZAP | SAST binaries unavailable in this sandbox | Run in CI on a GitHub runner (`npm audit` has since been executed — 0 findings) |

**No result anywhere in this audit was inferred from a test that did not run.** Every
untested area is listed above and repeated in the document that would otherwise have
covered it.

## 5. Recommended sequence

**Week 1 — unblock release**
1. Write and test a backup + restore procedure; document RTO/RPO (AUD-127).
2. Add a GitHub Actions workflow running both suites + lint + build on every push (AUD-119).
3. Add graceful shutdown to `server.js` (AUD-120).
4. Either finish password reset or remove the entry point (nodemailer + `purpose: 'reset'`).

**Week 2 — reliability**
5. Bound the report exports and stream them (AUD-107).
6. Add `validate()` to the 54 unvalidated write routes (AUD-115) — the two return schemas
   written this pass are the template.
7. Add a nightly `StockLedger` → `currentStock` reconciliation job (AUD-129).
8. Route-level code splitting (AUD-108).

**Week 3 — hardening**
9. The P3 list, in the order given in §2.

## 6. Bottom line

The engineering underneath this product is better than most ERP codebases of its size:
money is server-authoritative, stock moves through a single ledger-writing service inside
transactions, the permission model is coherent, and the security posture (headers, hashing,
OTP handling, upload filtering, SSRF guard on the one outbound URL) is deliberate rather
than accidental.

What is missing is the **operational scaffolding around it** — CI, backups, graceful
shutdown, dependency scanning — and a **verified** claim about the parts this sandbox could
not reach: real database behaviour, browser rendering, and load. Those four items, not
feature work, are what stand between this and a confident release.
