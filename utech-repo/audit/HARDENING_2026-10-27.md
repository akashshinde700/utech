# Hardening pass — 2026-10-27

**Branch:** `arena/2b90aa02-utech` · **Base:** `47e59ad` (main, after PR #6)
**Scope:** three long-standing risks closed in one pass

| ID | Sev | Finding | Status |
|---|---|---|---|
| AUD-210 | P1 | Cancelling a GRN could drive company stock negative, silently | **FIXED** |
| AUD-211 | P1 | A sales return restored stock without proof the goods came back | **FIXED** |
| AUD-213 | P1 | Dependency advisories unresolved (registry scan never run) | **FIXED — 0 open on both apps** |
| AUD-212 | P1 | Zod v4 upgrade re-injected defaults into every update payload | **FIXED** (surfaced by AUD-213) |

Verification for this pass:

```
backend   npx vitest run                          →  14 files, 752 passed
frontend  npx vitest run                          →  11 files, 157 passed
backend   npm audit --omit=dev / npm audit         →  0 vulnerabilities
frontend  npm audit                               →  0 vulnerabilities
backend   npm run lint                            →  exit 0
frontend  npm run lint                            →  0 errors
frontend  npm run build                           →  PASS
frontend  npx playwright test (13 specs)          →  13 passed
```

---

## AUD-210 — GRN cancellation and negative stock

**Symptom.** `DELETE /api/grns/:id` reversed the accepted quantity with
`allowNegative: true`, unconditionally. If the received material had already been
consumed in production or shipped on a dispatch challan, cancelling the receipt pushed
`Item.currentStock` below zero. The ledger showed a negative balance that then poisoned
stock valuation, the "available" check on every later issue, and the reorder/min-stock
logic — and nothing in the UI warned the operator before they clicked.

**What changed.**

- `services/stockService.js` gained `findStockShortfalls(tx, [{itemId, qty}])` — a
  read-only pre-check that aggregates the requested quantity per item and reports
  `{ itemId, name, available, needed, short }` for anything that cannot be covered. It is
  shared, so any future reversal flow gets the same semantics.
- `grn.controller.cancel()` checks BEFORE it claims the cancellation. A shortfall now
  returns **400** with the exact items and quantities, and writes nothing:
  > Cannot cancel GRN GRN-26-00031: the received stock is no longer on hand
  > (Widget: needed 4, available 1 (short 3)). Post a stock adjustment first, or repeat
  > the cancellation with `force=true` to reverse into negative stock.
- The deliberate escape hatch still exists, but must be asked for: `force: true` is
  honoured only for a caller holding **`stock.adjust`** (or SUPERADMIN), otherwise **403**.
  A forced reversal keeps `allowNegative: true`, tags the ledger note
  *"forced negative-stock reversal"*, and records `forcedNegative` + the shortfalls in the
  audit log and in the response.
- The conditional decrement inside `moveCompanyStock` remains the race guard: if another
  request consumes the stock between the check and the write, the decrement fails, the
  transaction rolls back, and no half-cancelled GRN is left behind.
- UI (`GRNView`): the cancel dialog now renders the server's shortfall inside an
  `role="alert"` panel instead of a toast, and — only for stock administrators — swaps the
  confirm button for **"Reverse anyway (negative stock)"**. Everyone else is told to post a
  stock adjustment first.

**Tests.** `backend/tests/api/inventoryAndReturnGuards.test.js` (5 cases) and the
Playwright spec `frontend/e2e/inventory-safeguards.spec.js` (drives the real dialog:
refusal → alert → forced reversal → ledger note). 4 of the 5 backend cases fail on the
pre-fix controller.

---

## AUD-211 — a sales return does not prove the goods came back

**Symptom.** `POST /api/sales-returns/:id/process` restored stock and credited the
customer on the strength of the return document alone. Nothing in the data model said
whether the material had physically arrived, when, by which challan, or who booked it —
so a commercial claim (or a mistyped one) put inventory back into the warehouse ledger
without anything to reconcile against at stock-take time.

**What changed.**

1. **Model** (`SalesReturn`, migration `20261027100000_sales_return_physical_receipt`):
   `returnChallanNo`, `receivedAt`, `receivedById` (→ `User`) and an optional
   `dispatchChallanId` (→ `DispatchChallan`, relation
   `DispatchChallanSalesReturns`, indexed). The document now carries its own proof.
2. **New endpoint** `POST /api/sales-returns/:id/receipt` (`invoice.update`) records the
   receipt while the return is `DRAFT`/`PENDING_APPROVAL`/`APPROVED`. Validation:
   - challan number required (3–60 chars);
   - `receivedAt` required and **not in the future** (a minute of clock-skew slack);
   - if a dispatch challan is named it must exist, belong to **the same customer**, and be
     `DISPATCHED` or `DELIVERED` — a draft challan reserves stock but never left the
     building;
   - the cumulative quantity returned against that challan (this return + every other
     non-cancelled return linked to it) **cannot exceed what the challan shipped**, per
     item. A return line for an item the challan never shipped is rejected outright.
3. **`process()` is gated**: without `returnChallanNo` + `receivedAt` it returns **400**
   ("Record the physical return receipt first…") and touches neither stock nor the party
   ledger. Proof may also be supplied inline in the process body for API clients — it is
   validated and stored on the same record, so the audit trail is identical. The challan
   caps are re-checked at the moment stock moves, so two returns cannot both claim the
   same shipped quantity.
4. **UI** (`SalesReturnForm`): a new *Physical Receipt* section (challan no., received-on
   date, optional dispatch challan of the selected customer) with a **Record receipt**
   button; once recorded it shows the proof and who booked it. The **Process** button is
   disabled until the receipt exists, with an inline explanation — mirroring the server rule
   rather than letting the user discover it as a 400.

**Tests.** 11 backend cases + 2 Playwright flows (record → process → stock 20 → 22;
future date rejected; unknown challan rejected). 9 of the 11 backend cases fail pre-fix.

---

## AUD-213 — dependency advisories

**The gap.** Every previous audit recorded the same line: *"`npm audit` needs the registry
advisory endpoint, which is unreachable from this sandbox"* (SECURITY_AUDIT.md A06,
RELEASE_READINESS.md, TEST_EXECUTION_REPORT.md). The risk was therefore **unmeasured**,
not absent. With registry access, the measurement and the fix:

