# API_DATABASE_INTEGRITY_AUDIT.md

**Audit date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech`
Scope: transactional integrity, constraints, idempotency, validation and audit trails across the 233 route handlers. Method: code trace + HTTP-level tests against the real Express stack with a Prisma-call double (schema/FK/isolation need a live MySQL — see §6).

---

## 1. Transaction discipline (verified in code + tests)

| Flow | Writes in one `$transaction` | Rollback on failure |
|---|---|---|
| GRN create | GRN + lines + stock IN + PO line qty + VWO delta + PO rollup | yes — over-receipt/party mismatch rejected before any write |
| GRN cancel | stock OUT + PO line qty + VWO delta + status | yes — refuses when a purchase return exists |
| Jobwork create/receive/cancel | challan lines + stock (company or lot ledger) + lot status | yes — over-receive/foreign-line rejected up front |
| Dispatch create/cancel | challan + stock OUT/IN | yes — double-cancel rejected |
| Invoice create/update | invoice + lines + party-ledger mirror (delete+insert) | yes — totals recomputed server-side |
| Returns create/update/process | return + lines + stock + party ledger | yes — status gates prevent double process |
| Production complete | FG IN + every material OUT + batch close | yes — re-complete rejected by status |
| Jobcard update | line upserts + operation replace + attachment sweep | yes (single tx) |

Every stock-moving call goes through `stockService` inside these transactions; the
ledger row and the `currentStock` mutation cannot split (AUD-206 fix restored the one
path that skipped a ledger side).

## 2. Duplicate-request / idempotency posture

- **Document numbers:** atomic `NumberSequence` allocation with row lock + in-process mutex + retry on seeding race (`utils/numbering.js`) — no duplicate `INV-…/JC-…` under concurrency (prior fix, re-verified).
- **Double submission:** UI disables submit while saving (verified 5 major forms); server-side, destructive endpoints are status-gated (cancel twice → 400; process twice → 400; batch complete twice → 400). Plain creates are not idempotency-keyed (two identical POSTs create two documents — standard ERP behaviour; document numbers differ).
- **Race safety on stock:** conditional `updateMany` decrement; a simulated double-issue leaves exactly one movement (test: "a conditional decrement that loses the race writes NO ledger row").

## 3. Validation coverage

83/233 handlers run Zod `validate()` (the write-critical ones: invoices, returns, GRN/PO,
jobcards, jobwork, dispatch, production, customer material, stock adjust). **AUD-202 fix
added the first cross-row business validation on an edit path** (returns update now
re-checks caps + ownership). Remaining unvalidated write routes (54) are protected by
per-controller field whitelists — e.g. returns update only accepts `date/reason/notes`,
GRN update only `vehicleNo/notes` (AUD-115 remains open as belt-and-braces).

## 4. Referential integrity (application-level, tested)

- Return lines must reference lines of the anchored document — enforced on create **and update** (AUD-202); a foreign `invoiceLineId`/`grnLineId` is rejected with 400, a missing one 404.
- Jobwork receive rejects payload lines not on the challan.
- GRN lines must belong to the PO (when anchored) and the GRN party must match the PO vendor.
- Jobcard line edits preserve ids (no orphan-attachment duplication) and delete orphans deliberately.

## 5. Audit trail

`utils/audit.js` writes `AuditLog` rows for every mutation path exercised this pass
(jobcard, returns, jobwork, stock adjust, GRN, invoice, dispatch). Jobcard activity
timeline merges audit rows + notes. Audit failures are swallowed by design (never break
the business write) — noted as a visibility limitation.

## 6. Environment limitation (honest scope)

`prisma generate` cannot run here (binaries host unreachable), so tests drive the real
routes/controllers against a programmable Prisma double (`tests/helpers/fakePrisma.js`).
**Not covered by execution here:** FK cascade behaviour in MySQL, unique-index collisions,
true transaction isolation levels, migration safety on real data. The double's limits are
documented in its header and every report repeats this caveat. Before release: replay the
`inventoryReconciliation` + `regressionDefects` scenarios against seeded MySQL staging.
