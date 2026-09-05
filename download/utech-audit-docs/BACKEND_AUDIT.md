# UTech ERP — Backend Audit Report

- **Audit date:** 2026-09-05
- **Repo commit:** `a2f2e14` (`update`)
- **Scope:** `/home/z/my-project/utech-repo/backend` — Express 4 + Prisma 5 (MySQL/MariaDB), 37 route files, 38 controllers, services, utils, seed.
- **Purpose:** These findings drove the subsequent fix phase. Severity order: CRITICAL → HIGH → MEDIUM → LOW. Every item carries file:line references into the audited commit.

---

## CRITICAL

### C1 — Dispatch: stock leaves the company at DRAFT; CANCELLED never restores it
**File:** `src/controllers/dispatch.controller.js:35-67`

Stock is moved **OUT** of company stock at **DRAFT creation** time (lines 35-67). When a dispatch is later cancelled via `markStatus('CANCELLED')`, the stock movement is **never reversed** — `DISPATCH_CANCEL` exists as a `refType` in the Prisma schema but is **never used anywhere in code**. Net effect: every cancelled dispatch permanently destroys inventory that physically never left the building → **permanent phantom inventory loss** and a StockLedger that diverges from reality.

**Fix required:**
- On `markStatus('CANCELLED')`, reverse stock inside a `$transaction` via `moveCompanyStock` with `qtyIn` and `refType: 'DISPATCH_CANCEL'` per line.
- Forbid `CANCELLED` once the dispatch has reached `DELIVERED`.

### C2 — Mass assignment on unvalidated update endpoints
**Files:** 17 route files call **no** `validate()` middleware at all; 5 more import it but **never call it**: `salesReturn.routes`, `purchaseReturn.routes`, `backOrder.routes`, `production.routes`, `bom.routes`.

Controllers spread raw `req.body` straight into Prisma `update:`:
- `src/controllers/salesReturn.controller.js:119`
- `src/controllers/purchaseReturn.controller.js:130`
- `src/controllers/backOrder.controller.js:108`
- `src/controllers/production.controller.js:139`
- `src/controllers/quality.controller.js:60`
- `src/controllers/expense.controller.js:59`
- `src/controllers/machine.controller.js:34`
- `src/controllers/process.controller.js:36`
- `src/controllers/project.controller.js:41` and `:72`

A client can forge `status`, `number`, `id`, `createdAt` (and any other scalar column) on these endpoints. L12 (below) confirms `machine/process/project` also accept raw `req.body` as create payloads.

**Fix required:** explicit field whitelists per endpoint + zod schemas wired into the route chain.

### C3 — Privilege escalation via user update (no department scoping / hierarchy guard)
**Files:** `src/controllers/user.controller.js:105-132` (update) vs `prisma/seed.js:117-127`

`update()` has **no department scoping and no hierarchy guard**, while the seed grants `user.update` to Department Head / Supervisor / Team Leader (`prisma/seed.js:117-127`). Any such user can:
- set **any** user's `roleId` to **SUPERADMIN**, or
- reset the **Super Admin's password**.

**Fix required:**
- Only SUPERADMIN / elevated callers (role `hierarchyLevel <= 1`) may change `roleId`, `password`, `isActive`.
- Department-scoped callers may only edit users **within their own department**.
- A caller can never assign a role with `hierarchyLevel <=` their own.

### C4 — Jobwork: receive has no status guard, rollup bug, uncapped over-receipt, null-item crash
**File:** `src/controllers/jobwork.controller.js`

- `receive()` (lines 90-131) has **no status guard** — stock can be received against a `CANCELLED` or already-`RECEIVED` jobwork → phantom stock inflow.
- `allResolved` is computed **only over the payload lines**, not all jobwork lines → rollup bug (jobwork marked resolved while unsubmitted lines remain).
- **Over-receipt is uncapped** — received qty is never checked against dispatched/expected qty.
- **Crash:** a COMPANY-owned, description-only line has `itemId === null`; `findUnique({ id: undefined })` throws → HTTP 500. Affected in `create()` at lines 72-76 and `receive()` at lines 119-123.

### C5 — Document numbering: max+1 read-then-write race
**File:** `src/utils/numbering.js:19-34`

`max+1` is read then written **outside any transaction**. Under concurrency two callers get the same number; one then hits the unique constraint → **409** and a failed business operation.

**Fix required:** a `NumberSequence` table with an atomic increment (upsert + increment inside a transaction).

### C6 — moveCompanyStock: read-modify-write TOCTOU; stale negative-stock check
**File:** `src/services/stockService.js:15-23`

`moveCompanyStock` does a read-modify-write on the stock row. The negative-stock guard runs on a **stale read**; concurrent operations can drive stock **negative** and diverge from the StockLedger.

**Fix required:** conditional atomic `updateMany` decrement (e.g. `where: { id, currentStock: { gte: qty } }`) and verify the update count.