| App | Before | After |
|---|---|---|
| backend | 16 advisories (3 critical, 8 high, 5 moderate) | **0** |
| frontend | 21 advisories (2 critical, 10 high, 8 moderate, 1 low) | **0** |

Direct dependencies that carried advisories and what happened to them:

| Package | Before | Now | Why |
|---|---|---|---|
| `xlsx` (SheetJS) | 0.18.5 | **removed** → `exceljs` 4.4.0 | npm's copy is abandoned; prototype pollution (GHSA-4r6h-8v6p-xvw6) + ReDoS (GHSA-5pgg-2g8v-p4x9) have **no fix available on the registry**. The ERP only *writes* workbooks, so the vulnerable parser was pure attack surface. `utils/xlsx.js` is the single export helper; `report.controller` now calls it and keeps the same sheet names/contracts. |
| `zod` | 3.23 | **4.6.7** | memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5). See AUD-212 for the migration work it forced. |
| `vitest` (both apps) | 2.1.9 | **5.0.5** | critical Vitest-UI file read/execute (GHSA-5xrq-8626-4rwp) + path traversal; pulls patched `vite`/`tinypool`/`esbuild`. |
| `vite` (frontend) | 5.4 | **8.3.5** | dev-server advisory chain; `@vitejs/plugin-react` 6 to match. |
| `nodemailer` | 6.9 | **removed** | unused (the OTP flow deliberately logs in dev only); deleting the dependency removes the advisory instead of carrying a major bump for dead code. |
| `express`/`multer`/`morgan`/`qs`/`body-parser`/`proxy-addr` | — | patched in-range | `npm audit fix` + a `qs` override (^6.17.0). |
| `axios`, `react-router-dom`, `postcss`, `postcss-selector-parser`, `browserslist`, `baseline-browser-mapping`, `follow-redirects`, `js-yaml`, `brace-expansion` | older | patched | direct bumps plus targeted `overrides`; `uuid` inside `exceljs` is forced to the audited 11.x line (`"uuid": "$uuid"`). |

Both `package.json` files also gained `engines: { node: ">=20.19" }`, which the new
toolchain requires.

**Proof.** `npm audit` (prod **and** dev) exits clean in both apps, and
`backend/tests/unit/xlsxExport.test.js` pins it: the export produces a real xlsx zip, never
emits an `undefined`/`NaN` cell, and the source tree plus `package.json` cannot reintroduce
`xlsx`.

---

## AUD-212 — Zod 4 and update payloads (surfaced by the upgrade)

Bumping zod exposed a behaviour change that would have been a **data-loss bug in
production**: zod v4 applies a field's `.default()` even when the client never sent the
key, including through `.partial()`. Every update endpoint in this API is written as
"absent key = leave the stored value alone", so the upgrade silently re-introduced
**AUD-201** — the jobcard update received `operations: []`, read it as "replace all", and
deleted every Task Progress item on the card.

**Fix.** `validators/partial.js` → `partialNoDefaults(schema)` strips the default wrapper
from each field *before* making the object partial; all 14 update schemas now use it.
Create schemas are untouched, so defaults still apply where they belong.

**Tests.** `tests/unit/validatorDefaults.test.js` (6 cases): empty jobcard/invoice/item
edits stay `{}`, sent fields are still validated, create payloads keep their defaults.
The pre-existing AUD-201 regression test also passes again — it had caught the regression
immediately.

---

## Not changed (deliberate)

- **AUD-208** — purchase-return processing still does not reduce the PO line's
  `qtyReceived`. That is a business-semantics decision, not a defect: the receipt happened.
- **AUD-127 / AUD-119** — backup/restore procedure and CI pipeline remain open. Both need
  infrastructure outside this repository. The dependency scan above is reproducible in CI
  (`npm audit --audit-level=moderate` in both apps) and should be wired into it when the
  pipeline exists.
