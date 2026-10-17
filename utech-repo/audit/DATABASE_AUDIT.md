# UTech ERP — Database & Data Integrity Audit

**Date:** 2026-10-17 · **Engine:** MySQL / MariaDB via Prisma 5
**Schema:** 60 models, 20 enums, 154 relations, 37 `@unique` constraints, 88 `@@index`
declarations, 100 `Decimal` money/quantity columns, 26 `onDelete: Cascade`, 36 migrations.

> ### ⚠️ Scope limitation — read this first
>
> **No test in this audit ran against a real database.** `prisma generate` downloads the
> query engine from `binaries.prisma.sh`, which is unreachable from the audit sandbox;
> without it `require('@prisma/client')` throws and the backend cannot boot. No MySQL
> server or Docker was available either, and the schema cannot be retargeted to SQLite
> because it uses MySQL-only enums and `@db.*` attributes.
>
> Everything below is therefore **static schema review plus reasoning about the code paths
> that write to it**. Items that need a live database to confirm are marked
> **NEEDS LIVE DB**. Nothing here should be read as "tested against MySQL".

---

## 1. Schema quality

| Aspect | Assessment |
|---|---|
| Money | `Decimal(14,2)` throughout; `StockLedger` quantities use `Decimal(14,3)` for fractional UoM. No floats anywhere in the money path — correct |
| Rounding | `utils/gst.js` rounds to 2 dp with an epsilon correction and keeps `|roundOff| ≤ 0.5`; verified by an executed test over all 100 paisa values |
| Enumerations | 20 MySQL-native enums for status fields — the database, not the app, rejects an invalid status |
| Indexing | 88 `@@index` declarations. `StockLedger` is indexed on `(itemId, date)`, `(ownerType, date)` and `(customerMaterialLotId)` — the right shape for both the stock history and the customer-material ledger |
| Unique constraints | 37, including `User.email`, `User.phone`, `Party.code`, `Item.code`, `Permission.key`, `NumberSequence.key` |
| Cascades | 26 `onDelete: Cascade`, used on line-item collections (invoice→lines, jobcard→lines, etc.) — appropriate |
| Soft deletes | `Party.isActive`, `Item.isActive`, `Machine` (retire), `User.isActive`, `Invoice`/`DispatchChallan` → `CANCELLED`. Consistent: a "delete" on a document with money behind it is a status change, never a row removal |

### Index gaps (P3, AUD-124)

27 models carry no `@@index`. Most are small lookup tables where it does not matter
(`Uom`, `ItemCategory`, `Machine`, `Shift`, `Permission`). These do matter and should get
one:

| Model | Column | Why |
|---|---|---|
| `InvoiceLine` | `invoiceId` | every invoice read `include`s its lines |
| `PurchaseOrderLine` | `purchaseOrderId` | same |
| `JobcardLine` | `jobcardId` | same |
| `SalesReturnLine` | `invoiceLineId` | the over-return check aggregates by this column **per line, inside the create loop** |
| `PurchaseReturnLine` | `grnLineId` | same |
| `InvoicePayment` | `invoiceId` | the overpayment check aggregates by this column |
| `ProjectTask` | `projectId` | project detail loads all tasks |

Prisma does **not** auto-create an index for a plain (non-unique) foreign key on MySQL, so
these are real table scans. **NEEDS LIVE DB** to measure; the recommendation stands
regardless.

### N+1 query patterns (P2, AUD-125)

Two confirmed by reading the code:

1. `salesReturn.controller.create` — for **each** returned line it runs a
   `salesReturnLine.aggregate` to sum prior returns. A 20-line return issues 20 aggregates
   plus the surrounding queries. Same shape in `purchaseReturn.controller.create`.
   *Fix:* one `groupBy` over all the line ids up front.
2. `report.controller` — every export runs `findMany` with **no `take`** and a full
   `include` of lines and parties (see AUD-107). At a few thousand invoices this is fine;
   at a hundred thousand it will exhaust memory before it produces a file.

## 2. Integrity controls in the write path

These are the invariants an ERP lives or dies by. Each was traced through the code and,
where possible, verified by an executed test that asserts the exact Prisma write issued.

