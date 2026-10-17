# UTech Automation Industries ERP — Audit Summary

| | |
|---|---|
| **Audit date** | 2026-10-17 |
| **Repository** | `akashshinde700/utech` @ `55e9ab4` |
| **Audit branch** | `arena/f79889ce-utech` |
| **Scope** | Full monorepo — `backend/` (Express 4 + Prisma 5 + MySQL), `frontend/` (React 18 + Vite 5 + Tailwind 3) |
| **Verdict** | **READY AFTER FIXES** — see `RELEASE_READINESS.md` |

---

## 1. What this product is

A single-tenant manufacturing ERP for U-Tech Automation Industries: sales (quotations,
invoices, dispatch, returns), purchasing (POs, GRNs, purchase returns, back orders,
vendor work orders), shop-floor execution (jobcards, task progress, assignments,
production batches, quality inspection), inventory (item master, BOMs, company stock vs.
customer-owned material, jobwork challans) and admin (users, roles, permissions,
departments).

| Dimension | Count |
|---|---|
| Backend source (LOC) | 10,469 |
| Frontend source (LOC) | 21,707 |
| API routers mounted | 35 |
| **API route handlers** | **233** |
| Backend controllers | 35 |
| Zod validator modules | 24 (26 after this audit) |
| Prisma models / enums | 60 / 20 |
| Prisma relations / `@unique` / `@@index` | 154 / 37 / 88 |
| Migrations | 36 |
| Frontend `.jsx` files | 88 (63 page files, 23 shared components) |
| **Frontend `<Route>` declarations** | **77** |
| Interactive controls in source | 320 `<button>`, 374 `<input>/<textarea>/<select>`, 37 router links, 23 `<form>`, 56 modal usages |

## 2. Overall health

The codebase is **materially healthier than a first pass suggests**. It carries two prior
audit reports (`docs/BACKEND_AUDIT.md`, `docs/FRONTEND_AUDIT.md`, dated 2026-09-05) and
the findings in them have largely been remediated — spot-checks confirmed the dispatch
cancel/stock-restore fix, the atomic `NumberSequence` allocation, the conditional
`updateMany` stock decrement, the attachment `fileFilter`, the SSRF guard on Tally sync
and the user-admin privilege guards are all present in the current tree.

What the automated suite found in this pass is a different failure class: **the two sides
of the product disagreeing with each other**, in ways no unit test and no lint rule could
catch, and which a "does the homepage load" check would never surface.

## 3. Confirmed defects found and fixed

| ID | Sev | Defect | Evidence |
|---|---|---|---|
| **AUD-101** | P1 | Restricted users (Operator, Project Engineer, Department Head, Supervisor, Team Leader) were shown sidebar links to `/my-tasks`, `/tasks` and `/processes` that the route guard silently bounced back to the dashboard. For an Operator, "My Tasks" is their main screen. | `tests/routing/restrictedNav.test.jsx` — failed before, passes after |
| **AUD-102** | P1 | **Creating a Sales Return from the UI always failed.** `SalesReturnForm` posted `items:[…]`; the controller destructured `lines`. Result: `TypeError: lines is not iterable` → HTTP 500 on every save. | `tests/api/uiContract.test.js` — returned 500 before the fix |
| **AUD-013** | P1 | `/api/sales-returns` and `/api/purchase-returns` had **no server-side validation at all** — both route files imported `validate` and never called it, and no schema file existed. A non-numeric `qty` produced `201` with `NaN` in the money columns; an empty `lines` array created a zero-line return. | `tests/api/uiContract.test.js` — 201 + NaN before, 400 after |
| **AUD-104** | P2 | The BOMs sidebar link was gated on `bom.read` while `/api/boms` checks `item.read`. A role holding `item.read` but not `bom.read` (e.g. the seeded MANAGER) never saw the link despite being allowed to use the page. | `tests/unit/navPermissionContract.test.js` |
| **AUD-105** | P2 | `OperatorDashboard` had no error state. A failed `/jobcards` request fell through to "No projects assigned to you yet" — the operator's landing page told them they had no work when the truth was the request failed. | `tests/components/operatorDashboard.test.jsx` |
| **AUD-106** | P2 | `backend/eslint.config.js` declared no rule set, so `npm run lint` was a no-op that always exited 0. Proven by injecting a reference to an undefined variable: lint still exited 0. | `eslint src` before/after, with an injected defect |

## 4. Findings still open

Sixteen further findings are recorded in `BUG_TRACKER.md`, the highest being:

- **AUD-115 (P2)** — 46 of 87 write routes still take an unvalidated body. Mass assignment
  is currently prevented by per-controller field whitelists, which hold today but are
  invisible to the tooling and easy to regress.
- **AUD-107 (P2)** — every XLSX export loads the whole table into memory with no row cap.
- **AUD-108 (P2)** — the frontend ships a single 1.63 MB JS bundle (446 kB gzipped) with no
  route-level code splitting, plus a 1.38 MB pdf.js worker.
- **AUD-120 (P2)** — `server.js` has no `SIGTERM`/`SIGINT` handler, so a container restart
  kills in-flight requests mid-transaction.

## 5. Security posture

**No exploitable vulnerability was confirmed in this pass.** The 233-endpoint authorization
matrix is clean:

- 230/233 endpoints require a bearer token; the 3 exceptions are `POST /api/auth/login`,
  `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`.
- 218/233 are additionally permission-gated, and **all 218 return 403** for an authenticated
  caller holding no permissions.
- SUPERADMIN bypass works on all gated GET endpoints.
- The 12 auth-only endpoints are enumerated and each is intentional (own profile, own
  notifications, per-refType attachment checks, GSTIN/IFSC lookups).

Positive controls verified by measurement: bcrypt with a decoy hash so login timing does
not enumerate accounts; `crypto.randomInt` OTPs with attempt counting and conditional
consume; timing-safe OTP compare; helmet defaults including a working CSP; explicit
CORS origin (no wildcard); `trust proxy` set for correct rate-limit bucketing; XML escaping
on the Tally export; private-LAN allowlist on Tally sync; server-derived content type and
sanitised filename on attachment download; no `dangerouslySetInnerHTML`/`eval`/`innerHTML`
anywhere in the frontend; no secrets committed (only `.env.example`).

Residual risks are recorded in `SECURITY_AUDIT.md` — the notable ones being the JWT in
`localStorage` (AUD-109), unauthenticated static `/uploads` (AUD-112) and rate limiting
scoped to `/api/auth` only (AUD-111).

## 6. What could not be tested here

This is the honest part, and it bounds the verdict.

| Not executed | Why | Consequence |
|---|---|---|
| **Any test against a real database** | `prisma generate` downloads the query engine from `binaries.prisma.sh`, which is not reachable from the audit sandbox; without it `require('@prisma/client')` throws and the backend cannot boot. No MySQL/MariaDB server or Docker is available either. | Foreign keys, unique indexes, cascade behaviour, real transaction rollback, isolation and SQL correctness are **unverified**. |
| **Browser E2E tests** | Playwright/Puppeteer browser binaries cannot be downloaded. | No real click-through of any workflow, no real responsive/overflow measurement. |
| **Load / performance testing** | Requires a running server with a database and an agreed staging target. | No latency, throughput or concurrency numbers are claimed anywhere in this audit. |
| **Dependency vulnerability scan** | `npm audit` needs the registry advisory endpoint; `semgrep`/`codeql`/OWASP ZAP are not installed and cannot be fetched. | No third-party CVE findings are reported. |

Everything else in these reports is backed by a command that was actually run, and the
distinction between "executed" and "static review" is maintained throughout.

## 7. Test totals

| Suite | Files | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| Backend (`backend/tests`) | 7 | **668** | 668 | 0 | 0 |
| Frontend (`frontend/tests`) | 7 | **132** | 132 | 0 | 0 |
| **Total** | **14** | **800** | **800** | **0** | **0** |

Commands:

```bash
cd backend  && npm install && npm test          # 668 tests
cd backend  && npm run lint                     # 0 errors (rules now actually enabled)
cd frontend && npm install && npm test          # 132 tests
cd frontend && npm run lint                     # 0 errors, 31 warnings
cd frontend && npm run build                    # builds clean
```

## 8. Documents in this folder

| File | Contents |
|---|---|
| `AUDIT_SUMMARY.md` | this document |
| `FEATURE_INVENTORY.md` | modules, routes, endpoints, implementation status |
| `UI_UX_AUDIT.md` | navigation, forms, controls, responsiveness, accessibility |
| `SECURITY_AUDIT.md` | authentication, authorization, OWASP Top 10 mapping |
| `API_TEST_REPORT.md` | per-endpoint scenarios and results |
| `DATABASE_AUDIT.md` | schema, integrity, migrations — and what is unverified |
| `PERFORMANCE_REPORT.md` | measured bundle numbers; explicitly no load-test claims |
| `TEST_EXECUTION_REPORT.md` | every command run, with output |
| `BUG_TRACKER.md` | all findings with status and evidence |
| `RELEASE_READINESS.md` | outstanding risks and the go/no-go call |
