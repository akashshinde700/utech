# INVENTORY_RECONCILIATION_AUDIT.md

**Audit date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech`
**Mandated check:** "inward, material issue, production, returns aur stock ledger ke balances independently match hone chahiye."

---

## 1. Reconciliation model

Company stock has exactly one write path (`backend/src/services/stockService.js`):
every movement updates `Item.currentStock` **and** writes a `StockLedger` row inside the
same transaction, with a post-move `balance` read fresh from the row. Customer material
uses the same ledger table with `ownerType: 'CUSTOMER'` and a per-lot derived balance
(`Σ qtyIn − Σ qtyOut`) — the two inventories can never mix structurally.

**Independent test:** `backend/tests/api/inventoryReconciliation.test.js` (10 tests).
A stateful in-memory double implements only the four Prisma calls the service uses and
records every write; the test then reconciles **three** sources of truth:

| # | Source | Result |
|---|---|---|
| 1 | `Item.currentStock` after the scripted day | **119** |
| 2 | Σ ledger `qtyIn` − Σ `qtyOut` + opening, plus per-row running `balance` | **119**, every row consistent |
| 3 | Hand formula: `120 +50 −6 −40 +36 +4 −70 +55 −30 +5 −3 −2` | **119** |

Movement coverage: GRN inward, GRN cancel, jobwork out/in, jobwork rejected-in,
production material consumption, production finished-goods in, dispatch out,
sales return in, purchase return out, manual adjustment.

## 2. Invariants proven (each with a test)

1. **One ledger row per movement** — the 11-move scenario produces exactly 11 rows with matching refTypes (traceable source transaction).
2. **No double movement** — dispatch cancel twice is rejected (400); process endpoints are status-gated; jobwork receive is capped at `qtySent`; a race-lost decrement writes nothing.
3. **No half-writes on failure** — an over-issue throws before any ledger row exists; conditional `updateMany` makes concurrent issues safe (second issue of 8 against stock 10 fails cleanly; closing 2).
4. **Negative stock is explicit** — only `allowNegative` moves (GRN-cancel reversal of consumed goods) may go below zero, and the negative is visible in the ledger rather than hidden.
5. **Customer lots reconcile independently** — inward 100 consumed by two challans (40+30), receives (35+5), consumption 10, dispatch 55 → remaining **5** at every step; a third challan cannot over-issue (400).
6. **Company vs customer isolation** — all customer-lot rows are `ownerType: 'CUSTOMER'`; `Item.currentStock` is never touched by lot movements.

## 3. Defects found in this area

| ID | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| **AUD-206** | P2 | Rejected **customer** material received back from jobwork was never restored to the inward lot ledger (company material was). One inward feeding multiple challans with rejects left the lot's remaining quantity permanently short — and the pieces could never be dispositioned back to the customer. | `jobwork.controller.js` — rejected customer qty now posts `JOBWORK_IN` to the lot ledger | `regressionDefects.test.js` (2 tests, fail pre-fix) |
| **AUD-205** | P3 | Stock summary "material at vendor" counted rejected (already-returned) material as outstanding. | `stock.controller.js` — outstanding = sent − received − rejected | `regressionDefects.test.js` (1 test, fails pre-fix) |
| **AUD-203** | P2 | Processing a return with a description-only line (no catalog item) 500ed mid-transaction (`item.findUnique({id: null})`). | both return `process()` handlers skip stock for null-item lines (party credit unaffected) | `regressionDefects.test.js` (2 tests, fail pre-fix) |

## 4. Known design characteristics (documented, not changed)

- `Item.currentStock` is a denormalised cache of the ledger (prior finding AUD-129). This pass added the reconciliation *tests*; a periodic production job reconciling `StockLedger` sums against `currentStock` is still recommended (needs live DB).
- Sales invoices do not move stock — stock leaves at **dispatch**. A sales return restores stock; users must only process returns for goods that physically left. Enforcing dispatch-linked returns would be a new business rule (not invented here).
- Purchase-return processing does not reduce the PO's `qtyReceived` (see `BUSINESS_LOGIC_BUGS.md`).
- No stock reservation/allocation flow exists (`reservedStock: 0` by design).

## 5. Environment limitation

Reconciliation runs against the controller/service logic with a Prisma-call double
(documented in `tests/helpers/fakePrisma.js`): real MySQL FK/transaction isolation
behaviour is **not** exercised here. The same scenario script should be replayed against
a seeded staging database before go-live.
