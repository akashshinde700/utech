# ERP_WORKFLOW_AUDIT.md — End-to-end workflow validation

**Audit date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech`
Method: code-trace of every workflow against `prisma/schema.prisma` + controller logic, then HTTP-level scenario tests against the real Express stack (`backend/tests/api/*`). A live MySQL run was not possible in this sandbox — see §7.

---

## 1. Workflow map (as actually implemented)

```
Purchase:   PurchaseOrder (DRAFT→APPROVED→PARTIALLY_RECEIVED→RECEIVED)
              └─ GRN (stock IN accepted qty; PO line qtyReceived rollup; cancel reverses both)
                   └─ PurchaseReturn (DRAFT→APPROVED→PROCESSED: stock OUT, vendor credit)

Sales:      Quotation → Invoice (ISSUED→PARTIALLY_PAID→PAID; money server-computed)
              └─ DispatchChallan (stock OUT at creation; CANCELLED restores stock)
              └─ SalesReturn (DRAFT→APPROVED→PROCESSED: stock IN, customer credit)

Jobwork:    JobworkChallan (company OR customer-owned material)
              create  → stock/lots OUT (capped by available)
              receive → stock/lots IN (received + rejected, capped at qtySent)
              cancel  → outstanding back IN

Manufacturing: CustomerMaterialLot (inward) → Jobcard ("Project") → Task Progress
               (JobcardOperation) → ProductionBatch (PLANNED→IN_PROGRESS→COMPLETED:
               FG stock IN, materials OUT) → Quality / Certificate links
```

## 2. The five mandated checks

### ✅ Check 1 — Inventory: inward, material issue, production, returns vs stock ledger

**Verified** by `backend/tests/api/inventoryReconciliation.test.js` (10 tests). A stateful
ledger double drives `stockService` through a full day — GRN +50, GRN-cancel −6,
jobwork out −40 / in +36 / rejected +4, production consume −70 / produce +55,
dispatch −30, sales return +5, purchase return −3, adjustment −2 — and three
independent sources of truth reconcile exactly:

1. `Item.currentStock` after the run = **119**
2. Σ(`StockLedger.qtyIn`) − Σ(`qtyOut`) + opening = **119**, and every row's stored
   `balance` equals the running total at that point
3. the hand-written closing formula `120+50−6−40+36+4−70+55−30+5−3−2` = **119**

Also pinned: one ledger row per movement (no double movements), over-issue leaves
no half-written ledger, the conditional decrement cannot double-spend under race,
and negative balances only via explicit `allowNegative` (visible in the ledger).
Customer lots reconcile the same way (`available = Σin − Σout`).

### ✅ Check 2 — Manufacturing flow: multiple job cards from one inward

**Verified** (`inventoryReconciliation.test.js` "inward lot" block + `regressionDefects.test.js` AUD-206).
One `CustomerMaterialLot` (inward) consumed by **two** jobwork challans (40 + 30 of 100),
partial receives (35 good + 5 rejected), then consumption/disposition:
remaining stays exact at every step (100 → 60 → 30 → 70 → … → 5), matching the
hand formula `100−40−30+35+5−10−55 = 5`. A third challan cannot over-issue the
remaining 30 (400, untouched balance).

**Defect found & fixed — AUD-206 (P2):** rejected customer material never came back
to the lot ledger (company material did). One inward feeding multiple challans with
any rejects made the inward's remaining quantity permanently too low — and the
"missing" pieces could never be dispositioned back to the customer because the lot
ledger no longer held them. Fixed in `jobwork.controller.js`; two regression tests
fail on the old code.

*Limitation (not a bug — documented for scoping):* `CustomerMaterialLot.weight` is a
static attribute of the inward; the ledger tracks quantity only. "Remaining weight" is
not computed anywhere in the product; per-movement weight tracking would be a new
feature (schema + UI), deliberately not invented in this audit.

### ✅ Check 3 — Billing: quantity, weight, rate, lot charge, tax, totals

**Verified** by `backend/tests/api/billingCalculation.test.js` (6 tests) + existing
`unit/money-and-tax.test.js` (24 tests). This ERP models all charge bases as invoice
lines (per-piece: qty=pcs; per-kg: qty=weight; lot charge: qty=1×rate). A mixed
three-line invoice `12×45.50 + 36.75kg×120 + 1×2500` reconciles by hand:
subtotal 7,456 · CGST=SGST=671.04 · total 8,798 (exact 8,798.08, roundOff −0.08);
IGST split gives the same money. Paise rounding is per-line; client-supplied totals
are discarded; create and edit produce identical totals.

**Defect found & fixed — AUD-204 (P2):** sales-return discount was subtracted AFTER
tax, contradicting the documented GST rule in `utils/gst.js` ("a discount reduces the
taxable value… NOT deducted after tax") that invoices follow. A full return with a
discount refunded ₹1,080 against an invoice that charged ₹1,062. Now parity-tested:
same lines + discount produce identical totals on both documents.

### ✅ Check 4 — Shortcuts and forms: no duplicate rows / double stock movements on edit-save-delete

- **AUD-201 (P1, fixed):** editing a jobcard silently deleted every Task Progress item
  on it (the form posted `operations: []`; the API treats a sent array as replace-all).
  The form no longer sends the key; contract tests pin both sides.
- **AUD-202 (P2, fixed):** editing a return's lines skipped the over-return cap and
  line-ownership checks that create enforces — a DRAFT return could be edited past
  the invoiced/accepted quantity or re-pointed at another document's line. Now the
  same shared guard runs on create and update (excluding the row being edited).
- Double-movement guards verified: dispatch cancel twice → 400; process endpoints
  status-gated (PROCESSED cannot re-process); jobwork receive capped at qtySent;
  GRN cancel blocked once a purchase return exists; line upserts preserve row ids
  (no delete-all-recreate duplication — pinned by test).
- Keyboard layer verified (`frontend/tests/unit/keyboardShortcuts.test.jsx`):
  **AUD-207 (P2, fixed)** — Escape with a SearchableSelect dropdown open used to close
  the surrounding Modal as well (unsaved form input lost). Now topmost-layer-wins.
  Enter-confirm skips textareas/buttons; listeners clean up on unmount; Enter on a
  focused button does not double-fire.

### ✅ Check 5 — Regression: a fix in one module must not break another

- Every fix in this pass is scoped to its own handler/payload; the **entire pre-existing
  suite (800 tests) ran green after each change** — no test was modified or disabled.
- Full matrix after all fixes: backend **702/702**, frontend **144/144**, backend lint
  exit 0, frontend lint 0 errors, `vite build` PASS.
- Cross-module links re-exercised by the suites: GRN↔PO rollup, GRN↔vendor work-order
  deltas, dispatch↔stock, returns↔stock↔party ledger, jobwork↔customer lots,
  invoice↔party ledger↔payments.

## 3. Workflow transition matrix (tested behaviour)

| Document | Create | Edit | Cancel/Reverse | Terminal states |
|---|---|---|---|---|
| Jobcard | 201, number allocated | lines upsert; operations untouched (AUD-201) | delete = CANCELLED; 2nd delete removes | CANCELLED, COMPLETED (blocks reopen) |
| JobworkChallan | stock OUT capped | — | cancel returns outstanding IN | RECEIVED/REJECTED/CANCELLED |
| GRN | stock IN accepted; PO rollup | narrow whitelist (vehicleNo/notes) | cancel reverses stock + PO qty | CANCELLED |
| Invoice | totals recomputed | blocked when PAID lines/discount; cancelled immutable | cancel blocked with payments | PAID, CANCELLED |
| Sales/Purchase Return | cap-checked | cap-checked (AUD-202) | cancel DRAFT only | PROCESSED (single stock movement) |
| Dispatch | stock OUT | — | cancel restores stock once | CANCELLED, DELIVERED |
| ProductionBatch | planned | blocked after COMPLETED | cancel non-completed | COMPLETED (moves stock exactly once) |

## 4. Deliberate non-changes

- Sales-return "discount after tax" was a real inconsistency; fixed with a parity test
  rather than a new business rule (same rule invoices already used).
- Purchase-return processing does not decrement the PO's `qtyReceived` (receipt
  happened; the return is a separate credit document). Left as implemented; flagged
  in `BUSINESS_LOGIC_BUGS.md` as an open design question, not a defect.
