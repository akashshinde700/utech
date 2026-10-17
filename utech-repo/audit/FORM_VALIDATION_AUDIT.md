# FORM_VALIDATION_AUDIT.md

**Audit date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech`
Scope: every form and dynamic line-item table (23 `<form>` elements, 374 inputs across 88 jsx files) — client validation, server validation, dynamic-row integrity, and the edit-save path. Evidence: source trace + HTTP contract tests (`backend/tests/api/validation.test.js`, `uiContract.test.js`, `regressionDefects.test.js`) + frontend tests.

---

## 1. Validation architecture

Client: `lib/validation.js` helpers (required, positiveNumber, gstRate, nonNegative) with
per-field error maps cleared on change; first-error focus. Server: Zod schemas through
`validate()` middleware — 83 route handlers validated. **Money is never client-trusted**:
invoice/return totals are recomputed server-side (tested: client-sent `total: 1` is
ignored). Stock quantities are enforced server-side by conditional decrements.

## 2. Findings

### AUD-202 — P2 — FIXED — "editing a return's lines skipped the caps create enforces"

- **Affected:** `PUT /api/sales-returns/:id`, `PUT /api/purchase-returns/:id` with `lines`.
- **Repro (sales):** create a DRAFT return for 1 of 10 invoiced → edit it to qty 40 → 200 OK → approve → process: 40 units of stock restored and the customer credited for 40 against an invoice for 10. Also: edit a line's `invoiceLineId` to 777 (another invoice's line) → accepted.
- **Expected:** 400 with the same messages create gives ("exceeds the invoiced quantity…", "does not belong to invoice…").
- **Root cause:** the over-return and line-ownership checks lived only in `create()`.
- **Fix:** shared `assertReturnableLines()` used by create **and** update in both
  controllers; the update pass excludes the return being edited from prior-returned sums.
- **Tests:** 6 new cases (over-cap, foreign line, missing line, cap-excluding-self) — fail pre-fix.
- **Note:** the UI (`SalesReturnForm`) has only client-side `positiveNumber` on qty, so this hole was reachable by ordinary editing.

### AUD-203 — P2 — FIXED — "processing a return 500ed on description-only lines"

- **Affected:** `POST /api/sales-returns/:id/process`, `POST /api/purchase-returns/:id/process`.
- **Repro:** return a line with `itemId: null` (a service/design charge — allowed by the
  schema and produced by the UI when the invoice line has no catalog item) → process.
- **Actual (pre-fix):** 500 mid-transaction (`item.findUnique({ where: { id: null } })`).
- **Fix:** null-item lines skip the stock movement (nothing was ever received/issued for
  them); the party-ledger credit still covers them. Matches GRN/jobwork's existing rule.
- **Tests:** 2 new cases — fail pre-fix (500), pass now (200, exactly one stock row for the real item).

### AUD-201 — P1 — FIXED — "edit/save made rows vanish" (the inverse of duplication)

Editing a jobcard posted `operations: []` and the backend's replace-all semantic deleted
every Task Progress item on it (see `BUSINESS_LOGIC_BUGS.md` for the full write-up).
This is the mandated "edit/save/delete karne par duplicate rows ya double stock
movements na hon" check — verified negative: line upserts preserve row ids (no
delete-all-recreate duplication, pinned by test), and every stock-mutating edit path
was re-run for double movements (none found: see `INVENTORY_RECONCILIATION_AUDIT.md` §2.2).

## 3. Dynamic line-table behaviour (verified)

| Concern | Status | Evidence |
|---|---|---|
| Row ids stable across edits (jobcard lines) | PASS | update-in-place path + regression test ("no delete-all-recreate duplication") |
| Deleting one row doesn't alter others | PASS | `toDelete` computed from missing ids only; attachments orphan-swept deliberately |
| Totals recompute after add/remove row | PASS | InvoiceForm `useMemo` mirrors gst.js; backend recomputes regardless |
| Removed rows are not submitted | PASS | filter at payload build (SalesReturnForm, InvoiceForm) |
| Duplicate items in one document | allowed by design (different rates/notes possible) | schema has no line-level uniqueness — matches manufacturing practice |
| Repeated submission | PASS | `saving`/`loading` flags disable submit buttons (InvoiceForm, GRNForm, POForm, JobworkForm, DispatchForm verified) |
| Zero/negative qty | rejected both sides | Zod `.positive()` / `.nonnegative()`; client `positiveNumber` |
| Decimal weights/qty | PASS | `Decimal(14,3)`; paise-precision tests in `billingCalculation.test.js` |
| Empty required fields | client + server | Zod `min(1)`, `required()` helpers |
| Invalid GST rate | bounded 0–100 | `invoice.schema.js`, `salesReturn.schema.js` |
| Over-return on edit | **was broken (AUD-202) → fixed** | regression tests |
| Stale edit of completed/cancelled documents | rejected | status guards on invoice/GRN/return/batch update |

## 4. Remaining gaps (open, low risk)

- 54 write routes still take an unvalidated body (prior finding AUD-115) — mass assignment
  is prevented by per-controller whitelists (verified for the returns, GRN, production and
  jobcard paths this pass) but the belt-and-braces Zod layer is missing on e.g. expense,
  machine, project routes.
- `SalesReturnForm` shows a pre-tax "Total" preview (Σ line amounts) while the server
  computes the taxed refund — display-only mismatch, no money impact (P3).
- Client-side over-return is not pre-checked against already-returned qty (server is the
  authority — acceptable, but a nicer UX would show remaining returnable qty).
