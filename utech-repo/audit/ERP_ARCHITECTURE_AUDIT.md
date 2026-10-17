# ERP_ARCHITECTURE_AUDIT.md — U-Tech Automation Industries ERP

**Audit date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech` (base `1be9215`, after PR #1 audit merge)
**Scope:** full monorepo — `backend/` (Express 4 + Prisma 5 + MySQL), `frontend/` (React 18 + Vite 5 + Tailwind 3)

---

## 1. Stack and structure

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | React 18.3 + Vite 5, React Router v6 (77 `<Route>` declarations), Zustand (auth store), Axios, Tailwind 3 | `frontend/package.json`, `frontend/src/App.jsx` |
| Backend | Node ≥18, Express 4, Zod validation middleware, JWT auth, bcryptjs | `backend/package.json`, `src/server.js` |
| Database | MySQL 8 via Prisma 5 — 60 models, 20 enums, 36 hand-written SQL migrations | `backend/prisma/schema.prisma`, `prisma/migrations/` |
| AuthN/AuthZ | JWT bearer; dynamic Role/Permission matrix (`<module>.<action>` keys) with SUPERADMIN bypass | `src/middleware/auth.js`, `prisma/seed.js` |
| Files | Local disk under `UPLOAD_DIR`, multer with uuid stored names + fileFilter | `src/controllers/attachment.controller.js` |
| Money | `Decimal(14,2)`; server-side GST engine (`utils/gst.js`) — client totals always recomputed | `utils/gst.js`, `invoice.controller.js` |
| Stock | Single write path: `services/stockService.js` writes `Item.currentStock` **and** a `StockLedger` row in the same transaction | `services/stockService.js` |

## 2. Module inventory (discovered from the repository)

| Module | Pages (frontend) | API mount | Main entities | Business rules (verified) | Test status |
|---|---|---|---|---|---|
| Auth + Users + Roles | Login, Users, Roles | `/api/auth`, `/api/users`, `/api/roles` | User, Role, Permission, Otp | JWT, permission matrix, user-admin privilege guards | auth matrix suite: 548 tests PASS |
| Parties (customer/vendor) | PartiesPage, PartyForm | `/api/parties` | Party, PartyLedger | GSTIN/PAN, opening balance, ledger mirror | covered via invoice tests |
| Items + stock | ItemsPage, StockManagementPage | `/api/items`, `/api/stock` | Item, StockLedger | conditional decrement (no silent oversell), manual adjustments validated | inventoryReconciliation PASS |
| Customer material (inward) | CustomerMaterial 3 pages | `/api/customer-material` | CustomerMaterialLot | immutable original qty; available = Σledger; lot/company stock never mix | AUD-206 + reconciliation PASS |
| Jobcards ("Projects") | Jobcards 3 pages | `/api/jobcards` | Jobcard, JobcardLine, JobcardOperation | operations = Task Progress items (owned by `/api/tasks`); edit must not wipe them | AUD-201 PASS |
| Tasks / assignments | Tasks, MyTasks, Assignments | `/api/tasks`, `/api/assignments` | JobcardOperation, Assignment | department-scoped access, approval gate, rework links | unit + nav contract PASS |
| Jobwork (vendor challan) | Jobwork 2 pages | `/api/jobwork` | JobworkChallan, JobworkLine | over-receive capped at qtySent; cancel reverses outstanding; rejected material restored (AUD-206) | workflows + AUD-206 PASS |
| Vendor work orders | VWO 3 pages | `/api/vendor-work-orders` | VendorWorkOrder(+Lines) | status recomputed from lines; GRN deltas reversible | workflow tests PASS |
| Purchasing | PO 3 pages, GRN 3 pages | `/api/purchase-orders`, `/api/grns` | PurchaseOrder, Grn, GrnLine | PO status rollup; GRN cancel reverses stock and PO received qty | workflows PASS |
| Purchase returns | PR 2 pages | `/api/purchase-returns` | PurchaseReturn(+Lines) | over-return capped vs accepted qty (AUD-202); null-item lines skip stock (AUD-203) | regressionDefects PASS |
| Sales + invoicing | Invoices 3 pages | `/api/invoices` | Invoice, InvoiceLine, InvoicePayment | server-computed GST; overpayment rejected; party ledger mirrored | money-and-tax + billing PASS |
| Sales returns | SR 2 pages | `/api/sales-returns` | SalesReturn(+Lines) | over-return capped (AUD-202); discount-before-tax (AUD-204) | regressionDefects PASS |
| Dispatch | Dispatch 2 pages | `/api/dispatch` | DispatchChallan(+Lines) | stock OUT at creation; cancel restores stock once | workflows PASS |
| Production | Production 3 pages | `/api/production` | ProductionBatch, ProductionMaterial, Shift | completion moves FG in + materials out; quantities validated | validation suite PASS |
| Quotations | Quotations 3 pages | `/api/quotations` | Quotation(+Lines) | convert-to-invoice | uiContract coverage partial |
| BOM / quality / expenses / projects | respective pages | `/api/boms`, `/api/quality`, `/api/expenses`, `/api/projects` | Bom, QualityCheck, Expense, Project/Task | CRUD + links | smoke/validation PASS |
| Reports / dashboard / tally | ReportsPage, Dashboard, analytics | `/api/reports`, `/api/dashboard`, `/api/tally` | — | XLSX exports (unbounded — AUD-107 open) | smoke PASS |

## 3. Data-flow trace (representative)

UI form → axios (`lib/api.js`) → Express route (`requireAuth` → `requirePermission` → `validate(zod)`) → controller → `prisma.$transaction` → `stockService.moveCompanyStock` / `moveCustomerMaterial` (for stock) → MySQL → response → UI reload. Money is always recomputed in the controller; stock is only ever written through `stockService`; document numbers come from an atomic `NumberSequence` allocation (`utils/numbering.js`).

## 4. Findings from this architecture pass

| ID | Sev | Finding | Status |
|---|---|---|---|
| AUD-201 | P1 | `JobcardForm` sent `operations: []` on every save; the jobcard update treats a sent array as replace-all → **every edit deleted all Task Progress items** (JobcardOperation + cascading assignees/comments) on the jobcard | **FIXED** + regression tests |
| AUD-207 | P2 | `SearchableSelect` claimed its Escape handler shielded a surrounding Modal, but both listened on `document` (same node — `stopPropagation` cannot stop same-node listeners, and the Modal's handler ran first). One Escape closed the dropdown **and** the modal, discarding unsaved form input | **FIXED** + regression tests |

Duplicate logic observed and left alone (working): the InvoiceForm totals memo intentionally mirrors `utils/gst.js` (parity documented in code comments); `numberToWords` has a dedicated frontend↔backend parity suite.

## 5. Not changed (per audit rules)

No schema, migration, API contract, print layout, or deployment configuration was changed. The one intentional API-semantics clarification: nothing — `jobcard.update`'s explicit `operations` replace semantics are preserved and pinned by test; the fix was on the form payload side.
