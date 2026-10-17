# UTech ERP — Performance Report

**Date:** 2026-10-17

> ### What is and is not measured here
>
> **Measured:** production build output sizes (real `vite build`), test-suite run times,
> and static analysis of query shapes and render paths.
>
> **NOT measured, and no claim is made:** page load time, API latency, throughput,
> concurrent-user capacity, memory under load, or database query time. Running a load test
> requires a server with a real database and an agreed staging target. Neither existed in
> this environment. Any statement of the form "supports N concurrent users" would be
> fabricated, so none appears in this report.

---

## 1. Build output — measured

`cd frontend && npm run build` (vite 5.4.21, 2,440 modules transformed, 8.9 s):

| Asset | Size | Gzipped | Note |
|---|---|---|---|
| `dist/assets/index-*.js` | **1,634,972 B (1.63 MB)** | **446 kB** | single bundle, **no code splitting** |
| `dist/assets/index-*.css` | 69,170 B | 11.5 kB | fine |
| `dist/assets/pdf.worker.min-*.mjs` | 1,375,838 B (1.38 MB) | — | pdf.js worker, loaded only when a PDF is opened |
| `dist/index.html` | 490 B | 320 B | |

Vite itself warns: *"Some chunks are larger than 500 kB after minification."*

### AUD-108 (P2) — no route-level code splitting

All 77 routes, `recharts`, `pdfjs-dist` and the entire page set ship in one 1.63 MB file.
Every user — including an Operator whose whole job is one screen — downloads all of it on
first load.

**Fix, in order of value:**

1. `React.lazy()` + `<Suspense>` around the route elements in `App.jsx`. Mechanical, no
   behaviour change, and the largest single win: an Operator would download the dashboard
   and jobcard view instead of the whole ERP.
2. Move `recharts` into the three analytics pages via dynamic import — it is the heaviest
   dependency and is used on 3 of 77 routes.
3. `pdfjs-dist` is already isolated to the worker file; importing `PdfViewerModal` /
   `PdfThumbnail` lazily keeps the 1.38 MB worker out of the initial parse entirely.
4. Add `build.rollupOptions.output.manualChunks` for `react`/`react-dom`/`react-router-dom`
   so vendor code caches independently of app code.

Target: initial JS under ~350 kB raw / ~110 kB gzipped. That is an estimate based on
dependency weight, **not a measurement** — verify after the change.

## 2. API and query performance — static analysis

### AUD-107 (P2) — report exports are unbounded

Every handler in `report.controller.js` runs `findMany` with **no `take`** and a full
`include` of lines and parties, then builds an XLSX in memory:

```
invoices, jobcards, items, expenses, party-ledger, customer-stock,
vendor-stock, stock-ledger          → 8 endpoints, all unbounded
```

Only one `take:` appears in the whole file. A date-range filter exists on the invoice and
voucher exports but is optional. At a few thousand documents this is fine; the failure mode
is that it degrades into an OOM at some point in the future with no warning.

**Fix:** require a date range (or apply a hard default of e.g. 90 days), cap rows with a
clear "export truncated at N rows" note, and stream the workbook rather than buffering it.

### AUD-125 (P2) — N+1 aggregation inside create loops

`salesReturn.controller.create` and `purchaseReturn.controller.create` run one
`aggregate` **per line** to check cumulative returned quantity. A 20-line return issues 20
aggregates. Fix with a single `groupBy` over all the line ids.

### Query shapes that are already right

- List endpoints all go through `parseListQuery`, which clamps `pageSize` to **100** —
  a client cannot ask for the whole table. Verified by executed test
  (`?pageSize=999999` → 100).
- Sort columns are whitelisted per route, so a sort cannot force a full scan on an
  unindexed column by accident.
- `stockService.getLowStockItems` reads only `select`-ed scalar columns of active items and
  filters in JS — documented in the code as a deliberate choice because Prisma cannot
  compare two columns of the same row in a `where`. Correct for a small item master.
- `stock.controller.summary` fans its 13 independent counts out with `Promise.all` rather
  than awaiting them serially.

### Index gaps

See `DATABASE_AUDIT.md` §1 — 7 high-traffic child tables (`InvoiceLine`,
`PurchaseOrderLine`, `JobcardLine`, `SalesReturnLine`, `PurchaseReturnLine`,
`InvoicePayment`, `ProjectTask`) have no index on their foreign key. **NEEDS LIVE DB** to
quantify.

## 3. Frontend runtime

| Concern | Finding |
|---|---|
| Unbounded list rendering | Not present — every list page uses server pagination with `pageSize` ≤ 100 |
| Duplicate requests | `Protected` refreshes `/auth/me` once per app load (`useEffect(..., [])`), not per navigation. Page loaders key off `[page, filters]`, so a re-render does not re-fetch |
| Polling | None found — no `setInterval` against the API in `frontend/src` |
| Retry loops | None found — no automatic retry anywhere; retries are user-initiated (`DataTable` Retry, `OperatorDashboard` Try again) |
| Re-renders | 31 ESLint `react-hooks/exhaustive-deps` warnings remain. Each is a `useEffect` that calls a `load` function not in its dependency array. The current form is intentional (load on mount / on filter change, not on every render) but the warnings mean a future refactor could silently introduce a render loop. **AUD-114 (P3)** |
| Memory leaks | Event listeners in `Modal` and `ConfirmDialog` are removed in their effect cleanups; `OperatorDashboard` and `ActivityTimeline` guard async setState with a `cancelled` flag. No leak found in the shared kit |
| Image/asset weight | Only `favicon.svg`. No heavy static assets |

## 4. Test-suite run times — measured

| Suite | Tests | Duration |
|---|---|---|
| Backend (7 files) | 668 | **4.46 s** (tests 2.96 s, collect 0.43 s) |
| Frontend (7 files) | 132 | **7.84 s** |

Both are fast enough to run on every commit, which is the point — a suite nobody runs is
worth nothing.

## 5. What to measure next, and how

Once a staging instance with a real database exists:

```bash
# 1. Cold load of the Operator dashboard and the Invoices list (real browser)
npx playwright test --project=chromium   # requires a browser download

# 2. API latency under load against STAGING ONLY, with an agreed ceiling
k6 run --vus 20 --duration 60s scripts/load-invoice-list.js

# 3. Slow queries — enable the MySQL slow log at 200 ms and replay the exports
SET GLOBAL slow_query_log = 'ON'; SET GLOBAL long_query_time = 0.2;
```

Record baseline p50/p95/p99 latency, throughput, error rate and RSS before and after the
AUD-107 and index fixes. Until those numbers exist, this report makes no performance
claim about the running system.
