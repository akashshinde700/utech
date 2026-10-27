# Manufacturing ERP release audit — 27 October 2026

## Verdict: NOT READY for production

The changes address reproduced integrity and authorization defects, and the automated suites below pass in mock or disposable in-memory environments. That is **not** proof of a safe production release. The additive MySQL migration, normal engine-backed Prisma generation, foreign keys, row locks, transaction isolation and concurrent writers were not exercised against a real MySQL server. Production configuration, historical data, backup/restore, access controls, document storage and actual business sign-off also remain unverified. No production database or business data was accessed or changed.

This report describes the checked-out repository, not a certification of every ERP module, tax rule, legal requirement, visual print layout or production workload. Existing audit documents were used as context, not as evidence that current behavior passed.

## Architecture and actual workflows

- The React/Vite client calls `/api` using Axios; Express routes apply JWT authentication, permission checks and Zod validation, then controllers and services use Prisma against MySQL. The test/demo adapter is in-memory and is not InnoDB. PDF invoices are server-generated; the invoice report is XLSX.
- **Customer material:** the inward form posts a customer lot; the API creates the lot and initial customer `StockLedger` entry in a transaction. Lot detail derives on-hand quantity from ledger movements and subtracts active `CustomerMaterialAllocation` reservations. The new `currentWeight` is an explicit on-hand measurement, separate from original inward `weight`. Allocation is a reservation, not a physical movement. Customer-owned jobwork issue, receipt and disposition write their own ledger movements. Company stock remains separate.
- **Job cards and drawings:** job-card changes use a database transaction; document uploads are separate HTTP/file-system operations. The form now reports this distinction if a later upload fails. Assignment creation/reopening and completion coordinate through the card lock. A job card with an active reservation cannot be completed, cancelled or reassigned to a different customer until release.
- **Vendor outsourcing:** vendor work orders can be sent, received directly or linked to a purchase order and GRN. The GRN and work-order counters are validated against their parent order and updated in transaction scope.
- **Billing:** invoices use generic `qty × rate` lines; per-piece, per-kg and lot charges are descriptions and entered quantities/rates, **not** separate structured charge types or automatic unit-conversion formulas. Line amounts are decimal half-up to paise. The existing invoice policy applies the flat discount proportionally before GST, rounds aggregate GST, and rounds the grand total to the nearest rupee. Quotes in the current UI are without GST. Approved quotation conversion carries its saved values into the invoice and receivable.

## Confirmed findings and changes

Severity is the potential impact of the pre-fix defect or missing capability; a passing test is evidence for the named case, not for a real database deployment. Paths below are relative to `utech-repo/`.

### MFG-01 — Critical: no auditable split allocation of an inward lot

- **Reproduce:** create one 100-unit, 50-weight inward and try to assign different portions to two job cards. The previous lot had one optional `jobcardId` reference and no quantity/weight reservation per card, so remaining unallocated material could not be represented accurately.
- **Root cause:** a reference was used where a measured, multi-card allocation and a separate current weight were needed.
- **Change:** additive `CustomerMaterialAllocation` and nullable ledger/on-hand weights; reserve, full release and physical-weight reconciliation APIs; per-lot balances and searchable UI. Legacy links are not treated as allocations; existing lots start with unknown on-hand weight. No weight is inferred from quantity. `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261027110000_customer_material_allocations/migration.sql`, `backend/src/controllers/customerMaterial.controller.js`, `backend/src/services/stockService.js`, `backend/src/routes/customerMaterial.routes.js`, `frontend/src/pages/customerMaterial/`.
- **Evidence:** `customerMaterialAllocation.inMemory.test.js` and Playwright `UI reserves one inward across job cards...`: 40/20 plus 30/15 leaves 30/15; releasing 40/20 and moving 25/10 leaves on-hand 75/40 and reserved 30/15. The suites pass as described below. Allocation, release and reconciliation audit-write failures roll back in the in-memory fault-injection test.
- **Boundaries:** only full release is supported; release is required before physical movement, and a movement is not linked to a reservation or job card. Partial release, direct reservation consumption and per-line vendor weight attribution are not implemented. An unmeasured movement makes on-hand weight unknown until measured again.

