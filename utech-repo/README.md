# U-Tech Automation Industries — ERP

Manufacturing ERP with an Express/Prisma/MySQL backend and a React/Vite frontend. The application includes company and customer-owned inventory, purchase receipts, production, jobwork, dispatch, invoicing, payments and other operational modules.

**New to the software?** Start with [the step-by-step Hinglish beginner guide](./BEGINNER_GUIDE_HINGLISH.md). It covers stock effects, invoice versus dispatch, roles, a practice scenario and known limitations.

## Quick start: temporary demo

Requires Node.js 20+ and npm. From this directory, use two terminals:

```bash
# Terminal 1 — temporary in-memory API
cd backend
npm ci
USE_IN_MEMORY_DB=1 NODE_ENV=development COMPANY_STATE_CODE=27 npm start
```

```bash
# Terminal 2 — frontend (proxies /api to port 4000)
cd frontend
npm ci
npm run dev -- --host 0.0.0.0
```

Open the URL printed by Vite. Demo login: `admin@utech.local` / `Admin@123`. **This data is volatile and resets when the API restarts; it is not a production database.** The demo uses development secrets and sample data. Never reuse its credentials for a real deployment.

## MySQL setup for administrators

1. Review `backend/.env.example`; configure `DATABASE_URL`, a strong unique `JWT_SECRET`, allowed `CORS_ORIGIN`, `COMPANY_STATE_CODE`, mail settings if used, and deployment-specific settings. Do not commit secrets.
2. Install backend dependencies with `npm ci`, run `npx prisma generate`, and apply the checked-in migrations with `npx prisma migrate deploy` against the intended database after taking an appropriate backup.
3. Review `backend/prisma/seed.js` before running it: the full seed includes demo users and sample records. Set up real users, permissions, reference data and opening balances through a controlled deployment process. The in-memory adapter is blocked in `NODE_ENV=production`.
4. Build the frontend with `npm ci && npm run build`; serve it behind HTTPS with `/api` routed to the backend. Configure backups, access control, logging, recovery and tax settings for the deployment.

The isolated checks below do **not** validate a real MySQL deployment. Before production, test migrations, persistence, concurrent updates, security, backup/restore, stock/account reconciliation and business-specific tax treatment on a representative database.

## Automated checks

```bash
# backend, from backend/
npm run lint
npm test

# frontend, from frontend/
npm run lint
npm test
npm run build
npm run test:e2e
```

The Playwright suite starts isolated temporary in-memory servers on ports 4101 and 5183 and creates/modifies test records. To test an external server, explicitly set `E2E_CONFIRM_DISPOSABLE=1` and `E2E_BASE_URL` with `npm run test:e2e:external`. **Never point these write tests at production or important data.** Backend unit/API tests use a programmable database mock and do not prove database constraints or isolation.

## Company material inventory

The four photographed stock sheets in [`company_inventory/`](./company_inventory) are
part of the Prisma item master: 73 raw-material items (`RB-…` Round Bar & Hex,
`PP-…` Pipe, `PL-…` Plate, `FL-…` Flange), each with its sheet quantity as opening
stock, the printed rate as `purchaseRate`, a category, an HSN family code and an
`OPENING` stock-ledger row.

```bash
cd backend
npm run inventory:verify   # reconcile the transcription against the printed sheet totals
npm run prisma:seed        # full demo seed also imports missing company items
```

`npm run inventory:verify` re-adds every sheet's rate column and compares it with the
`Total=` printed on the photo (6,89,200 / 10,15,700 / 23,85,000 / 1,89,900), checks
that all 73 codes/names are unique and that the sheets carry this company's identity
(U-Tech Automation Industries, Chikhali, Pune 411062, state code 27) and only grades
the plant works with. It exits non-zero on any mismatch. See
[docs/COMPANY_INVENTORY_IMPORT.md](./docs/COMPANY_INVENTORY_IMPORT.md) — including the
one open question about whether the sheet's `Rate` column is a per-piece rate or a line
amount (both totals are reported; per-piece is what is stored).

Seeding is additive: an existing item is never re-priced or re-stocked, so re-seeding
cannot overwrite balances that receipts, dispatches or production have already moved.

## Stock and billing behavior

- Opening balances, accepted GRNs, manual adjustments, jobwork, production, dispatch and applicable returns create stock movements. Company stock and customer material lots are tracked separately.
- A purchase order alone does not increase stock. An invoice or payment alone does not decrease stock; physically shipped goods need a dispatch.
- The stock page shows the latest 500 filtered movements in posting order. `Posted` time can differ from the document date used by date filters.
- GRN cancellation reverses accepted stock, but it is **refused** when the received quantity is no longer on hand: the response lists the short items. A forced negative reversal exists for holders of `stock.adjust` only, is audited, and is labelled as such in the ledger.
- A sales return can only restore stock after the **physical return receipt** is recorded (return challan number + the date the goods were received, plus an optional dispatch challan that caps the returned quantity at what was actually shipped). `POST /api/sales-returns/:id/receipt` records it; `process` refuses without it.
- Dependency advisories are **resolved**: `npm audit` reports 0 open findings in both apps (previously 16 backend / 21 frontend). The abandoned `xlsx` package was replaced by `exceljs`; zod, vitest, vite, axios and react-router were upgraded. See `audit/HARDENING_2026-10-27.md`.
