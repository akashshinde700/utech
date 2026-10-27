# UTech ERP — Security Audit

**Date:** 2026-10-17 (A06 updated 2026-10-27) · **Reference:** OWASP Top 10 (2021), OWASP ASVS v4.0 level 1–2
**Method:** executed authorization matrix (233 endpoints) + source review. Where a
statement comes from reading code rather than running it, it is marked **static review**.

> **Headline: no exploitable vulnerability was confirmed in this pass.** The residual risks
> below are hardening items, not active compromise paths. Nothing was tested against
> production and no exploit payloads were run.

---

## 1. Executed results — the authorization matrix

`tests/security/authorization-matrix.test.js` (548 tests) is generated from the route
files themselves, so a route added without a gate fails on the next run.

| Control | Endpoints | Result |
|---|---|---|
| Requires a bearer token | 230 / 233 | ✅ 401 on every one |
| Permission-gated | 218 / 233 | ✅ 403 for a caller with zero permissions, on every one |
| SUPERADMIN bypass | all gated GETs | ✅ none returned 403 |
| Token signed with the wrong secret | — | ✅ 401 |
| Token for a deactivated user | — | ✅ 401 (`User inactive or missing`) |
| Public endpoints | 3 | ✅ only `login`, `otp/request`, `otp/verify` |

The test asserts the **exact** list of 12 auth-only endpoints, so a new one cannot appear
silently.

## 2. Authentication

| Control | Status | Evidence |
|---|---|---|
| Password hashing | bcrypt, `BCRYPT_ROUNDS` (default 10) | `auth.controller.js` |
| Account enumeration via timing | **mitigated** — a decoy bcrypt hash of a random secret is compared when the email is unknown, so a miss costs the same as a hit | `decoyHash()` + executed test asserting 401 with an identical message |
| Email normalisation | trim + lowercase before lookup, asserted on the Prisma call | executed test |
| Login validation | zod: email format, password ≥ 6 | executed |
| Change-password policy | ≥ 8 chars enforced server-side | executed test (400 on `short`) |
| Brute force | `express-rate-limit` 50 req / 15 min on `/api/auth`; `trust proxy` set so buckets are per real client | `server.js` |
| OTP generation | `crypto.randomInt(100000, 1000000)` — not `Math.random()` | `auth.controller.js` |
| OTP attempt limit | 5 wrong codes, then the code is burned; lookup is by email+purpose so a wrong guess still counts | `verifyOtp` |
| OTP single use | conditional `updateMany({ consumedAt: null })` — only the first concurrent claim succeeds | `verifyOtp` |
| OTP comparison | `crypto.timingSafeEqual` with a length pre-check | `timingSafeEqual()` |
| JWT | HS256, `expiresIn`, payload `{sub,email,role}`; identity re-read from the DB on every request, so a deactivated user loses access immediately | `requireAuth` |
| Session invalidation | no server-side session store — a valid token stays valid until expiry | see AUD-109 |

### Findings

**AUD-109 (P3) — JWT stored in `localStorage`; no refresh/revocation.**
`src/store/auth.js` persists the token under `utech.token`. Any XSS would exfiltrate it.
Mitigating factors: no `dangerouslySetInnerHTML`, `eval` or `innerHTML` anywhere in
`frontend/src` (grep-verified), and helmet's CSP is `script-src 'self'`. `REFRESH_EXPIRES_IN`
is read into `config/env.js` and never used — dead config that implies a capability the
product does not have. *Recommendation:* either implement refresh + a revocation list, or
delete the unused config so it stops misleading.

**AUD-111 (P3) — rate limiting is scoped to `/api/auth` only.** There is no global limiter,
so an authenticated client can hammer any data endpoint. For a single-company ERP behind
known users this is low risk, but the reports endpoints (unbounded queries, AUD-107) are
the obvious place to start.

## 3. Authorization

`requirePermission(...keys)` short-circuits for `SUPERADMIN` and otherwise checks the
caller's **effective** permissions: role grants, minus per-user revocations, plus per-user
grants (`effectivePermissions()` in `middleware/auth.js`). Verified by executed test.

### Privilege escalation (the highest-value area, and it holds)

The seed grants `user.update` to Department Head, Supervisor and Team Leader, so the
controller-level guards are what stand between a department head and the Super Admin
account. All four were executed:

| Attempt by a Department Head (`hierarchyLevel 4`, `user.update`) | Result |
|---|---|
| set another user's `roleId` | ✅ 403 `Only administrators can change: roleId`, no write issued |
| set another user's `password` | ✅ 403 |
| set another user's `isActive` | ✅ 403 |
| edit a user in another department | ✅ 403 `This user is not in your department` |
| edit a plain field in their own department | ✅ 200 — the guard does not over-block |

### Cross-tenant isolation

