# UTech ERP — API Test Report

**Date:** 2026-10-17 · **Scope:** all 233 route handlers across 35 mounted routers
**Method:** supertest over the real Express app (`src/server.js`), with the Prisma client
replaced by a programmable stub (`backend/tests/helpers/fakePrisma.js`). See
`TEST_EXECUTION_REPORT.md` §2 for exactly what that does and does not cover.

```bash
cd backend && npx vitest run tests/api tests/security
```

---

## 1. Coverage summary

| Check | Endpoints | Result |
|---|---|---|
| Inventory completeness (parsed from the route files, not a hand-written list) | 233 | ✅ 233 discovered |
| Returns **401** with no bearer token | 230 protected | ✅ 230/230 |
| Public endpoints (intentionally unauthenticated) | 3 | ✅ enumerated, matches `PUBLIC_ROUTES` |
| Returns **403** for an authenticated caller with zero permissions | 218 gated | ✅ 218/218 |
| SUPERADMIN is not denied | all gated GETs | ✅ none returned 403 |
| Auth-only endpoints enumerated (no `requirePermission`) | 12 | ✅ exact list asserted |
| Server-side body validation on money-bearing writes | invoices, parties, items, sales-returns, purchase-returns | ✅ see §4 |
| Mass-assignment resistance | `POST /api/invoices` | ✅ forged `status`/`number`/`total`/`createdById`/`amountPaid` all rejected |
| Business-rule enforcement | invoices, dispatch, jobwork, sales returns, users, stock | ✅ 39 workflow tests |
| Frontend ↔ backend payload contract | sales-returns, purchase-returns | ✅ 9 tests (AUD-102 caught here) |

## 2. The three public endpoints

These are the only routes reachable without a token, and each is intentional:

| Endpoint | Purpose | Note |
|---|---|---|
| `POST /api/auth/login` | credential login | rate limited 50 req / 15 min; decoy bcrypt compare defeats timing enumeration |
| `POST /api/auth/otp/request` | request a one-time code | invalidates any outstanding code for the same email+purpose |
| `POST /api/auth/otp/verify` | redeem a code | 6-digit `crypto.randomInt`, 5 attempts then burned, timing-safe compare |

## 3. The twelve auth-only endpoints

Any authenticated user can reach these. Each was reviewed and is scoped correctly:

| Endpoint | Why it is auth-only | Scoping check |
|---|---|---|
| `GET /api/auth/me` | own profile | returns `req.user` only |
| `POST /api/auth/change-password` | own password | `where: { id: req.user.id }`; 8-char minimum enforced by zod |
| `GET /api/notifications` | own notifications | `where: { userId: req.user.id }` — asserted in test |
| `GET /api/notifications/unread-count` | own count | same |
| `POST /api/notifications/:id/read` | mark own as read | **404** if `n.userId !== req.user.id` — asserted (IDOR blocked) |
| `POST /api/notifications/read-all` | mark all own as read | `where: { userId: req.user.id }` — asserted |
| `GET /api/parties/lookup/ifsc/:code` | IFSC auto-fill | IFSC regex validated; fixed external host, no user-controlled URL |
| `GET /api/parties/lookup/gstin/:gstin` | GSTIN auto-fill | purely local derivation, no external call, no data returned |
| `POST /api/attachments/:refType/:refId` | upload | module permission resolved per `refType` + owner checks in the controller |
| `GET /api/attachments/:refType/:refId` | list | same |
| `GET /api/attachments/file/:id` | download | same; server-derived `Content-Type`, sanitised filename, `attachment` disposition |
| `DELETE /api/attachments/file/:id` | delete | same; refuses while an assignment on the file is still open |

## 4. Validation results

