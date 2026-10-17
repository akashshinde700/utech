# UTech ERP — Feature Inventory

**Generated:** 2026-10-17 from source inspection (route files parsed mechanically, not
hand-copied). Status legend:

- **FULL** — backend + frontend both present and wired
- **PARTIAL** — one side missing, or wired but with a confirmed defect
- **BACKEND-ONLY** — API exists, no UI reaches it
- **DEAD** — code present but unreachable

---

## 1. Module matrix

| Module | Backend routes | Frontend routes | Status | Notes |
|---|---|---|---|---|
| Auth (login, OTP, change password) | `/api/auth` (5) | `/login` | FULL | OTP is a scaffold — codes are logged, not emailed |
| Users | `/api/users` (8) | `/users` | FULL | privilege guards verified by test |
| Roles + permission matrix | `/api/roles` (6) | `/roles` | FULL | per-user overrides supported |
| Departments | `/api/departments` (4) | `/departments` | FULL | |
| Department sub-categories | `/api/department-subcategories` (4) | `/department-subcategories` | FULL | |
| Parties (customers / vendors / both) | `/api/parties` (8) | `/parties`, `/parties/new`, `/parties/:id` | FULL | GSTIN derivation, IFSC lookup, ledger |
| Items + UoM + category | `/api/items` (7) | `/items`, `/items/new`, `/items/:id` | FULL | |
| Machines | `/api/machines` (5) | `/machines`, `/machines/new`, `/machines/:id` | FULL | delete = retire |
| Processes | `/api/processes` (5) | `/processes` | FULL | |
| Quotations (customer + vendor) | `/api/quotations` (7) | `/quotations`, `/quotations/new`, `/quotations/:id`, `/quotations/:id/edit` | FULL | convert-to-invoice |
| Quotation templates | `/api/quotation-templates` (5) | — | **BACKEND-ONLY** | header/footer image upload; no UI |
| Invoices + payments + PDF | `/api/invoices` (7) | `/invoices`, `/invoices/new`, `/invoices/:id`, `/invoices/:id/edit` | FULL | pdfkit |
| Sales returns | `/api/sales-returns` (7) | `/sales-returns`, `/sales-returns/new`, `/sales-returns/:id` | **PARTIAL → FIXED** | AUD-102: create was 100 % broken; AUD-013: no validation |
| Purchase returns | `/api/purchase-returns` (7) | `/purchase-returns`, `/purchase-returns/new`, `/purchase-returns/:id` | **PARTIAL → FIXED** | AUD-013 |
| Back orders | `/api/back-orders` (6) | `/back-orders`, `/back-orders/new`, `/back-orders/:id` | FULL | |
| Jobcards (lines, operations, notes, reverts) | `/api/jobcards` (13) | `/jobcards`, `/jobcards/new`, `/jobcards/:id`, `/jobcards/:id/edit` | FULL | |
| Task progress (multi-assignee, approval) | `/api/tasks` (15) | `/tasks`, `/my-tasks` | **PARTIAL → FIXED** | AUD-101: unreachable for the roles that use it most |
| Assignments (drawing hand-off) | `/api/assignments` (9) | `/assignments` | FULL | |
| Jobwork challans (vendor dispatch) | `/api/jobwork` (5) | `/jobwork`, `/jobwork/new` | FULL | auto stock OUT/IN |
| Vendor work orders | `/api/vendor-work-orders` (10) | `/vendor-work-orders` (+new/view/edit) | FULL | was dead code in the 2026-09 audit; now routed |
| Dispatch challans | `/api/dispatch` (4) | `/dispatch`, `/dispatch/new` | FULL | cancel restores stock (regression-tested) |
| Purchase orders | `/api/purchase-orders` (6) | `/purchase-orders` (+new/view) | FULL | approve/reject |
| GRN | `/api/grns` (5) | `/grns`, `/grns/new`, `/grns/:id` | FULL | auto stock IN |
| Quality inspection | `/api/quality` (5) | `/quality` | FULL | |
| Projects | `/api/projects` (8) | `/projects`, `/projects/:id` | FULL | BOM stepwise still absent |
| BOMs | `/api/boms` (5) | `/boms`, `/boms/new`, `/boms/:id` | **PARTIAL → FIXED** | AUD-104: nav permission mismatch |
| Expenses | `/api/expenses` (6) | `/expenses` | FULL | |
| Customer material (lots) | `/api/customer-material` (7) | `/customer-material` (+new/view) | FULL | separate ledger, never touches `Item.currentStock` |
| Stock overview + ledger + adjust | `/api/stock` (3) | `/stock` | FULL | |
| Production batches + shifts | `/api/production` (9) | `/production/batches` (+new/edit), `/production/shifts` | FULL | |
| Attachments | `/api/attachments` (4) | inline in jobcards/tasks/assignments | FULL | 100/record cap |
| Notifications | `/api/notifications` (4) | `NotificationBell` | **PARTIAL → FIXED** | AUD-105 sibling |
| Reports (XLSX) | `/api/reports` (8) | `/reports` | FULL | unbounded exports — AUD-107 |
| Analytics | `/api/dashboard` (2+) | `/analytics/sales`, `/analytics/production`, `/analytics/inventory` | FULL | |
| Tally export / sync | `/api/tally` (4) | — | **BACKEND-ONLY** | SSRF-guarded; no UI |

**Totals:** 35 routers, 233 route handlers, 77 frontend `<Route>` declarations.

---

## 2. Feature gaps the product still has

Confirmed by inspecting source, not inferred from the README:

| Gap | Evidence |
|---|---|
| **Email sending** | `nodemailer` is a dependency and `SMTP_*` vars exist in `config/env.js`, but `auth.controller.requestOtp` only `console.log`s the code with a `TODO: integrate nodemailer`. Password reset by email therefore does not exist end-to-end. |
| **OTP purpose `reset` is unusable** | `otpRequestSchema` accepts `'reset'`, but `verifyOtp` only issues a token for `purpose === 'login'`; there is no endpoint that consumes a `reset` code to set a new password. |
| **Refresh tokens** | `REFRESH_EXPIRES_IN` is read into `config/env.js` and never used. Tokens simply expire; there is no rotation or revocation. |
| **BOM stepwise / project budget** | `Bom`, `BomItem` models and `Project.budget` exist; no stepwise production workflow drives them. |
| **Tally UI** | `/api/tally/*` is complete but no page links to it. |
| **Quotation template UI** | `/api/quotation-templates/*` including image upload; no page links to it. |
| **Batch/shift-wise production reports** | `ProductionBatch` + `Shift` models exist; reports cover invoices, jobcards, items, expenses, ledgers and stock only. |

## 3. Dead code found

| Item | Where | Disposition |
|---|---|---|
| `allItems` state, `removeItem()` | `frontend/src/pages/salesReturns/SalesReturnForm.jsx` | flagged by ESLint as unused; the item picker was replaced by invoice-line loading. Safe to delete. |
| `validate` import with no call | `backend/src/routes/salesReturn.routes.js`, `purchaseReturn.routes.js` | **fixed** — schemas now wired (AUD-013) |
| 16 seeded permission keys never enforced | `backend/prisma/seed.js` | AUD-113 — see `SECURITY_AUDIT.md` §5 |

## 4. Reachability

Every `.jsx` file under `frontend/src` was checked for inbound imports: **zero orphans**.
The Vendor Work Orders module that the September audit reported as unreachable (six
component files, no route, no nav entry) is now routed and in the sidebar.

Every frontend route in `App.jsx` has a matching sidebar entry **or** is a
detail/edit child route reached from its list page — except the three that AUD-101
covered, which are now fixed and covered by a regression test.