### MFG-02 — High: customer lot double-spend and incorrect split-vendor status

- **Reproduce:** two writers each attempt to issue 60 from a lot containing 100; or return one of two outstanding vendor challans and inspect the lot status.
- **Root cause:** read/aggregate/write sequences lacked a shared lot lock, and a single returned challan could overwrite the status even while another was outstanding.
- **Change:** parameterized lot and challan row locks, transaction re-reads at `ReadCommitted`, quantity/weight reservation guards, and status derived from all open challans. Reject over-precision rather than silently storing rounded physical quantities. `backend/src/services/stockService.js`, `backend/src/utils/transactionLocks.js`, `backend/src/controllers/jobwork.controller.js`, `backend/src/validators/`.
- **Evidence:** controlled `customerLotConcurrency.test.js`, in-memory allocation races, and disposable Playwright split-issue/return tests pass. A 5+6 issue against 10 rolls back both ledger and challan in demo storage. A measured UI issue of 30/15 followed by accepted 20/10 and rejected 10/5 returns the lot from 70/35 to 100/50. These are not MySQL lock tests.

### BILL-01 — High: decimal products and saved/printed/report totals could disagree

- **Reproduce:** enter quantity 0.5 and rate 20.15; binary floating-point calculations can make the half-paisa product round differently at different stages.
- **Root cause:** binary arithmetic and input precision inconsistent with persisted decimal columns.
- **Change:** `decimal.js` calculations and matching client preview, line/quantity/rate/discount precision validation, and rejection of discounts exceeding subtotal or amounts exceeding column limits. `backend/src/utils/gst.js`, `backend/src/controllers/invoice.controller.js`, `backend/src/validators/invoice.schema.js`, `frontend/src/lib/invoiceTotals.js`, `frontend/src/pages/invoices/InvoiceForm.jsx`.
- **Evidence:** backend/frontend money tests pass. The disposable E2E saves lines for per-piece, per-kg and lot descriptions as 546, 10.08 and 2,500; saved subtotal 3,056.08 and rounded total 3,056 are found in the PDF and XLSX. A 36-line PDF text-extraction test finds every line once and the total. This is not visual/layout approval or proof of tax/legal compliance for every case.

### BILL-02 — High: quotation conversion and edits bypassed financial controls

- **Reproduce:** attempt to convert a draft quotation or use quotation update permission without invoice-create permission; try linking an invoice directly to a quote; edit an approved quote or submit an excessive discount.
- **Root cause:** insufficient endpoint permission/lifecycle checks, stale reads, and incomplete quotation amount/discount validation.
- **Change:** require customer-quotation update **and** invoice create, approved customer quote, locked re-read and internally consistent non-negative saved amounts. Public invoice writes cannot attach/detach a quote. Editing a sent/approved/rejected quote resets it to draft and requires resending and acceptance; discount-only edits persist. `backend/src/controllers/quotation.controller.js`, `backend/src/routes/quotation.routes.js`, `backend/src/validators/{quotation,invoice}.schema.js`, `frontend/src/pages/quotations/`.
- **Evidence:** `auditManufacturingBillingSecurity.test.js`, `transactionRollback.inMemory.test.js`, and quotation Playwright flows pass. Historical approved values are not silently backfilled; inconsistent historical rows must be corrected before conversion.

### MFG-03 — High: work-order receipt/GRN cross-link, duplicate and reversal corruption

- **Reproduce:** submit the same work-order line twice in a return, submit a GRN referencing a different order's line, race two sends, or reverse a historical GRN whose order counters no longer contain its receipt.
- **Root cause:** missing parent/permission checks, duplicate IDs, stale order state and clamping negative reversal counters to zero.
- **Change:** validate order/PO/party/line relationships and scope, serialize work-order state changes, use decimal-safe outstanding quantities, reject duplicates and reject inconsistent reversals rather than masking them. `backend/src/controllers/{vendorWorkOrder,grn}.controller.js`, `backend/src/services/vendorWorkOrderService.js`, `backend/src/validators/{vendorWorkOrder,purchase}.schema.js`.
- **Evidence:** `transactionRollback.inMemory.test.js`, `vendorWorkOrderConcurrency.test.js` and security regressions pass. A rejected historical reversal needs manual data reconciliation; this work did not alter historical records.