**Not applicable — this is a single-tenant deployment.** There is no `tenantId` on any of
the 60 models and no tenant scoping middleware. If this product is ever sold to more than
one company on one database, **tenant isolation does not exist today and would have to be
built** (row-level scoping on every query, plus a test matrix like the authorization one).
Recorded as a scope statement, not a defect.

### Department scoping

`scopeToDepartment` roles are restricted in the UI (`Protected`) and, for users and tasks,
in the controllers (`assertSameDepartment`, and `task.controller` scoping `task.read` to
assigned tasks for Operators). Jobcard access for Operators flows through
`utils/jobcardAccess.js` (assignment chain + operation assignees). These paths were read
but **not executed** — they need a real database to test meaningfully.

### IDOR / BOLA

The one class of IDOR that is testable without a database was tested and is closed:
`POST /api/notifications/:id/read` returns **404** when the notification belongs to another
user, and issues no write. Document-level ownership (invoice → party type, attachment →
refType module permission, jobcard → assignment chain) is enforced in the controllers and
was **reviewed statically**; a full IDOR sweep needs two controlled test accounts against
a live database.

## 4. OWASP Top 10 mapping

| # | Risk | Assessment |
|---|---|---|
| A01 | Broken access control | **Pass.** 233-endpoint matrix clean; privilege-escalation guards verified |
| A02 | Cryptographic failures | **Pass with note.** bcrypt for passwords, `crypto.randomInt` for OTPs, timing-safe compare, `Decimal(14,2)` for money. No sensitive field is stored in plaintext. Note: `JWT_SECRET` defaults to a placeholder in dev, but `config/env.js` **refuses to boot in production** if it is a placeholder or under 32 characters — verified by reading the fatal-config path |
| A03 | Injection | **Pass.** Every data access goes through Prisma parameterised queries. The only raw SQL is in `utils/numbering.js` and uses tagged templates (`tx.$queryRaw\`… ${key}\``), which are parameterised. Sort columns are whitelisted per route (`parseListQuery`), asserted with `sortBy=;DROP`. No `dangerouslySetInnerHTML`/`eval`/`innerHTML` in the frontend. Tally XML escapes every interpolated value |
| A04 | Insecure design | **Pass with note.** Money and stock are recomputed server-side and client-supplied totals are ignored (executed). Stock moves go through one service that writes a ledger row in the same transaction. Note: 28 write routes still take an unvalidated body (AUD-115) |
| A05 | Security misconfiguration | **Pass.** Helmet defaults confirmed by measuring real response headers — see §6. `NODE_ENV=production` disables debug output and switches morgan to `combined`. No debug endpoints. `/health` is trivial |
| A06 | Vulnerable components | **Pass (2026-10-27).** The registry scan was executed: backend 16 advisories (3 critical / 8 high / 5 moderate) and frontend 21 (2 critical / 10 high / 8 moderate / 1 low) were found and all resolved — 0 / 0 today, on prod and dev dependency trees. `xlsx` (no registry fix exists) and the unused `nodemailer` were removed; zod 4, vitest 5, vite 8, axios, react-router 7 and targeted overrides bring the rest onto patched lines. Full table: [`HARDENING_2026-10-27.md`](./HARDENING_2026-10-27.md) |
| A07 | Authentication failures | **Pass.** See §2 |
| A08 | Integrity failures | **Pass.** No `eval`, no deserialisation of untrusted input, no dynamic `require`. `xlsx` 0.18.5 has been **removed** — the abandoned npm build carried two unfixable high advisories, and the ERP only writes workbooks (now exceljs) |
| A09 | Logging & monitoring | **Partial.** `utils/audit.js` writes an `AuditLog` row for sensitive actions and never breaks the request. `morgan` logs HTTP. **Gaps:** no error-reporting service (Sentry or similar) is configured, so a 500 in production is only visible in stdout; audit coverage is uneven — the newer controllers call `audit()`, several older ones do not |
| A10 | SSRF | **Pass.** `POST /api/tally/sync` accepts a URL, and `assertAllowedTallyEndpoint` restricts it to http/https on a private-LAN host or the configured `TALLY_ENDPOINT` — reviewed and unit-reasonable. `GET /api/parties/lookup/ifsc/:code` validates the IFSC format and interpolates only into a fixed host |

## 5. Permission model hygiene — AUD-113 (P3)

16 permission keys are seeded but never enforced by any route:

```
assignment.delete  attachment.create  attachment.delete  attachment.read
attachment.update  bom.create         bom.delete         bom.update
customerMaterial.delete  dispatch.delete  report.create  report.delete
stock.create       stock.delete       stock.update       vendorWorkOrder.delete
```

They are grantable in the Roles UI, so an administrator can spend time configuring a
permission that does nothing. `bom.*` caused a real bug already (AUD-104). Either enforce
them or remove them from the seed.

