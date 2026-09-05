# UTech ERP — Improvement & Audit Remediation Report

| | |
|---|---|
| **Repository** | UTech ERP (React 18 + Vite 5 frontend · Express 4 + Prisma 5 + MySQL/MariaDB backend) |
| **Audited commit** | `a2f2e14` ("update") |
| **Fix commit** | `d050c61` — *fix: security, stock integrity, UX hardening — full audit remediation* (107 files, +4,149 / −450) |
| **Audit & fix date** | 2026-09-05 |
| **Full findings** | `utech-audit-docs/BACKEND_AUDIT.md` (47 findings), `utech-audit-docs/FRONTEND_AUDIT.md` (34 findings) — every item with file:line references |
| **Deliverables** | `utech-improvements.patch` (git format-patch), `utech-improvements.bundle` (full-history git bundle), this report |

---

## 1. What was audited

A full-stack audit of the UTech manufacturing ERP at commit `a2f2e14`:

- **Backend** — 37 route files, 38 controllers, services/utils/seed on Express 4 + Prisma 5 (MySQL/MariaDB), 57 Prisma models, 17 enums. Focus areas: authentication/authorization, mass-assignment, stock & ledger integrity, document numbering, invoice/payment/return money flows, Tally XML export, attachments, OTP, seeds/migrations.
- **Frontend** — ~40 pages (Vite + React 18): routing, crash-safety, permission gating, form double-submits, data-table states, date handling, money-in-words, analytics error handling.
- Every finding was written up with file:line references in `docs/BACKEND_AUDIT.md` and `docs/FRONTEND_AUDIT.md`, then **each item was fixed and re-verified** (code review + live smoke tests).

---

## 2. Top issues found & fixed

| # | Severity | Area | Issue found | Fix shipped |
|---|---|---|---|---|
| 1 | Critical | Security | **Mass-assignment** — 9 controllers spread raw `req.body`, letting clients overwrite `id`, `number`, `status`, `createdAt`, `createdById` | Explicit editable-field whitelists in all 9 controllers (salesReturn, purchaseReturn, backOrder, production, quality, expense, machine, process, project) + new zod schemas for fulfill/complete-batch |
| 2 | Critical | Security | **Privilege escalation** — user update allowed granting yourself a higher role / changing passwords | Hierarchy-based guards: role/password/isActive gated to SUPERADMIN or level ≤ 1; cannot assign a role at/above own level; department scoping |
| 3 | Critical | Stock | **Cancelled dispatches destroyed stock permanently** — stock left at DRAFT, never returned on CANCELLED (phantom inventory loss) | Transactional per-line reversal with `DISPATCH_CANCEL` StockLedger rows; DELIVERED and double-cancel blocked |
| 4 | Critical | Stock | **TOCTOU race** in stock decrement — concurrent dispatches could oversell into negative stock | Atomic conditional `updateMany` decrement (count = 0 → 400 "insufficient stock") |
| 5 | Critical | Money | **Overpayment possible** — payment totals read only payment rows; invoices carrying denormalized `amountPaid` could be paid again up to full total | Baseline = aggregate `_sum` **floored by `amountPaid`**; overpay → 400. Plus: no cancel with payments, no edits once PAID, no payments on CANCELLED |
| 6 | Critical | Reliability | **Duplicate document numbers** (DC/INV…) under concurrency | New `NumberSequence` table (migration `20260905100000`) with `SELECT … FOR UPDATE`, in-process mutex, insert-retry |
| 7 | High | Security | **SSRF in Tally sync** — server fetched arbitrary URLs; XML injection via unescaped values | Private-LAN/localhost/env-endpoint allowlist (public IPs → 400); `xmlEscape` everywhere; real status codes surfaced |
| 8 | High | Security | **Attachments open to all** — any user could read/delete any file; upload type unchecked; multer 1.x vulnerable | Per-ref permission gates, extension+mimetype allowlist (pdf/images/office/txt/csv), sanitized Content-Disposition, **multer 2.0.2** |
| 9 | High | Security | **OTP weak & logged** — predictable codes, throttling gaps, dev code printed in prod, case-sensitivity | `crypto.randomInt`, throttle, old OTPs invalidated via `updateMany`, no prod logging, case-insensitive email login |
| 10 | High | Money | **Returns uncapped** — could return more qty than was sold/received | Cumulative per-line caps vs invoice lines (sales) and GRN lines (purchase), with line-belongs-to-anchor validation |
| 11 | High | Money | **GRN against wrong/unapproved POs** — arbitrary PO status, foreign lines, party mismatch | Requires APPROVED/PARTIALLY_RECEIVED/RECEIVED PO; `poLineId` must belong to PO; GRN party must match PO party |
| 12 | Medium | Stock | **Jobwork receive over-receipt** — could receive more than sent, or lines from another challan | Status guards, per-line cap (received+rejected ≤ sent), challan-membership check, rejected qty returned to company stock |
| 13 | High | Reliability | **Re-seed reset the admin password** — every seed run locked users out / reset credentials | Password hash only in upsert *create* clause; re-seed is now fully idempotent |
| 14 | Critical | UX | **White-screen crashes** from unguarded optional joins (InvoiceView, PurchaseOrderView, JobcardView, etc.) | Null-safe defaults + empty-array guards on all 9 pages + a global **ErrorBoundary** with reload |
| 15 | High | UX | **numberToWords wrong** on negatives, paise rounding, zero ("100 Paise"/undefined on legal invoice words) | Correct "Minus …", whole-paise rounding, "Zero Rupees and Fifty Paise Only" |
| 16 | High | UX | **Double-submit duplicates** — invoice/payment/dispatch forms could fire twice and create duplicate money records | `saving` flag + disabled + "Saving…" on 15 forms and modals |
| 17 | Medium | UX | **Permission layer decorative** — nav/buttons visible regardless of rights; fails open | Fail-closed `hasPermission` (SUPERADMIN bypass), wired into sidebar and destructive actions (delete/approve/stock-adjust) |
| 18 | Medium | UX | **Date prefills off by one day** (`toISOString()` shifts under IST) | IST-safe `todayLocal()`/`toLocalInput()` across 15 forms |