| Endpoint | Case | Status | Response |
|---|---|---|---|
| `POST /api/auth/login` | missing email | 400 | `ValidationError`, `details[].path = ['email']` |
| `POST /api/auth/login` | malformed email | 400 | `ValidationError` |
| `POST /api/auth/login` | password < 6 | 400 | `ValidationError`, `path = ['password']` |
| `POST /api/auth/login` | wrong credentials | 401 | `Invalid credentials` (not 400 — no account enumeration) |
| `POST /api/auth/login` | `  Admin@UTech.Local ` | — | normalised to `admin@utech.local` before lookup (asserted on the Prisma call) |
| `POST /api/auth/change-password` | newPassword < 8 | 400 | `ValidationError` |
| `POST /api/invoices` | empty `lines` | 400 | `ValidationError` |
| `POST /api/invoices` | `qty` 0 or −5 | 400 | `ValidationError` |
| `POST /api/invoices` | negative `rate` | 400 | `ValidationError` |
| `POST /api/invoices` | missing `partyId` | 400 | `ValidationError` |
| `POST /api/invoices` | unparseable `date` | 400 | `ValidationError` |
| `POST /api/invoices` | non-numeric `discount` | 400 | `ValidationError` |
| `POST /api/invoices` | unknown party | 400 | `Party not found` |
| `POST /api/invoices` | forged `status/number/total/cgst/sgst/createdById/amountPaid` | 201 | server values win; forged fields never reach `prisma.invoice.create` |
| `POST /api/parties` | invalid GSTIN / short name / unknown type / negative credit limit | 400 | `ValidationError` |
| `POST /api/items` | `gstRate` 500 / negative `saleRate` | 400 | `ValidationError` |
| `GET /api/invoices?page=abc&pageSize=999999&sortBy=;DROP` | junk query | 200 | `page=1`, `pageSize` clamped to 100, sort column rejected |
| `POST /api/sales-returns` | **no `lines` key** | **400** (was **500**) | AUD-102/AUD-013 fixed |
| `POST /api/sales-returns` | `qty: "not-a-number"` | **400** (was **201 + NaN**) | AUD-013 fixed |
| `POST /api/sales-returns` | empty `lines` | **400** (was **201**) | AUD-013 fixed |
| `POST /api/purchase-returns` | non-numeric `qty` | **400** (was 404/NaN) | AUD-013 fixed |
| `POST /api/purchase-returns` | neither `grnId` nor `poId` | 400 | `A purchase return requires a grnId or a poId…` |

## 5. Business-rule results

| Workflow | Case | Result |
|---|---|---|
| Invoice create | mixed GST rates 18% + 12% on 2×₹1,000 | subtotal 2000, CGST 150, SGST 150, IGST 0, roundOff 0, total 2300 |
| Invoice create | party ledger row written in the same transaction | ✅ |
| Invoice update | target is `CANCELLED` | 400, no `invoice.update` issued |
| Invoice update | target is `PAID` and lines/discount changed | 400, no `invoice.update` issued |
| Invoice delete | unpaid | soft-cancel: `status = CANCELLED` + ledger rows removed; **no** `invoice.delete` |
| Invoice delete | has payments | 400 `invoice has payments; use credit note` |
| Invoice payment | overpayment | 400 `Payment exceeds the invoice total`, no payment row created |
| Invoice payment | settles balance | `status = PAID`, `amountPaid = 1000` |
| Invoice payment | partial | `status = PARTIALLY_PAID` |
| Invoice payment | on a cancelled invoice | 400 |
| Dispatch create | 10 units | `item.updateMany` decrement 10 + `StockLedger{refType:'DISPATCH', qtyOut:10, ownerType:'COMPANY'}` |
| Dispatch create | more than on hand | 400 `Insufficient stock for Widget (available 3, needed 10)` |
| Dispatch cancel | | `StockLedger{refType:'DISPATCH_CANCEL', qtyIn:10}` + increment 10 — **regression net for the phantom-inventory-loss bug** |
| Dispatch cancel | already `DELIVERED` | 400, no stock movement |
| Dispatch cancel | already `CANCELLED` | 400, no stock movement (would have double-credited) |
| Dispatch status | unknown target status | 400 |
| Jobwork receive | within qty sent | 200, `qtyReceived`/`qtyRejected` persisted |
| Jobwork receive | received + rejected > qtySent | 400 `exceeds the qty sent`, no line update |
| Jobwork receive | line not on the challan | 400 `does not belong` |
| Jobwork receive | challan `CANCELLED` | 400, no stock movement |
| Jobwork receive | company line with `itemId: null` | 400 `no catalog item to receive stock against` (not a 500) |
| Sales return | within invoiced qty | 201 |
| Sales return | exceeds invoiced qty | 400 `exceeds the invoiced quantity` |
| Sales return | counts previously returned qty | 400 |
| Sales return | line from another invoice | 400 `does not belong to invoice` |
| User update | Department Head sets `roleId` | 403 `Only administrators can change: roleId`, no write |
| User update | Department Head sets `password` | 403 |
| User update | Department Head sets `isActive` | 403 |
| User update | target in another department | 403 `This user is not in your department` |
| User update | plain field, same department | 200, write issued |
| Stock adjust | +7 | increment 7, `StockLedger{refType:'ADJUSTMENT'}` |
| Stock adjust | −3 | conditional decrement 3 |
| Stock adjust | below zero | 400 `Insufficient stock` |
| Stock adjust | qty 0 | 400 |