## 6. Security headers — measured, not assumed

Real response from `GET /health` on the booted app:

```
content-security-policy: default-src 'self';base-uri 'self';font-src 'self' https: data:;
  form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';
  script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';
  upgrade-insecure-requests
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
referrer-policy: no-referrer
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
x-xss-protection: 0
access-control-allow-origin: http://localhost:5173
access-control-allow-credentials: true
```

- CSP is present and meaningful: `script-src 'self'` with no `unsafe-inline`, `object-src
  'none'`, `frame-ancestors 'self'` (clickjacking). `style-src 'unsafe-inline'` is required
  by Tailwind's runtime-injected styles and is the standard trade-off.
- `worker-src` is not set, so it inherits `default-src 'self'` — the pdf.js worker is a
  same-origin asset URL, so PDF preview is not broken by the CSP.
- CORS is an explicit origin, **not** `*`, with credentials — correct.
- **AUD-110 (P3):** there is no `robots.txt`, no `sitemap.xml` and no `X-Robots-Tag`. This
  is a private ERP; if its domain is publicly reachable, the login page, `/health` and the
  SPA shell are crawlable. Add `X-Robots-Tag: noindex, nofollow` and a deny-all
  `robots.txt`.

## 7. File uploads

| Control | Status |
|---|---|
| Extension **and** mimetype must both match an allowlist | ✅ `fileFilter` rejects a renamed `.exe` and a text file posing as an image |
| Size cap | ✅ `MAX_UPLOAD_MB` (default 10) via multer `limits`; `LIMIT_FILE_SIZE` is translated to a clean 400 by `errorHandler` |
| Stored filename | ✅ server-generated `uuid + ext`; the original name is never used as a path |
| Download content type | ✅ server-derived from the extension, never the client-supplied mime |
| Download disposition | ✅ `attachment` with a sanitised, length-capped filename |
| Per-record cap | ✅ 100, enforced before the rows are written, uploaded files unlinked on rejection |
| Path traversal | ✅ `path.join(baseDir, a.storedName)` where `storedName` is server-generated |
| **AUD-112 (P3)** | `/uploads` is served by `express.static` **without authentication**. Filenames are unguessable UUIDs, so this is defence-in-depth rather than an exposure — but a leaked URL is a permanent public link to the file. Serve through the authenticated `downloadOne` handler instead |

## 8. Secrets

- No API key, password, token or credential is committed. A repo-wide grep for
  `(api_key|secret|passwd|token) = "<12+ chars>"` outside `node_modules` returned nothing;
  the only env file is `backend/.env.example` with placeholder values.
- `.gitignore` covers `.env`, `.env.local`, `deploy_config.json` and `credential.md`.
- `config/env.js` **exits the process** in production if `JWT_SECRET` is missing, is one of
  the known placeholder strings, or is shorter than 32 characters — and prints the command
  to generate a good one.
- OTP codes are logged only when `NODE_ENV !== 'production'`, and `devCode` is only
  returned in the response in that same case.

---

# Pass 2 addendum — 2026-10-17 (`arena/5f43ac08-utech`)

Scope of this pass: the five mandated functional checks (inventory, manufacturing
flow, billing, shortcuts/forms, regression). Security surface was re-checked where
the fixes touched it. **No new vulnerability was found; none of the seven fixes
introduced one.**

| Area | Re-verified this pass | Result |
|---|---|---|
| Authorization on changed routes | `jobcards` PUT, `sales-returns` PUT/POST-process, `purchase-returns` PUT/POST-process, `jobwork` POST-receive, `stock` summary all still behind `requireAuth` + `requirePermission` (authorization-matrix suite 548 tests re-ran green after every change) | ✅ |
| Mass assignment | returns-update whitelists (`date/reason/notes` only) and the shared line guard (AUD-202) actually *narrow* the accepted body; jobcard update payload shrank (no `operations` key from the UI) | ✅ improved |
| Money integrity | AUD-204 makes return refunds obey the same GST rule as invoices — reduces an over-refund path (₹18 per ₹1,000-discount return) reachable via API | ✅ improved |
| Inventory integrity | AUD-206/203/202 close three inventory-consistency holes (phantom customer material, unprocessable returns, over-return via edit) — data-integrity, not confidentiality | ✅ improved |
| Keyboard/input handling | AUD-207 change moves one listener to `window` capture; no new global handler count, cleanup asserted by test | ✅ |
| Secrets / headers / uploads / XSS / CSRF / SSRF | untouched this pass; pass-1 findings (incl. open P3s AUD-109 JWT-in-localStorage, AUD-111 rate-limit scope, AUD-112 unauth `/uploads`) stand unchanged | ⚠️ same |

Re-run status after all fixes: `tests/security/authorization-matrix.test.js`
**548/548 PASS**, full backend 702/702, frontend 144/144.
