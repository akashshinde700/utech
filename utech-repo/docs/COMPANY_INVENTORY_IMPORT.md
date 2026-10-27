# Company material inventory — import of `company_inventory/` (27 Oct 2026)

The four photographed stock sheets in `utech-repo/company_inventory/` are now part of the
Prisma item master, with the transcription, the reconciliation and the same-company
evidence all checked in code.

| Sheet (photo) | Section | Lines | Qty (pcs) | Printed `Total=` | Σ Rate (transcribed) | Σ Qty × Rate |
|---|---|---|---|---|---|---|
| `company_inventory/1.jpg` | ROUND BAR & HEX | 18 | 32 | 6,89,200.00 | **6,89,200.00 ✔** | 13,45,100.00 |
| `company_inventory/2.jpg` | PIPE | 20 | 51 | 10,15,700.00 | **10,15,700.00 ✔** | 32,71,200.00 |
| `company_inventory/3.jpg` | PLATES | 20 | 41 | 23,85,000.00 | **23,85,000.00 ✔** | 57,29,000.00 |
| `company_inventory/4.jpg` | FLANGES | 15 | 96 | 1,89,900.00 | **1,89,900.00 ✔** | 13,32,100.00 |
| **Total** | | **73** | **220** | **42,79,800.00** | **42,79,800.00** | **1,16,77,400.00** |

Run the check yourself:

```bash
cd backend
npm run inventory:verify          # human-readable table + evidence, exit 1 on any mismatch
npm run inventory:verify -- --json
```

## Where the data lives

| File | Purpose |
|---|---|
| `backend/prisma/companyInventory.js` | The transcription (one declarative row per sheet line), grade normalisation, `verify()`, `assertSameCompany()` and the idempotent `seedCompanyInventory()`. |
| `backend/prisma/verifyCompanyInventory.js` | CLI used by `npm run inventory:verify`. |
| `backend/prisma/seed.js` | Calls `seedCompanyInventory()` during the full demo seed, **after** `assertSameCompany()`. |
| `backend/tests/unit/companyInventory.test.js` | 11 tests: totals reconciliation, provenance, grade normalisation, idempotency, ledger ↔ stock equality. |

## Item codes and master data

* `RB-0001 … RB-0018` — Round Bar & Hex (`1.jpg`)
* `PP-0001 … PP-0020` — Pipe (`2.jpg`)
* `PL-0001 … PL-0020` — Plate (`3.jpg`)
* `FL-0001 … FL-0015` — Flange (`4.jpg`)

Every item is created as:

| Field | Value |
|---|---|
| `type` | `RAW_MATERIAL` |
| `uom` | `PCS` (the sheets count pieces; no weight is printed, none is invented) |
| `purchaseRate` | the sheet's **Rate** column, per piece |
| `openingStock` / `currentStock` | the sheet's **Qty** |
| `minStock` | `0` (the sheets carry no reorder level) |
| `gstRate` | `18` |
| `hsnCode` | family-level: bars `7228`, pipe `7304`, plate `7219`, flange `7307` |
| `category` | `Round Bar & Hex` / `Pipe` / `Plate` / `Flange` |
| `description` | sheet, line number, printed size, grade + its metallurgical family, source photo, company name and plant address |

Creating an item also writes exactly one `OPENING` row to `StockLedger`
(`ownerType: COMPANY`, `qtyIn = balance = Qty`), so from the first day
`Item.currentStock` equals the item's ledger sum — the invariant the rest of the
ERP relies on.

Seeding is **additive only**: an item that already exists is skipped, never
re-priced and never re-stocked, so re-running `npm run prisma:seed` cannot corrupt a
balance that GRN/dispatch/production documents have since moved. The opening
ledger date is the import timestamp (the sheets do not record a receipt date) —
treat those `OPENING` rows as opening balances, not as supplier invoices.

## Are these the same company's materials?

`npm run inventory:verify` prints this evidence; the seed refuses to run if any of
it fails:

1. **Provenance** — the four photos are stored inside this repository
   (`company_inventory/1.jpg … 4.jpg`) as the company's own stock register, and every
   item description names both the company and its source photo.
2. **Company identity** — the company descriptor used by the import
   (`U-Tech Automation Industries`, *Gat no. 1403, Sonawane Wasti Rd, Chikhali,
   Pimpri-Chinchwad, Pune 411062*) is the same identity that `services/invoice.pdf.js`
   prints on issued tax invoices and that `README.md` / `PROJECT_CURRENT_FLOW_ANALYSIS.md`
   name for this repository. It is overridable with `COMPANY_NAME` / `COMPANY_ADDRESS`.
3. **Place of supply** — `COMPANY_STATE_CODE=27` (Maharashtra), the same value the
   invoice GST split uses; a material register from another state/entity would be a
   different place of supply.
4. **Material grades** — only engineering grades the plant actually works with
   appear: MS, SS 304, SS 310, SS 321, SS 410, SS 416, SS 446, Brass, RA330,
   Inconel, 20MnCr5, Corton-B. Nothing outside that set is accepted
   (`gradeCode()` throws), so a stray supplier sheet or a different company's
   format cannot be imported silently.
5. **The flange sheet has no grade column** (`4.jpg` prints only Sr No / Size / Qty /
   Rate). Its 15 items are stored as *grade not stated* — a grade is **not** guessed
   as SS 304 just because the other sheets are stainless.

Nothing here proves the physical goods exist or that the rates are current; it proves
the transcription matches the photographed sheets and that those sheets describe this
company's material families, plant and tax state.

## Open business question (needs one confirmation)

The printed `Total=` on each sheet equals **Σ Rate**, not Σ (Qty × Rate) — e.g. Round
Bar line 1 alone is 3 × 10,500 = 31,500, and Σ Rate reproduces the printed
6,89,200 exactly while Σ Qty × Rate is 13,45,100. Two readings are possible:

* **A (implemented):** `Rate` is the per-piece rate, `Qty` is the piece count, and the
  sheet's `Total=` is simply a mis-summed column. Inventory value at purchase rate is
  then **1,16,77,400**.
* **B:** `Rate` is the line amount and `Qty` is a count of pieces, so the sheet total is
  meaningful and the value is **42,79,800**.

We persist reading **A** because it is the only reading dimensionally consistent with a
column literally headed *Rate* and because it is reversible (Rate = line amount is
then `rate × qty`). It is **not** safe to use either figure for accounting or
insurance valuation until the company confirms which reading is intended. The seed
stores `purchaseRate` exactly as printed, so switching to reading B later is a
calculation change, not a data re-entry.

Other things the sheets do not contain, and which were therefore not invented:
heat numbers, lot numbers, supplier/vendor, receipt dates, weights (only
dimensions are printed), and reorder levels.