### C7 — Attachments: zero permission checks, unauthenticated static uploads, arbitrary file types
**Files:** `src/routes/attachment.routes.js:40-45`, `src/controllers/attachment.controller.js:37-46`, multer config lines 28-31, `src/server.js:63`

- `attachment.routes.js:40-45` — **no `requirePermission` on any route** (list/download/delete).
- `attachment.controller.js:37-46` — ownership checks exist only for `OPERATOR` + `JOBCARD`/`ASSIGNMENT` ref types → **any authenticated user can list, download and DELETE any attachment, including invoices**.
- Multer config (lines 28-31) has **no `fileFilter`** — any file type is accepted.
- `/uploads` is served as **unauthenticated static** (`server.js:63`).
- `downloadOne` serves inline with an **attacker-controlled `mimeType`** (content-type sniffing / XSS vector).

### C8 — Tally integration: SSRF + two broken exports + unescaped XML
**File:** `src/controllers/tally.controller.js`

- **SSRF:** `syncToTally` (lines 160-174) POSTs to a **user-supplied URL** — internal network probing / credential exfiltration vector.
- `exportMasters('parties')` is broken: `include` references a `uom` relation that **does not exist on Party** (lines 102-107) → 500.
- `exportVouchers` is broken: calls `invoice.date.split(...)` on a `Date` object (line 79) → 500.
- XML is built by **string interpolation with no escaping** (see also L7).

### C9 — Seed resets the admin password on every run
**File:** `prisma/seed.js:156-166`

The seed upsert **resets `passwordHash` to the `Admin@123` hash on every run**. Any routine re-seed silently restores default credentials — combined with C3, a full account-takeover path.

---

## HIGH

### H1 — `jobcard.progress` and `stock.adjust` permissions are never seeded
**Files:** `src/routes/jobcard.routes.js:283-284`, `src/routes/stock.routes.js:585`

The routes require `jobcard.progress` / `stock.adjust`, but the seed never creates these permissions → **only SUPERADMIN can complete jobcards or adjust stock** (permission checks fail closed for everyone else).

### H2 — Production: unvalidated quantities; edits allowed after COMPLETED
**File:** `src/controllers/production.controller.js`

- `completeBatch` (lines 184-233): unvalidated `qtyProduced` — `NaN`/negative values produce **NaN stock** or a **negative stock-out**.
- `updateMaterialConsumption` (lines 248-270): allows edits **after the batch is COMPLETED** → ledger divergence.

### H3 — Invoices: unsafe cancel/edit/pay; IGST flip
**File:** `src/controllers/invoice.controller.js`

- `remove()` (lines 131-135) cancels an invoice that **has payments**, with **no audit trail**.
- `update()` (lines 95-129) edits lines of a **PAID** invoice.
- `addPayment()` (lines 137-155) accepts payments on a **CANCELLED** invoice, allows **overpay**, and does a **read-modify-write on `amountPaid`** (concurrent lost update).
- `isIntraState` defaults to `true` on create (M1) but is **lost on update** → an IGST invoice silently flips to CGST+SGST after a line edit.

### H4 — GRN: receipts against bad PO state; cross-PO line confusion; REJECTED without reversal
**File:** `src/controllers/grn.controller.js`

- `create()` (lines 60-145) accepts receipts against a **DRAFT / CANCELLED / REJECTED** purchase order.
- Does **not validate that `poLineId` belongs to `poId`**.
- `update()` (lines 147-157) lets status flip to **REJECTED without stock reversal**.

### H5 — Returns: no cumulative quantity caps
**Files:** `src/controllers/salesReturn.controller.js:67-107`, `src/controllers/purchaseReturn.controller.js:74-118`

- Neither return flow caps cumulative returned qty against the source **invoice / GRN lines** (returns can exceed what was ever sold/bought).
- Purchase returns can be created **without `grnId`/`poId` for any party** — unanchored stock-out.

### H6 — PartyLedger is never written by invoices / payments / expenses
Only `salesReturn.controller.js:200` and `purchaseReturn.controller.js:212` write `PartyLedger`. Invoices, payments and expenses never do → the **party ledger report is misleading** (missing most debits/credits).

### H7 — Audit gaps across core flows
`audit()` is never called in: `item`, `party`, `quotation`, `quotationTemplate`, `machine`, `role`, `department`, `notification` controllers; and missing specifically in `invoice.remove`, `invoice.addPayment`, `dispatch.markStatus`, `jobcard.addNote`, `quotation.convertToInvoice`. **Role and permission changes are unaudited.**

### H8 — OTP authentication weaknesses
**File:** `src/controllers/auth.controller.js:59-100`

- OTP generated via **`Math.random()`** (not `crypto.randomBytes`) — predictable.
- OTP is **always logged to console**, including production.
- `devCode` is returned in the API response **outside production**.
- **No per-email throttle** (the route-level limiter is global, not per target).
- Old OTPs are **never invalidated** on re-request.
- OTP login is **unaudited**.
- **Double-consume race:** `verifyOtp` check-then-delete (lines 82-87) lets one OTP be consumed twice concurrently (also L5).