## 6. Full endpoint inventory

Legend — **Body validated**: `zod` = a schema runs before the handler; `none` = a
POST/PUT/PATCH with no schema (see AUD-115); `—` = GET/DELETE, no body expected.

| # | Method | Endpoint | Auth | Permission(s) | Body validated | Handler |
|---|---|---|---|---|---|---|
| 1 | DELETE | `/api/assignments/:id` | yes | assignment.update | — | `ctrl.cancel` |
| 2 | GET | `/api/assignments` | yes | assignment.read | — | `ctrl.list` |
| 3 | GET | `/api/assignments/:id` | yes | assignment.read | — | `ctrl.get` |
| 4 | GET | `/api/assignments/:id/activity` | yes | assignment.read | — | `ctrl.activity` |
| 5 | GET | `/api/assignments/eligible-users` | yes | assignment.create | — | `ctrl.eligibleUsers` |
| 6 | GET | `/api/assignments/stats` | yes | assignment.read | — | `ctrl.stats` |
| 7 | POST | `/api/assignments` | yes | assignment.create | zod | `ctrl.create` |
| 8 | POST | `/api/assignments/:id/complete` | yes | assignment.update | zod | `ctrl.complete` |
| 9 | POST | `/api/assignments/:id/reopen` | yes | assignment.update | zod | `ctrl.reopen` |
| 10 | POST | `/api/assignments/:id/start` | yes | assignment.update | **none** | `ctrl.start` |
| 11 | DELETE | `/api/attachments/file/:id` | yes | _auth only_ | — | `ctrl.deleteOne` |
| 12 | GET | `/api/attachments/:refType/:refId` | yes | _auth only_ | — | `ctrl.listFor` |
| 13 | GET | `/api/attachments/file/:id` | yes | _auth only_ | — | `ctrl.downloadOne` |
| 14 | POST | `/api/attachments/:refType/:refId` | yes | _auth only_ | **none** | `ctrl.upload` |
| 15 | GET | `/api/auth/me` | yes | _auth only_ | — | `ctrl.me` |
| 16 | POST | `/api/auth/change-password` | yes | _auth only_ | zod | `ctrl.changePassword` |
| 17 | POST | `/api/auth/login` | **no** | _auth only_ | zod | `ctrl.login` |
| 18 | POST | `/api/auth/otp/request` | **no** | _auth only_ | zod | `ctrl.requestOtp` |
| 19 | POST | `/api/auth/otp/verify` | **no** | _auth only_ | zod | `ctrl.verifyOtp` |
| 20 | DELETE | `/api/back-orders/:id` | yes | invoice.delete | — | `ctrl.remove` |
| 21 | GET | `/api/back-orders` | yes | invoice.read | — | `ctrl.list` |
| 22 | GET | `/api/back-orders/:id` | yes | invoice.read | — | `ctrl.get` |
| 23 | POST | `/api/back-orders` | yes | invoice.create | zod | `ctrl.create` |
| 24 | POST | `/api/back-orders/:id/fulfill` | yes | invoice.update | zod | `ctrl.fulfill` |
| 25 | PUT | `/api/back-orders/:id` | yes | invoice.update | zod | `ctrl.update` |
| 26 | DELETE | `/api/boms/:id` | yes | item.delete | — | `ctrl.remove` |
| 27 | GET | `/api/boms` | yes | item.read | — | `ctrl.list` |
| 28 | GET | `/api/boms/:id` | yes | item.read | — | `ctrl.get` |
| 29 | POST | `/api/boms` | yes | item.create | zod | `ctrl.create` |
| 30 | PUT | `/api/boms/:id` | yes | item.update | zod | `ctrl.update` |
| 31 | GET | `/api/customer-material` | yes | customerMaterial.read | — | `ctrl.list` |
| 32 | GET | `/api/customer-material/:id` | yes | customerMaterial.read | — | `ctrl.get` |
| 33 | POST | `/api/customer-material` | yes | customerMaterial.create | zod | `ctrl.create` |
| 34 | POST | `/api/customer-material/:id/consume` | yes | customerMaterial.update | zod | `ctrl.consume` |
| 35 | POST | `/api/customer-material/:id/dispatch-to-customer` | yes | customerMaterial.update | zod | `ctrl.dispatchToCustomer` |
| 36 | POST | `/api/customer-material/:id/return-to-customer` | yes | customerMaterial.update | zod | `ctrl.returnToCustomer` |
| 37 | PUT | `/api/customer-material/:id` | yes | customerMaterial.update | zod | `ctrl.update` |
| 38 | GET | `/api/dashboard/sales-analytics` | yes | invoice.read | — | `ctrl.salesAnalytics` |
| 39 | GET | `/api/dashboard/summary` | yes | invoice.read | — | `ctrl.summary` |
| 40 | DELETE | `/api/department-subcategories/:id` | yes | departmentSubcategory.delete | — | `ctrl.remove` |
| 41 | GET | `/api/department-subcategories` | yes | departmentSubcategory.read | — | `ctrl.list` |
| 42 | GET | `/api/department-subcategories/:id` | yes | departmentSubcategory.read | — | `ctrl.get` |
| 43 | POST | `/api/department-subcategories` | yes | departmentSubcategory.create | zod | `ctrl.create` |
| 44 | PUT | `/api/department-subcategories/:id` | yes | departmentSubcategory.update | zod | `ctrl.update` |
| 45 | DELETE | `/api/departments/:id` | yes | department.delete | — | `ctrl.remove` |
| 46 | GET | `/api/departments` | yes | department.read | — | `ctrl.list` |
| 47 | GET | `/api/departments/:id` | yes | department.read | — | `ctrl.get` |
| 48 | POST | `/api/departments` | yes | department.create | zod | `ctrl.create` |
| 49 | PUT | `/api/departments/:id` | yes | department.update | zod | `ctrl.update` |
| 50 | GET | `/api/dispatch` | yes | dispatch.read | — | `ctrl.list` |
| 51 | GET | `/api/dispatch/:id` | yes | dispatch.read | — | `ctrl.get` |
| 52 | POST | `/api/dispatch` | yes | dispatch.create | zod | `ctrl.create` |
| 53 | POST | `/api/dispatch/:id/status/:status` | yes | dispatch.update | **none** | `ctrl.markStatus` |
| 54 | DELETE | `/api/expenses/:id` | yes | expense.delete | — | `ctrl.remove` |
| 55 | GET | `/api/expenses` | yes | expense.read | — | `ctrl.list` |
| 56 | GET | `/api/expenses/:id` | yes | expense.read | — | `ctrl.get` |
| 57 | GET | `/api/expenses/summary` | yes | expense.read | — | `ctrl.summary` |
| 58 | POST | `/api/expenses` | yes | expense.create | **none** | `ctrl.create` |
| 59 | PUT | `/api/expenses/:id` | yes | expense.update | **none** | `ctrl.update` |
| 60 | DELETE | `/api/grns/:id` | yes | grn.delete | zod | `ctrl.cancel` |
| 61 | GET | `/api/grns` | yes | grn.read | — | `ctrl.list` |
| 62 | GET | `/api/grns/:id` | yes | grn.read | — | `ctrl.get` |
| 63 | POST | `/api/grns` | yes | grn.create | zod | `ctrl.create` |
| 64 | PUT | `/api/grns/:id` | yes | grn.update | zod | `ctrl.update` |
| 65 | DELETE | `/api/invoices/:id` | yes | invoice.delete | — | `ctrl.remove` |
| 66 | GET | `/api/invoices` | yes | invoice.read | — | `ctrl.list` |
| 67 | GET | `/api/invoices/:id` | yes | invoice.read | — | `ctrl.get` |
| 68 | GET | `/api/invoices/:id/pdf` | yes | invoice.read | — | `ctrl.downloadPdf` |
| 69 | POST | `/api/invoices` | yes | invoice.create | zod | `ctrl.create` |
| 70 | POST | `/api/invoices/:id/payments` | yes | invoice.update | zod | `ctrl.addPayment` |
| 71 | PUT | `/api/invoices/:id` | yes | invoice.update | zod | `ctrl.update` |
| 72 | DELETE | `/api/items/:id` | yes | item.delete | — | `ctrl.remove` |
| 73 | GET | `/api/items` | yes | item.read | — | `ctrl.list` |
| 74 | GET | `/api/items/:id` | yes | item.read | — | `ctrl.get` |
| 75 | GET | `/api/items/:id/stock` | yes | item.read | — | `ctrl.stockHistory` |
| 76 | GET | `/api/items/lookups` | yes | item.read | — | `ctrl.lookupUomAndCategory` |
| 77 | POST | `/api/items` | yes | item.create | zod | `ctrl.create` |
| 78 | PUT | `/api/items/:id` | yes | item.update | zod | `ctrl.update` |
| 79 | DELETE | `/api/jobcards/:id` | yes | jobcard.delete | — | `ctrl.remove` |
| 80 | GET | `/api/jobcards` | yes | jobcard.read | — | `ctrl.list` |
| 81 | GET | `/api/jobcards/:id` | yes | jobcard.read | — | `ctrl.get` |
| 82 | GET | `/api/jobcards/:id/activity` | yes | jobcard.read | — | `ctrl.activity` |
| 83 | GET | `/api/jobcards/:id/notes` | yes | jobcard.read | — | `ctrl.listNotes` |
| 84 | PATCH | `/api/jobcards/:id/progress` | yes | jobcard.progress | zod | `ctrl.updateProgress` |
| 85 | POST | `/api/jobcards` | yes | jobcard.create | zod | `ctrl.create` |
| 86 | POST | `/api/jobcards/:id/complete` | yes | jobcard.progress | **none** | `ctrl.complete` |
| 87 | POST | `/api/jobcards/:id/notes` | yes | jobcard.read | zod | `ctrl.addNote` |
| 88 | POST | `/api/jobcards/:id/revert` | yes | jobcard.update | zod | `ctrl.revert` |
| 89 | PUT | `/api/jobcards/:id` | yes | jobcard.update | zod | `ctrl.update` |
| 90 | DELETE | `/api/jobwork/:id` | yes | jobwork.delete | — | `ctrl.remove` |
| 91 | GET | `/api/jobwork` | yes | jobwork.read | — | `ctrl.list` |
| 92 | GET | `/api/jobwork/:id` | yes | jobwork.read | — | `ctrl.get` |
| 93 | POST | `/api/jobwork` | yes | jobwork.create | zod | `ctrl.create` |
| 94 | POST | `/api/jobwork/:id/receive` | yes | jobwork.update | zod | `ctrl.receive` |
| 95 | DELETE | `/api/machines/:id` | yes | machine.delete | — | `ctrl.remove` |
| 96 | GET | `/api/machines` | yes | machine.read | — | `ctrl.list` |
| 97 | GET | `/api/machines/:id` | yes | machine.read | — | `ctrl.get` |
| 98 | POST | `/api/machines` | yes | machine.create | **none** | `ctrl.create` |
| 99 | PUT | `/api/machines/:id` | yes | machine.update | **none** | `ctrl.update` |
| 100 | GET | `/api/notifications` | yes | _auth only_ | — | `ctrl.list` |
| 101 | GET | `/api/notifications/unread-count` | yes | _auth only_ | — | `ctrl.unreadCount` |
| 102 | POST | `/api/notifications/:id/read` | yes | _auth only_ | **none** | `ctrl.markRead` |
| 103 | POST | `/api/notifications/read-all` | yes | _auth only_ | **none** | `ctrl.markAllRead` |
| 104 | DELETE | `/api/parties/:id` | yes | customerParty.delete | vendorParty.delete | — | `ctrl.remove` |
| 105 | GET | `/api/parties` | yes | customerParty.read | vendorParty.read | — | `ctrl.list` |
| 106 | GET | `/api/parties/:id` | yes | customerParty.read | vendorParty.read | — | `ctrl.get` |
| 107 | GET | `/api/parties/:id/ledger` | yes | customerParty.read | vendorParty.read | — | `ctrl.ledger` |
| 108 | GET | `/api/parties/lookup/gstin/:gstin` | yes | _auth only_ | — | `ctrl.gstinLookup` |
| 109 | GET | `/api/parties/lookup/ifsc/:code` | yes | _auth only_ | — | `ctrl.ifscLookup` |
| 110 | POST | `/api/parties` | yes | customerParty.create | vendorParty.create | zod | `ctrl.create` |
| 111 | PUT | `/api/parties/:id` | yes | customerParty.update | vendorParty.update | zod | `ctrl.update` |
| 112 | DELETE | `/api/processes/:id` | yes | process.delete | — | `ctrl.remove` |
| 113 | GET | `/api/processes` | yes | process.read | — | `ctrl.list` |
| 114 | GET | `/api/processes/:id` | yes | process.read | — | `ctrl.get` |
| 115 | POST | `/api/processes` | yes | process.create | zod | `ctrl.create` |
| 116 | PUT | `/api/processes/:id` | yes | process.update | zod | `ctrl.update` |
| 117 | DELETE | `/api/production/batches/:id` | yes | jobcard.delete | — | `ctrl.cancelBatch` |
| 118 | GET | `/api/production/batches` | yes | jobcard.read | — | `ctrl.listBatches` |
| 119 | GET | `/api/production/batches/:id` | yes | jobcard.read | — | `ctrl.getBatch` |
| 120 | GET | `/api/production/shifts` | yes | jobcard.read | — | `ctrl.listShifts` |
| 121 | POST | `/api/production/batches` | yes | jobcard.create | zod | `ctrl.createBatch` |
| 122 | POST | `/api/production/batches/:id/complete` | yes | jobcard.update | zod | `ctrl.completeBatch` |
| 123 | POST | `/api/production/batches/:id/materials` | yes | jobcard.update | zod | `ctrl.updateMaterialConsumption` |
| 124 | POST | `/api/production/batches/:id/start` | yes | jobcard.update | **none** | `ctrl.startBatch` |
| 125 | POST | `/api/production/shifts` | yes | jobcard.create | zod | `ctrl.createShift` |
| 126 | PUT | `/api/production/batches/:id` | yes | jobcard.update | zod | `ctrl.updateBatch` |
| 127 | PUT | `/api/production/shifts/:id` | yes | jobcard.update | zod | `ctrl.updateShift` |
| 128 | DELETE | `/api/projects/:id` | yes | project.delete | — | `ctrl.remove` |
| 129 | DELETE | `/api/projects/:id/items/:itemId` | yes | project.update | — | `ctrl.removeItem` |
| 130 | DELETE | `/api/projects/:id/tasks/:taskId` | yes | project.update | — | `ctrl.deleteTask` |
| 131 | GET | `/api/projects` | yes | project.read | — | `ctrl.list` |
| 132 | GET | `/api/projects/:id` | yes | project.read | — | `ctrl.get` |
| 133 | GET | `/api/projects/:id/items` | yes | project.read | — | `ctrl.listItems` |
| 134 | GET | `/api/projects/:id/tasks` | yes | project.read | — | `ctrl.listTasks` |
| 135 | POST | `/api/projects` | yes | project.create | **none** | `ctrl.create` |
| 136 | POST | `/api/projects/:id/items` | yes | project.update | **none** | `ctrl.addItem` |
| 137 | POST | `/api/projects/:id/tasks` | yes | project.update | **none** | `ctrl.createTask` |
| 138 | PUT | `/api/projects/:id` | yes | project.update | **none** | `ctrl.update` |
| 139 | PUT | `/api/projects/:id/tasks/:taskId` | yes | project.update | **none** | `ctrl.updateTask` |
| 140 | DELETE | `/api/purchase-orders/:id` | yes | purchase.delete | zod | `ctrl.cancel` |
| 141 | GET | `/api/purchase-orders` | yes | purchase.read | — | `ctrl.list` |
| 142 | GET | `/api/purchase-orders/:id` | yes | purchase.read | — | `ctrl.get` |
| 143 | POST | `/api/purchase-orders` | yes | purchase.create | zod | `ctrl.create` |
| 144 | POST | `/api/purchase-orders/:id/approve` | yes | purchase.update | **none** | `ctrl.approve` |
| 145 | POST | `/api/purchase-orders/:id/reject` | yes | purchase.update | zod | `ctrl.reject` |
| 146 | PUT | `/api/purchase-orders/:id` | yes | purchase.update | zod | `ctrl.update` |
| 147 | DELETE | `/api/purchase-returns/:id` | yes | purchase.delete | — | `ctrl.remove` |
| 148 | GET | `/api/purchase-returns` | yes | purchase.read | — | `ctrl.list` |
| 149 | GET | `/api/purchase-returns/:id` | yes | purchase.read | — | `ctrl.get` |
| 150 | POST | `/api/purchase-returns` | yes | purchase.create | **none** | `ctrl.create` |
| 151 | POST | `/api/purchase-returns/:id/approve` | yes | purchase.update | **none** | `ctrl.approve` |
| 152 | POST | `/api/purchase-returns/:id/process` | yes | purchase.update | **none** | `ctrl.process` |
| 153 | PUT | `/api/purchase-returns/:id` | yes | purchase.update | **none** | `ctrl.update` |
| 154 | DELETE | `/api/quality/:id` | yes | quality.delete | — | `ctrl.remove` |
| 155 | GET | `/api/quality` | yes | quality.read | — | `ctrl.list` |
| 156 | GET | `/api/quality/:id` | yes | quality.read | — | `ctrl.get` |
| 157 | POST | `/api/quality` | yes | quality.create | zod | `ctrl.create` |
| 158 | PUT | `/api/quality/:id` | yes | quality.update | zod | `ctrl.update` |
| 159 | DELETE | `/api/quotation-templates/:id` | yes | customerQuotation.delete | vendorQuotation.delete | — | `ctrl.remove` |
| 160 | GET | `/api/quotation-templates` | yes | customerQuotation.read | vendorQuotation.read | — | `ctrl.list` |
| 161 | GET | `/api/quotation-templates/image/:storedName` | yes | customerQuotation.read | vendorQuotation.read | — | `ctrl.serveImage` |
| 162 | POST | `/api/quotation-templates` | yes | customerQuotation.create | vendorQuotation.create | zod | `ctrl.create` |
| 163 | POST | `/api/quotation-templates/upload-image` | yes | customerQuotation.update | vendorQuotation.update | customerQuotation.create | vendorQuotation.create | **none** | `ctrl.upload` |
| 164 | PUT | `/api/quotation-templates/:id` | yes | customerQuotation.update | vendorQuotation.update | zod | `ctrl.update` |
| 165 | DELETE | `/api/quotations/:id` | yes | customerQuotation.delete | vendorQuotation.delete | — | `ctrl.remove` |
| 166 | GET | `/api/quotations` | yes | customerQuotation.read | vendorQuotation.read | — | `ctrl.list` |
| 167 | GET | `/api/quotations/:id` | yes | customerQuotation.read | vendorQuotation.read | — | `ctrl.get` |
| 168 | POST | `/api/quotations` | yes | customerQuotation.create | vendorQuotation.create | zod | `ctrl.create` |
| 169 | POST | `/api/quotations/:id/convert` | yes | customerQuotation.update | vendorQuotation.update | **none** | `ctrl.convertToInvoice` |
| 170 | PUT | `/api/quotations/:id` | yes | customerQuotation.update | vendorQuotation.update | zod | `ctrl.update` |
| 171 | GET | `/api/reports/customer-stock.xlsx` | yes | report.read | — | `ctrl.customerStock` |
| 172 | GET | `/api/reports/expenses.xlsx` | yes | report.read | — | `ctrl.expenses` |
| 173 | GET | `/api/reports/invoices.xlsx` | yes | report.read | — | `ctrl.invoices` |
| 174 | GET | `/api/reports/items.xlsx` | yes | report.read | — | `ctrl.items` |
| 175 | GET | `/api/reports/jobcards.xlsx` | yes | report.read | — | `ctrl.jobcards` |
| 176 | GET | `/api/reports/party-ledger/:partyId.xlsx` | yes | report.read | — | `ctrl.partyLedger` |
| 177 | GET | `/api/reports/stock-ledger.xlsx` | yes | report.read | — | `ctrl.stockLedgerReport` |
| 178 | GET | `/api/reports/vendor-stock.xlsx` | yes | report.read | — | `ctrl.vendorStock` |
| 179 | DELETE | `/api/roles/:id` | yes | role.delete | — | `ctrl.remove` |
| 180 | GET | `/api/roles` | yes | role.read | — | `ctrl.list` |
| 181 | GET | `/api/roles/:id` | yes | role.read | — | `ctrl.get` |
| 182 | GET | `/api/roles/permissions/all` | yes | role.read | — | `ctrl.listPermissions` |
| 183 | POST | `/api/roles` | yes | role.create | zod | `ctrl.create` |
| 184 | PUT | `/api/roles/:id` | yes | role.update | zod | `ctrl.update` |
| 185 | DELETE | `/api/sales-returns/:id` | yes | invoice.delete | — | `ctrl.remove` |
| 186 | GET | `/api/sales-returns` | yes | invoice.read | — | `ctrl.list` |
| 187 | GET | `/api/sales-returns/:id` | yes | invoice.read | — | `ctrl.get` |
| 188 | POST | `/api/sales-returns` | yes | invoice.create | **none** | `ctrl.create` |
| 189 | POST | `/api/sales-returns/:id/approve` | yes | invoice.update | **none** | `ctrl.approve` |
| 190 | POST | `/api/sales-returns/:id/process` | yes | invoice.update | **none** | `ctrl.process` |
| 191 | PUT | `/api/sales-returns/:id` | yes | invoice.update | **none** | `ctrl.update` |
| 192 | GET | `/api/stock/ledger` | yes | stock.read | — | `ctrl.ledger` |
| 193 | GET | `/api/stock/summary` | yes | stock.read | — | `ctrl.summary` |
| 194 | POST | `/api/stock/adjust` | yes | stock.adjust | zod | `ctrl.adjust` |
| 195 | GET | `/api/tally/export/masters` | yes | report.read | — | `ctrl.exportMasters` |
| 196 | GET | `/api/tally/export/vouchers` | yes | report.read | — | `ctrl.exportVouchers` |
| 197 | GET | `/api/tally/versions` | yes | report.read | — | `ctrl.getVersions` |
| 198 | POST | `/api/tally/sync` | yes | report.update | **none** | `ctrl.syncToTally` |
| 199 | DELETE | `/api/tasks/:id` | yes | task.delete | — | `ctrl.remove` |
| 200 | GET | `/api/tasks` | yes | task.read | task.progress | — | `ctrl.list` |
| 201 | GET | `/api/tasks/:id` | yes | task.read | task.progress | — | `ctrl.get` |
| 202 | GET | `/api/tasks/:id/activity` | yes | task.read | task.progress | — | `ctrl.activity` |
| 203 | GET | `/api/tasks/:id/notes` | yes | task.read | task.progress | — | `ctrl.listNotes` |
| 204 | GET | `/api/tasks/dashboard` | yes | task.read | task.create | — | `ctrl.dashboard` |
| 205 | GET | `/api/tasks/workload` | yes | task.read | task.create | — | `ctrl.workload` |
| 206 | PATCH | `/api/tasks/:id/my-completion` | yes | task.progress | task.update | zod | `ctrl.setMyCompletion` |
| 207 | PATCH | `/api/tasks/:id/progress` | yes | task.update | task.progress | zod | `ctrl.setProgress` |
| 208 | PATCH | `/api/tasks/:id/status` | yes | task.update | task.progress | zod | `ctrl.setStatus` |
| 209 | POST | `/api/tasks` | yes | task.create | zod | `ctrl.create` |
| 210 | POST | `/api/tasks/:id/assign` | yes | task.update | task.create | zod | `ctrl.assign` |
| 211 | POST | `/api/tasks/:id/notes` | yes | task.update | task.progress | zod | `ctrl.addNote` |
| 212 | POST | `/api/tasks/:id/rework` | yes | task.update | task.create | zod | `ctrl.rework` |
| 213 | POST | `/api/tasks/bulk` | yes | task.create | zod | `ctrl.createBulk` |
| 214 | PUT | `/api/tasks/:id` | yes | task.update | zod | `ctrl.update` |
| 215 | DELETE | `/api/users/:id` | yes | user.delete | — | `ctrl.remove` |
| 216 | GET | `/api/users` | yes | user.read | — | `ctrl.list` |
| 217 | GET | `/api/users/:id` | yes | user.read | — | `ctrl.get` |
| 218 | GET | `/api/users/:id/permissions` | yes | user.update | — | `ctrl.listPermissions` |
| 219 | GET | `/api/users/reporting-candidates` | yes | user.read | — | `ctrl.reportingCandidates` |
| 220 | POST | `/api/users` | yes | user.create | zod | `ctrl.create` |
| 221 | PUT | `/api/users/:id` | yes | user.update | zod | `ctrl.update` |
| 222 | PUT | `/api/users/:id/permissions` | yes | user.update | zod | `ctrl.setPermissions` |
| 223 | DELETE | `/api/vendor-work-orders/:id` | yes | vendorWorkOrder.update | zod | `ctrl.cancel` |
| 224 | GET | `/api/vendor-work-orders` | yes | vendorWorkOrder.read | — | `ctrl.list` |
| 225 | GET | `/api/vendor-work-orders/:id` | yes | vendorWorkOrder.read | — | `ctrl.get` |
| 226 | GET | `/api/vendor-work-orders/:id/activity` | yes | vendorWorkOrder.read | — | `ctrl.activity` |
| 227 | GET | `/api/vendor-work-orders/stats` | yes | vendorWorkOrder.read | — | `ctrl.stats` |
| 228 | POST | `/api/vendor-work-orders` | yes | vendorWorkOrder.create | zod | `ctrl.create` |
| 229 | POST | `/api/vendor-work-orders/:id/purchase-order` | yes | purchase.create | vendorWorkOrder.update | zod | `ctrl.raisePurchaseOrder` |
| 230 | POST | `/api/vendor-work-orders/:id/receive` | yes | vendorWorkOrder.update | zod | `ctrl.receive` |
| 231 | POST | `/api/vendor-work-orders/:id/send` | yes | vendorWorkOrder.update | zod | `ctrl.send` |
| 232 | POST | `/api/vendor-work-orders/:id/short-close` | yes | vendorWorkOrder.update | zod | `ctrl.shortClose` |
| 233 | PUT | `/api/vendor-work-orders/:id` | yes | vendorWorkOrder.update | zod | `ctrl.update` |