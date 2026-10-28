# Final Audit & Verification — 2026-10-28

Branch: `arena/c0b55e4d-utech` · Stack: React 18 + Vite + Tailwind (frontend), Express + Prisma + MySQL (backend, in-memory adapter for tests/demo), Vitest + Playwright configured.

Prior passes (see `BUG_TRACKER.md`, `HARDENING_2026-10-27.md`) had already fixed AUD-102…213. This pass re-verified those claims against the code (several "open" items — graceful shutdown AUD-120, capped exports for invoices/stock, `ActivityTimeline` error state AUD-116 — are in fact already implemented), then fixed what was genuinely still open below. Baseline before changes: **backend 899 / frontend 172 tests green**. After changes: **backend 900 / frontend 176, lint clean both sides, production build passes.**

## 1. Executive summary

The core ERP (parties, items, PO→GRN→stock ledger, jobcards, jobwork, dispatch, invoices/payments, returns, customer material, reports) is functionally sound at the controller/service level and heavily regression-tested. The serious gaps this pass were in the **presentation layer the user explicitly flagged** — the app had drifted from its violet identity to teal, the desktop sidebar had **no collapse control at all**, density was loose — and in **export safety**: spreadsheet formula injection was possible through user-entered names, and four exports were still uncapped with truncation never surfaced to the user.

## 2. Issues found & fixed

| # | Sev | Issue | Root cause | Fix |
|---|---|---|---|---|
| N-01 | P2 (UX, user-flagged) | Desktop sidebar could not be collapsed; 264px always consumed | Only a mobile drawer existed | Icon rail (64px) with tooltips + `aria-label`s, toggle in sidebar header, persisted in `localStorage` (`utech.sidebar.collapsed`); section expansion also persisted and active section auto-expands. Mobile drawer unchanged. `AppLayout.jsx` + 4 new tests |
| N-02 | P2 (brand) | Theme had drifted violet → teal (`#0f766e` scale, teal sidebar/charts); Dashboard comment even says "violet family" while using teal | `tailwind.config.js` brand scale replaced at some point | Brand scale restored to violet (50 `#f5f3ff` … 600 `#7c3aed` ≈5.9:1 on white, 700 ≈7.5:1), CSS custom properties added in `styles.css`, sidebar/logo/active states + dashboard & analytics chart colours moved to violet. Semantic success/warning/danger colours unchanged |
| N-03 | P2 (UX, user-flagged) | Excess bottom whitespace / loose density | Shell reserved a full-height sticky sidebar column with `p-8` content padding, 28px page titles, `py-2.5`–`py-3` controls/rows, 24px header margins | Shell now `min-h-dvh` with content-determined height (no forced page height beyond the viewport shell), main padding `p-3/5/6`, header `h-14`, PageHeader `mb-4` + 24px title, buttons/inputs `py-2`, table cells `px-3 py-2`. No content is clipped or hidden; long pages scroll normally |
| N-04 | P1 (security) | **Spreadsheet formula injection** in every XLSX export: a party/item/description starting with `=`, `+`, `-`, `@` would execute as a formula when opened in Excel | `utils/xlsx.js` passed strings through untouched | `sanitizeCellString()` prefixes such values with `'` (forces text). Verified by unit test reading the workbook back with exceljs (cell is text, no formula) and live: exported sheet contains no `<f>` formula nodes |
| N-05 | P2 | Four exports still ran **unbounded `findMany`** (jobcards, items, expenses, vendor-stock lines) and party-ledger export was uncapped + unaudited (remainder of AUD-107) | Earlier cap pass only covered invoices/customer-stock/stock-ledger | All now use the existing `fetchCapped` 5,000-row cap with `X-Export-Truncated` signalling; party ledger capped in ascending order (running balances stay correct for included rows) and now audit-logged |
| N-06 | P2 | Truncated exports looked identical to complete ones in the UI — `ReportsPage` always toasted "downloaded", party-ledger download gave **no feedback at all** | `downloadFile()` discarded response headers | `downloadFile()` returns `{truncated, rows, rowLimit}`; Reports page and Party ledger show an 8s error toast naming the cap when truncated, success toast otherwise |
| N-07 | P2 (ops, AUD-119) | No CI — nothing ran the ~1,000 tests on push | `.github/` missing | `.github/workflows/ci.yml`: backend lint+test, frontend lint+test+build on push/PR (Node 20) |

## 3. Business workflow report (verified live against the in-memory server)

