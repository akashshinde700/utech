# UTech ERP — Frontend Audit Report

- **Audit date:** 2026-09-05
- **Repo commit:** `a2f2e14` (`update`)
- **Scope:** `/home/z/my-project/utech-repo/frontend` — React 18 + Vite 5 SPA (~40 pages), axios client (`src/lib/api.js`), custom permission lib, DataTable infrastructure.
- **Purpose:** These findings drove the subsequent fix phase. Severity order: CRITICAL → HIGH → MEDIUM → LOW (+ Config). Every item carries file:line references into the audited commit.

---

## CRITICAL

### C1 — No React ErrorBoundary → any render error is a white screen
**File:** `src/main.jsx:8-28`

The app mounts with no ErrorBoundary anywhere in the tree. A single render-time exception (including all of the C2 join crashes below) unmounts React and leaves the user staring at a blank page with no recovery path.

**Fix:** wrap `<App/>` (and ideally each route element) in a class-based ErrorBoundary with a "reload" recovery action.

### C2 — Unguarded property joins crash entire views
These throw `TypeError: Cannot read properties of undefined` when API payloads are shaped differently than assumed (deleted party, zero lines, failed fetch returning `null`):

| Location | Unguarded access |
|----------|------------------|
| `src/pages/InvoiceView.jsx:49,63` | `inv.party.name` |
| `src/pages/PurchaseOrderView.jsx:16,22` | `po.party.name` |
| `src/pages/JobcardView.jsx:334` | `jc.lines.length` |
| `src/pages/JobcardView.jsx:529` | `jc.reverts.length` |
| `src/components/ChecklistWidget.jsx:25` | `checklist.map` |
| `src/pages/CustomerMaterialPage.jsx:61` | `r.status.replace` |
| `src/pages/CustomerMaterialView.jsx:64,121` | nested status/accessors |
| `src/pages/StockManagementPage.jsx:118` | `r.refType.replace` |
| `src/pages/QuotationView.jsx:240` | `q.lines.map` |
| `src/pages/RolesPage.jsx:80` | `r.permissions.length` |

**Fix:** optional chaining (`inv.party?.name ?? '—'`, `(jc.lines ?? []).length`, etc.) — combined with C1's boundary as the last line of defense.

### C3 — Vendor Work Orders module is unreachable (feature shipped but not routed)
**Files:** `src/App.jsx` (no routes) vs `src/pages/VendorWorkOrdersPage.jsx`, `VendorWorkOrderForm.jsx`, `VendorWorkOrderTrail.jsx`, `SendToVendorModal.jsx`, `RecordReturnModal.jsx`

Six component files exist for the Vendor Work Orders module, but `App.jsx` defines **no `/vendor-work-orders` routes** and `AppLayout` has **no nav entry**. Any direct URL hits the catch-all route and **silently redirects home** (`App.jsx:204`). The feature is dead code from the user's perspective, despite backend routes existing (`/api/vendor-work-orders`).

**Fix:** add routes + sidebar nav entry.

### C4 — `numberToWords` breaks on negative amounts and boundary paise
**File:** `src/lib/numberToWords.js:17-32`

- Negative amounts render **"undefined Crore…"**.
- Paise rounding can hit 100 → **"undefined Paise"**.
- `0.50` renders as **" Rupees and Fifty Paise Only"** (missing "Zero").
- Used on **printed quotations** (`QuotationView.jsx:263`) — customer-facing legal amount text is corrupted.

### C5 — Analytics pages crash on failed/absent data
- `src/pages/SalesAnalytics.jsx:89` — `totals.growthPct.toFixed(...)` on `null` when totals are absent.
- `src/pages/InventoryAnalytics.jsx:33` — `data.totalItems` unguarded when the fetch fails.
- **All three analytics pages** use `.finally(...)` without `.catch(...)` — rejected promises are unhandled and the page never leaves its loading state.

### C6 — Corrupt localStorage bricks the entire app at module init
**File:** `src/store/auth.js:9`

`JSON.parse(localStorage.getItem(...))` runs at **module import time** with no try/catch. One corrupt value (e.g. truncated by quota pressure) throws during module init → **the app never boots**, for that user, forever (until localStorage is manually cleared).

---

## HIGH

### H1 — `hasPermission()` is dead code; UI is fully permission-blind
**File:** `src/lib/permissions.js`