*(This is the top ~18 of 81 total findings; full detail with file:line refs is in the two audit docs.)*

---

## 3. New capabilities

- **Vendor Work Orders module is now reachable end-to-end** — routes for list/new/edit plus a new detail page (`VendorWorkOrderView`) wiring the previously dead *Send to Vendor* and *Record Return* modals and the vendor trail; sidebar entry gated on `vendorWorkOrder.read`.
- **Permission-aware UI** — the sidebar and destructive actions now respect the logged-in role's permissions and *fail closed*; restricted roles see only what they can do.
- **Loading / error / empty states everywhere** — DataTable got skeleton rows, error banners with Retry, and a "No matches found" filtered state; wired into 21 list pages. Analytics pages show error cards with Retry instead of spinning forever.
- **Race-free document numbering** — a new `NumberSequence` table guarantees unique DC/INV/… numbers even under concurrent users.
- **Cleaner ops** — seed is idempotent (never resets your admin password), `jobcard.progress` and `stock.adjust` permissions are seeded, dashboard KPIs exclude cancelled invoices.

---

## 4. Verification summary

All checks were run **live against the running system** (backend on :4000, served through the preview proxy on port 3000):

- ✅ `prisma migrate deploy` — **28 migrations** applied cleanly (incl. the new NumberSequence migration); `prisma generate` OK
- ✅ Seed re-run — exit 0, **admin login still works afterwards** (idempotent)
- ✅ `eslint` — **0 errors** on backend **and** frontend (frontend: 0 new warnings vs baseline)
- ✅ Login smoke — `admin@utech.local` 200 + token, case-insensitive email login 200, `/api/auth/me` returns role + permissions
- ✅ **Stock round-trip** — dispatch create moved stock 180 → 175; CANCELLED reversed 175 → 180; `DISPATCH_CANCEL` ledger row verified in DB; re-cancel → 400
- ✅ **Payment guards** — amount 0 / −5 → 400; overpay → 400 ("already paid 15000 of 30190"); valid payment → 200, status PARTIALLY_PAID
- ✅ **Tally** — masters & vouchers exports → 200 XML; SSRF probe to a public IP → 400
- ✅ Authz — `/api/users` without token → 401
- ✅ NumberSequence row, audit-log rows verified in DB after the flows above

---

## 5. How to run

**Backend (port 4000)**
```bash
cd backend
cp .env.example .env          # then set DATABASE_URL and a strong JWT_SECRET
npm install
npx prisma migrate deploy     # 28 migrations
node prisma/seed.js           # idempotent; safe to re-run
npm run dev                   # nodemon on http://localhost:4000  (prod: npm start)
```

**Frontend (single-origin — served by Express)**
```bash
cd frontend
npm install
npm run build                 # vite build → dist/
cp -r dist/* ../backend/public/   # Express serves this at http://localhost:4000/
```
Open **http://localhost:4000** — one origin serves the app, the API (`/api/*`) and uploads; no CORS setup needed. (For frontend development you can instead run `npm run dev` in `frontend/` — Vite on :5173 already proxies `/api` and `/uploads` to :4000.)

**First login:** `admin@utech.local` / `Admin@123` — **change this password immediately** after first login (Users page).

---

## 6. Known deferred items

Honest list — known and documented, intentionally not in this phase:

1. `/uploads` static route is still unauthenticated (per-file API endpoints are gated; the raw static path is not).
2. **PartyLedger** is not yet posted by invoices/payments/expenses (ledger table exists; posting is Phase 2).
3. `xlsx` dependency not yet bumped (Excel export path) — recommend migrating to `exceljs`.
4. GST calculation applies **discount after tax**; compliance generally expects discount before tax.
5. `item`/`party` update endpoints still accept raw bodies (they were outside the 9-controller whitelist scope).
6. Lookup select dropdowns are not searchable.
7. Modal accessibility (focus traps, ESC handling) is basic.
8. OTP delivery is a **stub** — codes are generated/verified correctly but no actual email is sent yet.

---

## 7. Recommended next steps (Phase 2)

1. **PartyLedger posting** from invoices, payments and expenses (aging/partner statements depend on it).
2. **GST discount-before-tax** recalculation for compliance.
3. Migrate Excel export from `xlsx` to **`exceljs`** (actively maintained, streaming support).
4. **E2E tests for money flows** — invoice → payment → cancel, dispatch → cancel reversal, returns caps (Playwright or supertest).
5. **Rate limiting per email** on OTP request/login (current limiter is per-IP only).
6. **Deployment checklist for production**: strong `JWT_SECRET`, HTTPS termination, real SMTP credentials for OTP, and review the Tally endpoint allowlist values for your network.

---

## 8. Applying the delivered changes

- **Patch:** `git apply` / `git am utech-improvements.patch` on top of `a2f2e14`.
- **Bundle (recommended):** `git fetch utech-improvements.bundle master:utech-improvements && git checkout utech-improvements` — carries the full verified history.
- After applying, run the migrations (`npx prisma migrate deploy`) — the new `NumberSequence` migration is included.

*Report generated 2026-09-05 · fix commit `d050c61` · verified live (lint 0/0, 28 migrations, smoke tests green).*