### SEC-01 — High: public upload and cross-document image access

- **Reproduce:** request a stored business attachment from the old public `/uploads` path, or request the same name as a quotation image with only quotation-read permission.
- **Root cause:** the shared upload directory was publicly mounted and image serving did not distinguish attachments.
- **Change:** remove the public static mount; preserve permission-checked attachment downloads and allow only new quotation-image namespace or actually referenced legacy quotation/template images, excluding names owned by attachments. `backend/src/server.js`, `backend/src/controllers/{attachment,quotationTemplate}.controller.js`.
- **Evidence:** unauthenticated path and unrelated-attachment requests are denied, while authorized document and new/referenced legacy image tests pass in `auditManufacturingBillingSecurity.test.js`.
- **Remaining:** extension and client-declared MIME are checked, not content signatures or malware. New quotation images have no per-image owner/type metadata; a quotation reader who knows a new image name may access it. External consumers of the removed public path need assessment.

### SEC-02 — High: scoped job-card data and drawing lifecycle gaps

- **Reproduce:** as a scoped user, access another card's drawing or allocation details; concurrently assign/reopen work while a card is completed, delete a drawing while work is being assigned, or cancel a card with open drawing work.
- **Root cause:** card scope was not consistently applied across attachments/assignments, and status or delete prechecks were outside the shared lock.
- **Change:** reuse card-scope checks, hide inaccessible allocation details while retaining aggregate totals, lock card lifecycle and assignment creation/reopening/deletion checks, require open work to finish/cancel before card cancellation, and protect assigned drawings on line removal. Assignment create/reopen notification failure now rolls back the corresponding in-transaction assignment write. `backend/src/utils/jobcardAccess.js`, `backend/src/controllers/{jobcard,assignment,attachment,customerMaterial}.controller.js`.
- **Evidence:** scoped-user, assignment rollback, deletion race and lifecycle cases pass in `customerMaterialAllocation.inMemory.test.js`; the 559-case authorization matrix also passes. Real MySQL races remain unverified.

### SEC-03 — High: production seed could create a known demo administrator

- **Reproduce:** run the normal demo seed with `NODE_ENV=production` without configuration-only mode on an empty database.
- **Root cause:** demo data included a publicly known administrator credential, even though re-seeding did not reset an existing password.
- **Change:** refuse the demo seed **before any writes** when `NODE_ENV=production`; explicitly selected `SEED_CONFIG_ONLY=1` remains available, with administrators to be provisioned securely. Remove credential values from the completion log. `backend/prisma/seed.js`.
- **Evidence:** `seedSafety.test.js` verifies the production rejection occurs before the first fake write and that explicit configuration-only mode can begin. This does not remove or rotate any account already in a database; the guard depends on correct `NODE_ENV`.

### SEC-04 — Medium: OTP values appeared in development logs

- **Reproduce:** request an OTP in a nonproduction environment and inspect server logs.
- **Root cause:** the development scaffold logged the one-time code.
- **Change:** remove OTP logging; `devCode` remains a nonproduction-only response for local testing. `backend/src/controllers/auth.controller.js`.
- **Remaining:** approved production email/SMS delivery is not implemented; verify rate limits, secret management and full authentication behavior in the target environment before release.

### UI-01 — High: ambiguous job-card/stock save outcome could invite duplicates