Login (JWT) → party create (201, `P-0011`) → items list (83 seeded incl. 73 company-inventory items) → dashboard summary → stock summary → invoice PDF (`200 %PDF-`) → XLSX exports with cap headers. Negative checks: unauthenticated `401`, invalid party payload `400` (Zod). Stock invariant (opening + in − out = closing), GRN-cancel shortfall refusal, sales-return physical-receipt gate, over-return caps and GST discount-before-tax are covered by the existing executed suites (`inventoryReconciliation`, `regressionDefects`, `workflows` — all green). PO alone does not move stock; dispatch (not invoice) decrements it — unchanged.

## 4. UI/UX improvements

Violet design tokens centralised (`tailwind.config.js` brand scale + `--brand-*` vars); compact sidebar (248px, 13px items) with persisted collapse-to-rail; compact PageHeader/tables/forms via shared classes so every module inherits the density; reports page section gap reduced. Print CSS (`.print-doc`, A4 `@page`, `no-print`) untouched — approved document formats preserved.

## 5. Button/navigation report

No dead buttons found in source scan (matches prior pass). New sidebar toggle, rail links, and section headers are covered by `frontend/tests/components/sidebarCollapse.test.jsx` (4 tests: expanded default, collapse+persist, expand+persist, section toggle does not navigate). All pre-existing nav/permission contract tests (35) and route-resolution tests still pass.

## 6. Print / Excel / PDF report

Invoice PDF returns a real `%PDF-` payload live. XLSX: valid zip containers, frozen header row, capped at 5,000 rows with `X-Export-Truncated` header + audit row, formula injection neutralised (unit + live sheet inspection). Print layouts were **not** re-rendered in a real browser in this environment (no browser engine available) — print CSS was deliberately left unchanged.

## 7. Security report

Fixed: formula injection (N-04). Re-verified: JWT auth + per-route `requirePermission`, Zod validation on write routes, upload serving is authenticated (no public `/uploads` static mount), rate limiting on credential endpoints, helmet, audit logging. **Remaining/unverified:** password-reset OTP flow still only completes for `purpose: 'login'` and OTP delivery is not wired to email — the login page honestly directs users to an admin; wiring real mail delivery is a product/infra decision, not silently "fixed". JWT in `localStorage` (AUD-109) and 54 unvalidated write routes (AUD-115, mitigated by controller whitelists) remain as previously documented.

## 8. Test results (exact commands, all executed)

```
backend:  npm ci && npm test        → 28 files, 900 passed (was 899)
          npm run lint              → exit 0
frontend: npm ci && npm test        → 17 files, 176 passed (was 172)
          npm run lint              → exit 0
          npm run build             → PASS (chunk-size warning only, pre-existing)
live:     USE_IN_MEMORY_DB=1 npm start (API :4000) + npm run dev (web :5173)
          login/party/items/dashboard/stock/PDF/XLSX/401/400 checks → all as §3
```
Not run: Playwright E2E and real-MySQL migration replay (no browser/DB in this sandbox) — run both against staging before production, per README.

## 9. Changed files

`frontend/tailwind.config.js`, `frontend/src/styles.css`, `frontend/src/components/layout/AppLayout.jsx`, `frontend/src/components/ui/PageHeader.jsx`, `frontend/src/pages/Dashboard.jsx`, `frontend/src/pages/analytics/InventoryAnalytics.jsx`, `frontend/src/lib/download.js`, `frontend/src/pages/reports/ReportsPage.jsx`, `frontend/src/pages/parties/PartyForm.jsx`, `frontend/tests/components/sidebarCollapse.test.jsx` (new), `backend/src/utils/xlsx.js`, `backend/src/controllers/report.controller.js`, `backend/tests/unit/xlsxExport.test.js`, `.github/workflows/ci.yml` (new), this report.

## 10. Remaining issues

P1-ops: backup/restore procedure still undocumented (AUD-127) — needs client infra. P2: route-level code splitting (AUD-108, build warns >500kB chunks), stock reconciliation job (AUD-129), timezone-naive dates (AUD-130, needs live DB to confirm). P3: silent `.catch(() => {})` dropdown loads in a few forms (JobcardForm users/UoMs, RolesPage departments) show empty lists instead of an error; `type="button"` still missing on many out-of-form buttons (harmless today, brittle if wrapped in a form); password-reset email delivery (see §7).

## 11. Deployment checklist

1. `cd backend && npm ci && npx prisma generate && npx prisma migrate deploy` (no new migrations in this pass — schema untouched; backup first regardless).
2. `cd frontend && npm ci && npm run build`, serve behind HTTPS with `/api` proxied to the backend.
3. Set real `JWT_SECRET`, `CORS_ORIGIN`, `COMPANY_STATE_CODE` (never the demo values); confirm CI is green on the merge commit.
4. Replay the backend suite + one GRN→jobcard→dispatch→invoice cycle against a staging MySQL copy; verify one invoice PDF and one capped export.
5. Rollback: this pass is code-only with no schema or data changes — revert the commit to roll back; no data migration to undo.