| Invariant | Mechanism | Verified |
|---|---|---|
| Company stock and customer stock never mix | `stockService.moveCompanyStock` is the only writer of `Item.currentStock`; `moveCustomerMaterial` never touches it and writes `ownerType: 'CUSTOMER'` rows | static review |
| Stock can never go negative | conditional `updateMany({ where: { id, currentStock: { gte: outQty } } })` then checks `count === 0` — no read-modify-write race | **executed** (400 `Insufficient stock`) |
| Every stock movement is auditable | one `StockLedger` row per movement, written in the same transaction, with the **post-move** balance read back from the row rather than derived from a stale read | **executed** |
| A cancelled dispatch gives the stock back | `markStatus('CANCELLED')` moves each line back IN with `refType: 'DISPATCH_CANCEL'` | **executed** — regression net for the phantom-inventory-loss bug from the September audit |
| A dispatch cannot be cancelled twice | status guard before the movement | **executed** |
| A delivered dispatch cannot be cancelled | status guard | **executed** |
| A vendor cannot return more material than was sent | `received + rejected ≤ qtySent`, checked cumulatively against the stored line | **executed** (400 `exceeds the qty sent`) |
| A customer cannot return more than was sold | cumulative `salesReturnLine.aggregate` per invoice line, excluding cancelled returns | **executed** |
| An invoice cannot be overpaid | `invoicePayment.aggregate` (source of truth) `max`'d with the denormalised `amountPaid` | **executed** (400) |
| A paid invoice's lines cannot be edited | status guard in `update` | **executed** |
| A cancelled invoice cannot be edited or paid | status guards | **executed** |
| Deleting an invoice with payments is refused | aggregate check before the cancel | **executed** |
| Document numbers cannot collide | `NumberSequence` row with `SELECT … FOR UPDATE` inside a transaction, plus an in-process mutex per key; retries once on a duplicate-key race when seeding a new key | static review — **NEEDS LIVE DB** to prove under concurrency |
| Client-supplied totals are ignored | `computeInvoiceTotals` overwrites everything the client sent | **executed** |
| Deleting a user does not orphan history | first delete deactivates; permanent delete nulls out `reportingToId`, `departmentHeadUserId`, `createdById` references and refuses if assignment history exists | static review |

## 3. Transactions

`prisma.$transaction(async (tx) => …)` (interactive form) is used consistently for
multi-write operations: invoice create + ledger, invoice cancel + ledger cleanup, payment +
invoice update + ledger, dispatch create + stock, dispatch cancel + stock restore, jobwork
receive + line updates + stock, sales/purchase return create.

**Partial-failure behaviour is untested (NEEDS LIVE DB).** The interactive transaction
form does roll back on a thrown error, and the controllers throw `HttpError` from inside
the callback, so the intent is right. But no test in this audit caused a mid-transaction
failure against a real engine, so rollback is **not verified**.

`audit()` deliberately swallows its own failures so logging can never break a request, and
is called *outside* the transaction in most controllers — correct: an audit write should
not roll back a business operation.

## 4. Migrations

36 migration directories, dated 2026-05-04 → 2026-09-22, plus `migration_lock.toml`
(provider = mysql). Naming is descriptive (`add_attachment_lineid`,
`customer_vendor_split`, `task_multi_operator_assignment`), which makes the history
reviewable.

| Concern | Status |
|---|---|
| Migration history present and ordered | ✅ |
| `prisma migrate deploy` wired into `package.json` | ✅ (`prisma:deploy`) |
| Rollback scripts | ❌ **none.** Prisma does not generate down-migrations, so a bad deploy means restoring a backup. **AUD-126 (P2)** |
| Migration safety on a populated database | **NEEDS LIVE DB.** Several migrations add columns and split `customer_vendor_split`; whether any of them locks a large table for an unacceptable time cannot be assessed statically |
| Backup / restore procedure | ❌ **not documented anywhere in the repository.** For a system that is the financial record of a manufacturing business, this is the single biggest operational gap. **AUD-127 (P1 for operations, not for security)** |

## 5. Data types that could bite

| Item | Note |
|---|---|
| `StockLedger.refType` is a `String`, not an enum | The valid values are documented in a comment listing 13 of them, but `DISPATCH_CANCEL` — the value the dispatch-cancel fix writes — **is not in that comment list**. The code works; the documentation is stale. Cosmetic, but it is exactly the kind of drift that makes the next reader think the value is invalid. **AUD-128 (P3)** |
| `Item.currentStock` is a denormalised cache | The `StockLedger` is the source of truth. There is no reconciliation job that compares `Σ(qtyIn − qtyOut)` per item against `currentStock`, so a drift would be invisible. **AUD-129 (P2)** — a nightly reconciliation query is cheap and would catch any future bug immediately |
| Dates are `DateTime` with no timezone | `new Date(req.body.date)` interprets a bare `'2026-01-15'` as UTC midnight, then reports format it with `dayjs().format('DD-MM-YYYY')` in server-local time. For an IST deployment reading UTC-stored dates this can shift a document's printed date by one day around midnight. **AUD-130 (P2, NEEDS LIVE DB to confirm)** |
| Currency | INR only, no currency column. Fine for a single-country business; a blocker if that ever changes |