- **Reproduce:** let a job-card save succeed, then fail a staged drawing upload; or let a reservation commit but drop its HTTP response.
- **Root cause:** the card and its later uploads are separate operations; a network error does not prove whether a write committed.
- **Change:** after a confirmed card save, upload failure explains the partial result and opens the saved card. Stock reservation/release/reconciliation, stock movement, invoice and jobwork UI warn on uncertain network/server outcomes and tell users to verify before retry. `frontend/src/pages/jobcards/JobcardForm.jsx`, `frontend/src/pages/customerMaterial/`, `frontend/src/pages/invoices/InvoiceForm.jsx`, `frontend/src/pages/jobwork/`.
- **Evidence:** disposable browser tests inject a failed drawing upload and a lost response *after* a successful reservation; the saved card/reservation is present and the warning appears. No idempotency keys were added; warnings reduce ambiguity but do not prevent a user from retrying an uncertain request.

## Atomicity and manufacturing verification

- In-memory fault injection verifies that invoice creation and its lines roll back if receivable creation fails; invoice edits and the previous ledger entry roll back when ledger replacement fails; payment/header/ledger rollback together; and job-card line edits roll back when the final card write fails. See `backend/tests/api/transactionRollback.inMemory.test.js`.
- Reservation, release and measurement changes require an audit write in the same transaction; injected audit errors roll them back in the demo adapter. Most older audit calls remain best-effort, so audit completeness for other operations is not guaranteed.
- Job-card database changes and file uploads are **not one atomic transaction**. Some files may have uploaded before a later upload fails; users must inspect and re-upload missing drawings. A lost response can leave the final outcome unknown.
- The test adapter serializes or simulates transactions and does not reproduce MySQL isolation, FK enforcement, connection failures, deadlocks or lock wait timeouts. Do not interpret these tests as production rollback/concurrency proof.

## Executed verification

Executed using Node 22.22.3/npm 10.9.8, with write tests confined to disposable demo/in-memory storage:

| Area / command (run in directory) | Actual result |
| --- | --- |
| `backend`: `npm test` | **817/817** in 22 files; includes 559 authorization-matrix cases and new fault-injection/safety tests |
| `backend`: `npm run lint` | Passed; Vitest emits an existing future Vite config-loader warning |
| `frontend`: `npm test` | **160/160** in 13 files |
| `frontend`: `npm run lint`, `npm run build` | Passed; build warns that the charts chunk is 525.89 kB minified |
| `frontend`: `npm run test:e2e` | **25/25** passed against disposable demo data. A later single-test rerun also passed after an additional assertion that unmeasured weight stays unknown. |
| `backend` and `frontend`: `npm audit --audit-level=low` | 0 reported vulnerabilities for the installed dependency trees at audit time |
| Prisma 5.22 schema validation | Matching Prisma WASM validation and CLI `prisma validate` passed; `prisma generate --no-engine` succeeded using placeholder engine paths. Normal engine download/generation and real query execution were unavailable. |
| Invoice PDF | Browser test extracted all 36 line labels and the total; an additional scratch sweep checked 20–45 lines. No comprehensive visual/print certification. |
| Alibaba Open Code Review | Delegation preview and rule resolution executed; the agent performed the review. See scope below. |

One full browser run initially failed because an existing test's broad `Receipt recorded` locator matched both a toast and the page. It was made exact; the subsequent full 25-test run passed. Earlier intentional failing regressions were used to reproduce defects and are not current failures.

## Release blockers, residual risks and required next steps

