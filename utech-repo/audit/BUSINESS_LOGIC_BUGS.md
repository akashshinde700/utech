# BUSINESS_LOGIC_BUGS.md — confirmed defects, fixes and verification

**Audit date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech` (pass 2; pass 1 = PR #1, `arena/f79889ce-utech`)
**Pass 3 (2026-10-27, `arena/2b90aa02-utech`):** AUD-210 (GRN cancel → negative stock),
AUD-211 (sales return had no physical-receipt proof), AUD-212 (zod v4 update-payload
defaults) and AUD-213 (dependency advisories) — full write-up in
[`HARDENING_2026-10-27.md`](./HARDENING_2026-10-27.md).
Severity: P0 data loss/security · P1 core workflow broken · P2 degraded/risky · P3 hygiene.
Status: `FIXED` = code changed **and** a regression test that failed before the change · `OPEN` = diagnosed, not changed.

---

## Fixed this pass — 7 defects, each verified failing pre-fix and passing post-fix

### AUD-201 — P1 — FIXED — Editing a jobcard deleted every Task Progress item on it

- **Affected:** `frontend/src/pages/jobcards/JobcardForm.jsx` → `PUT /api/jobcards/:id` → `jobcard.controller.js` update.
- **Repro:** open any jobcard that has tasks (Task Progress panel, `JobcardView`) → Edit → change anything → Save.
- **Expected:** jobcard updates; tasks untouched (this form never manages them — `/api/tasks` does).
- **Actual:** **every task deleted**, along with cascading assignees and task comments (`JobcardOperationAssignee`, `JobcardNote.operationId` all `onDelete: Cascade`). Progress tracking reset.
- **Root cause:** the form posted `operations: []` on every save (create and update). The jobcard update handler treats a sent `operations` array as replace-all (`if (operations) deleteMany…`), and `[]` is truthy. Field-level drift like AUD-102 in the previous pass — the form state hardcoded `operations: []` in three places.
- **Fix:** the form no longer includes the key (omitting it leaves operations untouched — verified Zod `.partial()` passes `undefined` through). The API's explicit replace semantics are unchanged and now pinned by test.
- **Tests:** `backend/tests/api/regressionDefects.test.js` (form payload contract, no-deleteMany, explicit-replace still works, line-id stability) + `frontend/tests/unit/jobcardFormPayload.test.js` (source guard — the key cannot be reintroduced).
- **Verification:** pre/post both green on the mechanism tests (the defect lived in the payload; the source guard is the regression net); full suites 702+144 PASS.

### AUD-202 — P2 — FIXED — Editing a return's lines bypassed the over-return cap and line-ownership

- **Affected:** `PUT /api/sales-returns/:id`, `PUT /api/purchase-returns/:id`.
- **Repro:** DRAFT sales return for 1 of 10 invoiced → edit qty to 40 → 200. Approve+process restores 40 to stock and credits the customer 40×. Also: point a line at another invoice's `invoiceLineId` → accepted.
- **Expected:** 400 — the same guard `create()` applies.
- **Actual:** 200; over-refund and foreign-line references reached the database.
- **Root cause:** anchoring + cumulative-cap checks existed only in `create()`.
- **Fix:** shared `assertReturnableLines()` on create and update in both controllers; update excludes the edited row from prior-returned sums. Same for purchase returns vs `qtyAccepted`.
- **Tests:** 6 cases in `regressionDefects.test.js` — all fail pre-fix (verified by stash-run), pass post-fix.

### AUD-203 — P2 — FIXED — Processing a return with a description-only line crashed (500)

- **Affected:** `POST /api/sales-returns/:id/process`, `POST /api/purchase-returns/:id/process`.
- **Repro:** include a line with `itemId: null` (service/design charge — allowed by schema and UI) → approve → process.
- **Expected:** 200; stock moves only for real items; party credit covers the whole return.
- **Actual:** 500 (`item.findUnique({ id: null })`) — the whole return unprocessable.
- **Fix:** null-item lines skip the stock movement (GRN/jobwork already follow this rule); party ledger unaffected.
- **Tests:** 2 cases — 500 pre-fix, 200 post-fix with exactly one stock row.

### AUD-204 — P2 — FIXED — Sales-return discount was applied after tax (wrong GST math)

- **Affected:** `salesReturn.controller.js` create/update money computation.
- **Repro:** invoice & return with identical lines (10×100 @18%) and `discount: 100`.
- **Expected:** refund equals what the invoice charged: taxable 900 → GST 162 → **1062** (rule documented in `utils/gst.js`: "a discount… reduces the taxable value… NOT deducted after tax").
- **Actual:** GST on 1000 = 180, total 1180 − 100 = **1080** — ₹18 over-refund, and inconsistent with the very document being reversed.
- **Fix:** `calcTaxes(lines, isIntraState, discount)` — identical engine to invoices; stored `discount` is the clamped value.
- **Tests:** 3 cases incl. an invoice↔return parity assertion — fail pre-fix (1080 vs 1062), pass post-fix. UI never sends discount (always 0), so no existing UI-produced row changes.

### AUD-205 — P3 — FIXED — Stock summary counted rejected material as still at vendor

- **Affected:** `stock.controller.js` `summary()`.
- **Actual:** outstanding = sent − received, ignoring rejected (which physically returned). 10 sent / 6 good / 2 rejected showed 4 at vendor; truth is 2.
- **Fix:** outstanding = sent − received − rejected. **Test:** `regressionDefects.test.js` — fails pre-fix.

### AUD-206 — P2 — FIXED — Rejected customer material vanished from the inward lot

- **Affected:** `jobwork.controller.js` `receive()` customer-owned branch.
- **Repro:** inward lot of 100 → send 40 to vendor → vendor returns 35 good + 5 rejected.
- **Expected:** lot remaining 100 − 40 + 35 + 5 = 100 − 0 = (available) reflects that all 40 came back; the 5 rejected pieces can later be `returnToCustomer`/`consume`d.
- **Actual:** only 35 came back; the 5 rejected disappeared from the lot forever (company-owned material restored rejects; customer material did not — contradicting the code's own comment "it left with the challan and must be restored"). With multiple challans against one inward, remaining qty was permanently wrong — the exact "ek inward se multiple job cards → remaining galat" scenario.
- **Fix:** rejected customer qty posts `JOBWORK_IN` to the lot ledger, consistent with the company path.
- **Tests:** 2 cases in `regressionDefects.test.js` + the multi-challan remaining-qty scenario in `inventoryReconciliation.test.js` — fail pre-fix, pass post-fix.

### AUD-207 — P2 — FIXED — Escape closed the dropdown AND its surrounding modal

- Full write-up in `KEYBOARD_SHORTCUT_AUDIT.md`. Root cause: same-node `document` listeners + `stopPropagation` cannot suppress them; registration order ran the Modal first. Fix: the select consumes Escape on `window` capture. 2 tests fail pre-fix.

---

## Fixed in pass 3 (2026-10-27) — details in HARDENING_2026-10-27.md

| ID | Sev | Finding | Fix |
|---|---|---|---|
| AUD-210 | P1 | `DELETE /api/grns/:id` reversed a receipt with `allowNegative: true` unconditionally, so cancelling after the goods were consumed/dispatched left `Item.currentStock` negative with no warning | pre-check shared in `stockService.findStockShortfalls`; 400 with the exact shortfalls; forced reversal only with `stock.adjust`/SUPERADMIN, audited and noted in the ledger |
| AUD-211 | P1 | `POST /api/sales-returns/:id/process` restored stock on the return document alone — no evidence the material came back | `returnChallanNo` + `receivedAt` + `receivedById` (+ optional `dispatchChallanId`) on the return, `POST /:id/receipt` to record it, process requires it; challan quantities cap the return |
| AUD-212 | P1 | zod v4 re-injected `.default()` values into partial (update) payloads, resurrecting AUD-201 | `validators/partial.js` `partialNoDefaults()` used by all 14 update schemas |
| AUD-213 | P1 | Dependency advisories were never measured (`npm audit` unreachable) | scan executed: 16 backend + 21 frontend advisories → **0 / 0**; `xlsx` and unused `nodemailer` removed, zod/vitest/vite/axios/router bumped, targeted overrides |

## Open findings (carried + new observations)

| ID | Sev | Finding | Notes |
|---|---|---|---|
| AUD-127 | P1 (ops) | No documented backup/restore procedure | unchanged from pass 1 — operational, needs client infra |
| AUD-119 | P2 | No CI pipeline | unchanged — recommend GitHub Actions running both suites |
| AUD-120 | P2 | No SIGTERM/SIGINT graceful shutdown | unchanged |
| AUD-115 | P2 | 54 write routes unvalidated body (whitelists hold) | unchanged |
| AUD-107/108/125/126/129/130 | P2 | exports unbounded; no code splitting; N+1 in returns; no down-migrations; no stock reconciliation job; TZ-naive dates | unchanged from pass 1 |
| **AUD-208** | P3 | Purchase-return processing does not reduce the PO line's `qtyReceived` (GRN-cancel does). A returned-to-vendor PO still reads RECEIVED. | deliberate defer: receipts happened; the return is a credit document — client business decision needed before changing PO semantics |
| **AUD-209** | P3 | `SalesReturnForm` previews Σ line amounts as "Total" (pre-tax) while the server computes the taxed refund | display-only; server money is authoritative |
| **AUD-210** | P3 | `StockLedger.refType` comment omits `DISPATCH_CANCEL` (prior AUD-128) and now also `JOBWORK_IN` reject notes | cosmetic |

## Not reproducible / verified non-issues this pass

- Jobcard line edit duplication — the update path preserves line ids; pinned by test.
- Double stock movements on any edit/save/delete path — full sweep documented in `INVENTORY_RECONCILIATION_AUDIT.md` §2; none found.
- Invoice update with client-supplied totals — server recomputes; pinned by test.
- `moveCompanyStock` race safety — conditional decrement verified by simulated race.