### H9 — Vulnerable dependencies processing user input
- `multer ^1.4.5-lts.1` — known DoS advisories, fixed in 2.x.
- `xlsx ^0.18.5` — prototype pollution / ReDoS advisories.
Both directly process **user-supplied input**.

---

## MEDIUM

| # | Finding | References |
|---|---------|------------|
| M1 | `isIntraState` default `true` lost on update → IGST invoice flips to CGST+SGST | `invoice.schema.js:18`, `invoice.controller.js:103` |
| M2 | GST discount applied **after** tax (discount does not reduce taxable value) — GST compliance issue | `invoice.controller.js:70-71`, `utils/gst.js:23` |
| M3 | Quotation header tax vs stored 0% lines inconsistent | `quotation.controller.js:48-68` vs `buildLines:42` |
| M4 | Quotation→invoice conversion accepts CANCELLED/REJECTED quotations and **drops HSN/GST** fields | `quotation.controller.js:115` |
| M5 | Jobcard status transitions ungoverned — `PUT /:id` accepts any status; `revert()` (181-198) lacks `assertOwnership` | `jobcard.controller.js` |
| M6 | Jobwork **rejected qty is never returned** to company stock | `jobwork.controller.js:112-126` |
| M7 | Cancelling a jobwork linked to a VendorWorkOrder does **not roll back the VWO status** | `jobwork.controller.js:150-185` |
| M8 | `purchase-order` sub-route lacks the `vendorWorkOrder.update` permission requirement | `vendorWorkOrder.routes.js:664` |
| M9 | `backOrder.fulfill` qty unvalidated | `backOrder.controller.js:148` |
| M10 | Purchase REJECTED is a dead-end state (no re-submit path) **and** the creator can self-approve | `purchase.controller.js:18-19, 127-144` |
| M11 | `parseInt` NaN → 500 on list endpoints | `invoice.controller.js:26`, `utils/pagination.js:6-7` |
| M12 | Attachment download stream has **no error listener** → process crash on client-abort race | `attachment.controller.js:137` |
| M13 | No `app.set('trust proxy')` behind the sandbox proxy → shared rate-limit lockout for all users + wrong audit IPs | `server.js:60` |
| M14 | `requireAuth` does a 3-level join per request and **never checks `role.isActive`** | `middleware/auth.js:16-34` |
| M15 | `assignment.list` unbounded (no pagination cap) | `assignment.controller.js:79` |
| M16 | Item `openingStock` silently sets `currentStock` with **no OPENING StockLedger row** (refType exists in schema) | `item.controller.js:52-58` |
| M17 | `Math.max(0, …)` silently clamps corrupt negative stock instead of surfacing it | `grn.controller.js:192`, `services/vendorWorkOrderService.js:62-63` |

---

## LOW

| # | Finding | References |
|---|---------|------------|
| L1 | `notifyUsers` role-name drift (`SUPERADMIN`/`MANAGER` vs `Admin`/`Plant Head` used elsewhere) → those notifications never reach anyone | `jobcard.controller.js:264` |
| L2 | Seed invoice numbers `INV-1001` don't match the runtime `INV-YY-#####` scheme | `seed.js:233-237` |
| L3 | Dashboard `invoicesLast30Days` **counts CANCELLED** invoices while `salesLast30Days` excludes them — inconsistent KPIs | `dashboard.controller.js:21-23` |
| L4 | Login email is **case-sensitive** | `auth.controller.js` (login) |
| L5 | OTP double-consume race | `auth.controller.js:82-87` (see H8) |
| L6 | `express.json` limit 5mb generous; `CORS_ORIGIN` falls back silently when unset | `server.js:55`, config |
| L7 | Tally XML has no escaping | `tally.controller.js` (see C8) |
| L8 | Quality `refType` is free-form (no enum validation) | `quality` controller/routes |
| L9 | Missing indexes: `StockLedger(refType, refId)`, `GRN(createdAt)`, `Jobcard(createdAt)` | `prisma/schema.prisma` |
| L10 | `customerMaterial` N+1 aggregates | `customerMaterial.controller.js:42-45` |
| L11 | Assignment duplicate-check TOCTOU (check-then-create) | `assignment.controller.js:194-204` |
| L12 | `machine`/`process`/`project` create accepts raw `req.body` incl. `id`/`createdAt` | `machine.controller.js:34`, `process.controller.js:36`, `project.controller.js:41,72` |

---

## Fix-phase priorities

1. **C1, C4, C6** — stock-integrity trio (dispatch reversal, jobwork guards, atomic stock ops).
2. **C2 + M11/L12** — validation sweep (zod + whitelists) across all route files.
3. **C3 + C9** — identity/privilege hardening (user update scoping, seed password).
4. **C5** — NumberSequence table (blocks the 409 race for every document type).
5. **C7, C8** — attachment permission matrix + upload filter + authenticated uploads; Tally SSRF/500s.
6. **H1–H9**, then **MEDIUM/LOW** as capacity allows.