`hasPermission()` is **never imported anywhere**. The sidebar and every action button render for every user regardless of role. The only manually gated page is `JobcardsPage.jsx:16`. Everything else shows enabled controls that return 403 from the API (see H2).

### H2 — Frontend permissions fail OPEN; backend fails closed
**File:** `src/lib/permissions.js:14`

`hasPermission()` returns **true on an empty permission array** while the backend fails closed → users see functioning-looking buttons that always 403. Invert to fail-closed and wire H1's imports.

### H3 — Double-submit on every money/stock form (no saving/disabled flags)
Submit handlers set no `saving` state and don't disable the button — a double click books the transaction twice (duplicate invoices, duplicate stock movements):

`InvoiceForm.jsx:208`, `JobcardForm.jsx:418` (which also performs N sequential uploads, multiplying the risk), `JobworkForm.jsx:128`, `DispatchForm.jsx:93`, `GRNForm.jsx:124`, `ExpensesPage.jsx:129`, `UsersPage.jsx:323`, `ProcessPage.jsx:78`, `QualityPage.jsx:122`, `PartyForm.jsx:88`, `ItemForm.jsx:88`, `CustomerMaterialForm.jsx:99`, `JobcardView.jsx:120,143`, `InvoiceView.jsx:165`.

A correct pattern already exists in `QuotationForm.jsx:365` — replicate it everywhere.

### H4 — 401 handling: hard redirect, no toast, work lost
**File:** `src/lib/api.js:20-23`

A 401 triggers `location.href` redirect with **no toast and no state preservation** — the user loses whatever form they were filling.

### H5 — No token-expiry awareness
**Files:** `src/App.jsx:73-94`

Boot only checks token **presence**, not expiry; `refreshMe` returning 401 is **swallowed** (`App.jsx:85`) — the app renders as "logged in" with a dead token until the next API call hard-redirects (H4).

### H6 — Client-side quantity validation missing
- `src/pages/JobworkPage.jsx:100-112` — receive qty **uncapped** (can receive more than dispatched).
- `src/pages/BackOrderForm.jsx:130-138` — fulfill qty via native `prompt()`, unvalidated.
- `src/pages/GRNForm.jsx` — no `qtyAccepted + qtyRejected ≤` PO-balance cap.
- `src/pages/QuotationView.jsx:122-127` — `updateStatus` has **no try/catch** (unhandled rejection on failure).

### H7 — Restricted-role rules duplicated stringly-typed
**Files:** `src/App.jsx:68-71`, `src/components/AppLayout.jsx:129`

Role-name comparisons are duplicated as raw string literals in two files (e.g. matching `role.name === 'SUPERADMIN'`-style checks) — renaming a role in one place silently breaks the other.

---

## MEDIUM