1. **Real DB / migration — blocker.** In a separately provisioned disposable MySQL instance matching production version/collation, run the complete migration chain against an empty database and a sanitized representative copy; compare schema/index/FK drift, verify restrictive allocation-history FKs and normal generated client, and execute transactional fault injection and competing writers. Confirm deadlock/timeout behavior and backup/restore. No production migration should run without explicit operational authorization.
2. **Legacy material — blocker for allocation rollout.** No legacy weight or old `jobcardId` is converted into allocations. Physically verify each in-scope lot's on-hand weight and use the audited reconciliation operation before reserving. Plan training for full-release-before-issue; direct and partial reservation consumption are unsupported.
3. **Idempotency / cross-system saves — high.** Several create/movement/payment flows have no idempotency key. Verify state before retry after a timeout or server error. Attachments and the main job-card save do not share a transaction.
4. **Security / operations — high.** Verify the deployed seed was not used to create a default admin; rotate/remove any unsafe existing account via an authorized procedure, ensure `NODE_ENV` and secrets are correct, implement approved OTP delivery, and validate attachment scanning and image access policy. Historical image names and external `/uploads` integrations need review. No live penetration test or production security configuration review was performed.
5. **Accounting and prints — high.** Obtain business/accounting approval for discount, GST and round-off rules, especially for historical imported quotations/invoices. The current quotation UI does not model GST, and charge units are not structured. Verify physical print layout, templates, taxes and reports for real data; no statutory-compliance claim is made.
6. **Data quality / audit — medium.** Inconsistent historical vendor receipt reversals now stop for manual reconciliation. Older audit calls may still fail best-effort. Confirm retention, monitoring, authorization and recovery procedures.
7. **Performance — unverified.** No production-scale or load benchmark was run. Lot detail holds a row lock while loading data and scoped card checks may issue queries per distinct card; benchmark and optimize if required. The frontend build reports the charts-chunk warning noted above.

## Open Code Review delegation scope

The requested [Alibaba Open Code Review](https://github.com/alibaba/open-code-review) was cloned at commit `375f64c`. Its `delegate preview` and `delegate rule` commands supplied deterministic changed-file selection and language/schema/package review rules; **this agent** inspected the code and performed the review. No independent OCR LLM scan was run. Git 2.39.5 is below the tool's documented 2.41 minimum, although these commands completed with a warning. The final preview selected 44 reviewable files and excluded 16 paths (tests, lockfiles and this report) using default path rules; excluded tests were separately executed/reviewed as applicable. Statuses below are relative to the original checkout.

### OCR-selected paths accounted for

`M` = modified, `A` = added. All paths are relative to `utech-repo/`.

```text
M backend/package.json
M backend/prisma/schema.prisma
M backend/prisma/seed.js
M backend/src/controllers/assignment.controller.js
M backend/src/controllers/attachment.controller.js
M backend/src/controllers/auth.controller.js
M backend/src/controllers/customerMaterial.controller.js
M backend/src/controllers/grn.controller.js
M backend/src/controllers/invoice.controller.js
M backend/src/controllers/jobcard.controller.js
M backend/src/controllers/jobwork.controller.js
M backend/src/controllers/quotation.controller.js
M backend/src/controllers/quotationTemplate.controller.js
M backend/src/controllers/vendorWorkOrder.controller.js
M backend/src/routes/customerMaterial.routes.js
M backend/src/routes/quotation.routes.js
M backend/src/server.js
M backend/src/services/stockService.js
M backend/src/services/vendorWorkOrderService.js
M backend/src/utils/audit.js
M backend/src/utils/gst.js
M backend/src/utils/jobcardAccess.js
M backend/src/validators/customerMaterial.schema.js
M backend/src/validators/invoice.schema.js
M backend/src/validators/jobcard.schema.js
M backend/src/validators/purchase.schema.js
M backend/src/validators/quotation.schema.js
M backend/src/validators/vendorWorkOrder.schema.js
M frontend/package.json
M frontend/src/lib/invoiceTotals.js
M frontend/src/pages/customerMaterial/CustomerMaterialForm.jsx
M frontend/src/pages/customerMaterial/CustomerMaterialPage.jsx
M frontend/src/pages/customerMaterial/CustomerMaterialView.jsx
M frontend/src/pages/invoices/InvoiceForm.jsx
M frontend/src/pages/jobcards/JobcardForm.jsx
M frontend/src/pages/jobwork/JobworkForm.jsx
M frontend/src/pages/jobwork/JobworkPage.jsx
M frontend/src/pages/quotations/QuotationForm.jsx
M frontend/src/pages/quotations/QuotationView.jsx
A backend/prisma/migrations/20261027110000_customer_material_allocations/migration.sql
A backend/src/utils/transactionLocks.js
A backend/src/validators/precision.js
A frontend/src/lib/quantityValidation.js
A frontend/src/pages/customerMaterial/CustomerMaterialAllocations.jsx
```