| # | Finding | References |
|---|---------|------------|
| M1 | **No loading state on ~21 list pages** while `DataTable` already supports a `loading` prop: QuotationsPage, JobworkPage, DispatchPage, ProcessPage, ExpensesPage, QualityPage, GRNsPage, PurchaseOrdersPage, SalesReturnsPage, PurchaseReturnsPage, BackOrdersPage, ProductionPage, BomPage, MachinesPage, UsersPage, DepartmentsPage, DepartmentSubCategoryPage, ProjectsPage, CustomerMaterialPage, AssignmentsPage, VendorWorkOrdersPage | respective page files |
| M2 | **No error states** — failed fetches render as "empty data". Worst: `OperatorDashboard.jsx:14-18`; `Dashboard.jsx:170` swallows the catch | `OperatorDashboard.jsx:14-18`, `Dashboard.jsx:170` |
| M3 | Zero debounce + **request-per-keystroke** on VendorWorkOrdersPage; no request sequencing in list loads (stale responses can overwrite fresh ones) | `VendorWorkOrdersPage.jsx:196-201` |
| M4 | Stock adjust has **NO confirmation dialog** (destructive, permanent); PO reject reason uses native `prompt()` | `StockManagementPage.jsx:49-61`, `PurchaseOrdersPage.jsx:30` |
| M5 | `DataTable` empty message says "no records" even when the list is **filtered** (wrong copy) | `src/components/DataTable.jsx:41` |
| M6 | Modals lack `role="dialog"`/aria/focus-trap; user dropdown has no outside-click close | modals generally, `AppLayout.jsx:246-279` |
| M7 | **15 forms prefill dates with `toISOString()`** → date shows **yesterday between 00:00–05:30 IST**: InvoiceForm.jsx:20, InvoiceView.jsx:54, JobcardForm.jsx:30, JobworkForm.jsx:14, DispatchForm.jsx:13, GRNForm.jsx:16, QualityPage.jsx:12, ExpensesPage.jsx:13, CustomerMaterialForm.jsx:17, QuotationForm.jsx:21-22, SalesReturnForm.jsx:20, PurchaseReturnForm.jsx:24, BackOrderForm.jsx:22, ProductionForm.jsx:27, SendToVendorModal.jsx:6 | as listed |
| M8 | AssignmentsPage renders dates with raw `toLocaleDateString()` instead of `format.date` (en-IN); `format.datetime` omits the year | `AssignmentsPage.jsx`, `lib/format` |
| M9 | Thin client validation: GSTIN/PAN free text, GST% unbounded, discount unbounded (`InvoiceForm.jsx:138`), payment amount unvalidated (`InvoiceView.jsx:156`) | as listed |
| M10 | Lookup selects capped at `pageSize 1000` and **unsearchable** (can't pick a party beyond 1000); raw ID text inputs for GRN (`GRNForm.jsx:82`) and Quality (`QualityPage.jsx:90`) | `InvoiceForm.jsx:26-27`, `QuotationForm.jsx:36`, as listed |
| M11 | Notification click does **not navigate** to the target record; topbar title hardcoded "Dashboard"; Pagination shows "Page 1 of 0"; Login page doesn't redirect when already authed; PurchaseReturnForm.jsx:256 dead edit path | `NotificationBell.jsx:81-90`, `AppLayout.jsx:240`, `Pagination`, `Login`, `PurchaseReturnForm.jsx:256` |

---

## LOW

| # | Finding | References |
|---|---------|------------|
| L1 | `alert()` used in 6 files | various |
| L2 | Double-toasting: `api.js:25` toasts errors **and** page-level catch toasts again | `api.js:25` + page catches |
| L3 | `key={i}` index keys on dynamic line rows (state bleed on row delete) | line-row renders |
| L4 | Unhandled delete rejections (silent failure) | `QuotationsPage.jsx:32`, `ProcessPage.jsx:33`, `ExpensesPage.jsx:53` |
| L5 | ImageThumb downloads the image twice | `ImageThumb` |
| L6 | Object URL leak (never revoked) | `InvoiceView.jsx:33-43` |
| L7 | `expandedSections` init misses 3 sidebar section ids | `AppLayout.jsx:131-139` |
| L8 | Empty-catch anti-patterns (errors silently discarded) | `PartyForm.jsx:37`, `ItemForm.jsx:42`, `JobworkForm.jsx:50`, `DispatchForm.jsx:31`, `CustomerMaterialForm.jsx:45`, `JobcardForm.jsx:236` |
| L9 | Boot-time user load has no catch | `UsersPage.jsx:68-75` |
| L10 | `Badge` `status=PAID` styling misused for Active/COMPLETED/FULFILLED chips | Badge usage |

---

## Config

- **Vite proxy timeout (10000ms) < axios timeout (30000ms)** — any request longer than 10s (e.g. big XLSX report exports) dies at the dev proxy while axios is still waiting. Raise the proxy timeout above axios's.
- `src/lib/api.js` has no `VITE_API_URL` escape hatch — acceptable while the app is same-origin (the port-3000 wiring proxies `/api` and `/uploads` to the backend), but worth adding for deploy flexibility.

---

## Fix-phase priorities

1. **C1 + C2 + C6** — boot/render robustness (ErrorBoundary, optional-chaining sweep, safe localStorage read).
2. **C3** — route + nav for Vendor Work Orders (feature is otherwise unreachable).
3. **H1 + H2** — wire `hasPermission()` (fail-closed) into sidebar and action buttons.
4. **H3** — port `QuotationForm.jsx:365` saving-flag pattern to all 15 listed forms.
5. **C4/C5/H4–H7** — numberToWords, analytics guards, 401 UX, qty caps, role-rule consolidation.
6. **MEDIUM/LOW + Config** — batch fixes (date prefill helper, loading/error props, a11y, proxy timeout).
