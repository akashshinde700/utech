# Full audit pass — 28 Oct 2026

Branch `audit/full-erp-2026-10-28`, from `bc205ff`.

Five previous passes (`BUG_TRACKER.md`, `HARDENING_2026-10-27.md`,
`FINAL_AUDIT_2026-10-28.md`, `VERIFICATION_2026-10-28.md`) had already worked
through the controller and UI layers, and they were thorough — re-reading the
authorization guards, the stock service and the money maths turned up nothing
new. What every one of those passes says it could **not** do is the same two
things: run against a real MySQL, and in some cases, run a real browser. Both
were available here, and that is where this pass went.

**Headline: the production database does not match `schema.prisma`, and has not
since the first migration.** Everything else below is smaller.

Baseline before any change: backend 901 tests, frontend 187, e2e 41 passed /
1 skipped, both lints clean, build passing.
After: **backend 951, frontend 192, e2e 41 + 1 skipped**, lints clean, build
passing, and a real MySQL built from an empty schema with **zero drift**.

---

## 1. Schema drift in production — P1

`prisma migrate deploy` was run against an empty MySQL 8.0.45, replaying all 43
migrations, and the result compared with the data model:

```
npx prisma migrate diff --from-url <that database> --to-schema-datamodel prisma/schema.prisma
```

It was **not empty**. Three things, all originating in the hand-written
`20260504133809_init` migration:

| What | Declared in `schema.prisma` | Actually in the database |
|---|---|---|
| `BomItem.itemId` to `Item` | required relation (FK, RESTRICT) | **no foreign key at all** |
| `Bom.finishedItemId` to `Item` | optional relation (FK, SET NULL) | **no foreign key at all** |
| `StockLedger.itemId`, `JobcardLine.itemId`, `JobworkLine.itemId`, `PurchaseOrderLine.itemId`, `GrnLine.itemId` | optional relation, so `ON DELETE SET NULL` | `ON DELETE RESTRICT` |
| `JobcardOperation.updatedAt` | `@updatedAt`, no database default | `DEFAULT CURRENT_TIMESTAMP(3)` |

Confirmed directly in `information_schema`, not just from Prisma's opinion.

**Why it matters.** The missing BOM foreign keys are the real defect: nothing
stopped a BOM line from referencing an item id that does not exist. Demonstrated
on the live-equivalent database — before the fix the insert below succeeded,
after it is refused:

```
INSERT INTO bomitem (bomId, itemId, qty) VALUES (1, 999999, 1);
ERROR 1452 (23000): Cannot add or update a child row: a foreign key constraint
fails (CONSTRAINT `BomItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `item` (`id`))
```

The five RESTRICT/SET NULL mismatches change no behaviour today, because
`DELETE /api/items/:id` deactivates rather than deletes, so no hard delete ever
reaches them. They matter because they kept the migration state untrustworthy:
with a non-empty diff, `prisma migrate dev` on any developer machine invents a
"fix the drift" migration of its own, and `prisma db pull` disagrees with the
checked-in schema.

**Fix.** One migration,
`20261028100000_fk_integrity_and_return_line_indexes`, adds the two missing
foreign keys, aligns the five delete rules, and clears the two cosmetic
leftovers. Verified twice: applied to an already-migrated database (the
production path) and replayed from an empty one (the new-environment path).
`migrate diff --exit-code` now exits 0 both ways.

**Before deploying it**, run `npm run db:check-integrity` (new, below) — an
orphan `BomItem` row would make the first statement fail, which is deliberate:
such a row needs looking at, not silently rewriting.

**Guarded by** a new CI job (`migrations`) that replays every migration against
a MySQL service container and fails the build on any diff. This class of bug
cannot come back silently.

## 2. Nothing re-derived the three cached totals — P2 (AUD-129)

Three numbers are caches of a sum stored elsewhere:

```
Item.currentStock   = sum of COMPANY StockLedger (qtyIn - qtyOut)
Invoice.amountPaid  = sum of InvoicePayment.amount
CustomerMaterialLot = sum of its own StockLedger rows
```

Every write path keeps them in step, which is exactly why a drift would be
invisible — nothing ever recomputed the cached figure and compared. A bad
import, an interrupted migration or one manual `UPDATE` leaves the ERP
reporting a stock figure its own ledger does not support, and the first person
to find out is whoever counts the rack.

**Added** `src/services/integrityCheck.js` (pure functions) and
`npm run db:check-integrity`. It also checks the id columns that have no foreign
key behind them (`SalesReturnLine.invoiceLineId`, `PurchaseReturnLine.grnLineId`,
`Jobcard.itemId`, `Project.partyId`, `DispatchChallan.invoiceId`,
`BomItem.itemId`) for orphans, and invoice status against amount paid.

Read-only by design, exit code 1 on drift so it can gate a deploy. It never
writes a correction: a stock figure that disagrees with its ledger is a question
about what happened on the floor, and a script cannot guess the answer.

Verified against the seeded real database — clean. Then two drifts were injected
by hand and both were caught:

```
[DRIFT] Item.currentStock vs company stock ledger — 1
        {"itemId":2,"code":"IT-0002","stored":185,"derived":180,"diff":5}
[DRIFT] Invoice.amountPaid vs recorded payments — 1
        {"invoiceId":1,"number":"INV-1001","stored":999.5,"derived":5000,"diff":-4000.5}
```

17 unit tests, including the decimal-scale cases (0.1 + 0.2 must not be reported
as a drift) and the rule that customer-owned material never counts toward
`Item.currentStock`.

## 3. The night shift fell out of its own day's report — P2 (AUD-130)

Previously filed as "needs a live DB to confirm". Confirmed, and it is real on
any server not running at UTC.

Reports filter with `dateRangeFilter(?from, ?to)`, which built **UTC** midnight
bounds, and then print each row's date with `dayjs(row.date).format('DD-MM-YYYY')`,
which is **server-local**. On the IST machine this plant runs on, the two
disagree for any row carrying a real time of day — and `StockLedger.date`
defaults to the moment of the movement:

```
server timezone offset  : 5.5 h
movement stored as      : 2026-10-27T21:30:00.000Z   (3am local on the 28th)
report prints it as     : 28-10-2026
OLD (UTC day) includes  : false      <- missing from the 28 Oct report
NEW (local day) includes: true
```

So a movement posted at 3am showed the 28th in the sheet while being counted
under the 27th — every night-shift movement, silently.

**Fix.** `dateRangeFilter` now builds the day's bounds in the server's own
timezone, so the bucket always matches the printed date, on any server. An
explicit ISO timestamp still means that instant, unchanged. An impossible date
(`2026-02-30`) is still a 400 rather than rolling forward to 2 March.

12 new tests, written without naming a timezone so they hold both on a UTC CI
runner and on the IST machine. Two existing tests that hard-coded UTC bound
strings were rewritten the same way — they were only ever passing because
`toISOString()` hides the question.

## 4. First load shipped the entire ERP to every phone — P2 (AUD-108)

Measured on the real build, counting only what `index.html` tells the browser to
fetch before anything renders:

| | JS files preloaded | Bytes |
|---|---|---|
| Before | **36** | **1,738,914** |
| After | **2** | **333,619** |

81% less, 1.4 MB saved, on a system used from the shop floor on phones. The
526 kB charting library was in that first load even for a user who never opens a
chart.

Two things were wrong. `App.jsx` imported all 63 page modules statically, and
`vite.config.js` then tried to compensate with `manualChunks`. Hand-grouping
made it worse: grouping application code per page folder meant any module shared
between the shell and a page landed in that page's chunk, so the entry depended
on it and the page was preloaded anyway — and grouping `node_modules` into a
`vendor` chunk made `vendor` import the `charts` chunk, which is how 526 kB of
charts ended up in the login screen's critical path.

**Fix.** Every route is `lazyPage(() => import(...))`; `manualChunks` is gone so
the bundler follows the real import graph. The `<Suspense>` boundary sits inside
`AppLayout`, around the content only, so the sidebar and header stay on screen
instead of the whole app blinking out on every navigation.

Lazy loading introduces two failure modes a single bundle did not have: the
phone is offline, or a deploy replaced the chunk an open tab is still asking
for. Both reject the `import()`, and React would hand that to the error boundary
as a blank "Something went wrong". `lazyPage` retries once (a deploy race
usually succeeds the second time) and then renders a page that says what
happened with a reload button.

**One honest consequence:** before, the first visit downloaded every page, so
the service worker cached them all and any screen would open offline. Now only
visited screens are cached. Offline the app was never usable anyway — all data
comes from `/api/`, which the worker deliberately never caches — but an unvisited
route now shows the "could not load this page" card instead of a data error.

Verified in a real browser: all 41 e2e tests still pass, including the mobile
drawer, the seven phone and tablet viewports and the full inward to job card to
certificate to invoice walkthrough. Locked in by
`tests/unit/routeSplitting.test.js`, which fails if a page is imported
statically again.

## 5. The money routes with no schema behind them — P2 (part of AUD-115)

AUD-115 reported "54 write routes have no `validate()`". Re-counted: 139 write
routes, 50 without a schema — but **26 of those are DELETEs with no body**,
where a body schema would validate nothing, and most of the rest are action
endpoints (`/:id/approve`, `/read-all`) that take no body either. The count was
inflated.

What was genuinely unguarded and genuinely mattered: **expenses**, the only
money-writing routes with no schema. The controller does whitelist which keys it
copies, so nothing could be mass-assigned — what was missing was any check that
the values in those keys were numbers.

Seven failures, each written as a test before the fix:

| Request | Was | Now |
|---|---|---|
| `POST` `amount: "twelve hundred"` | 500 from the database (`Number("...") <= 0` is false, so the hand-written guard read it as valid) | 400 |
| `POST` `taxAmount: -270` | accepted | 400 |
| `POST` `amount: 1500.125` | accepted into a `DECIMAL(14,2)` column | 400 |
| `POST` `category: "Mterial"` | accepted — became its own slice in the category summary chart | 400 |
| `PUT` `amount: -5000` | **accepted** — a negative expense quietly reduced the reported cost total | 400 |
| `PUT` `amount: "five thousand"` | 500 | 400 |
| `PUT` `description: ""` | accepted | 400 |

`PUT /api/expenses/:id` ran no checks at all, not even the two the create route
had. Fixed with `validators/expense.schema.js` (create plus a
`partialNoDefaults` update, so an edit that only sets `notes` still leaves the
amount alone), wired into both routes. 13 tests.

## 6. Two indexes the return guards needed

Both return flows cap a return at the quantity actually invoiced or received by
aggregating prior return lines for that source line — once per line, inside the
create transaction. `SalesReturnLine.invoiceLineId` and
`PurchaseReturnLine.grnLineId` are logical foreign keys (plain `Int`, no
relation), so neither had an index and that guard scanned the whole table while
holding the transaction open. Both are now indexed, in the same migration.

AUD-124 claimed seven missing foreign-key indexes. Checked each against
`information_schema`: `AuditLog(entity, entityId)` and
`Attachment(refType, refId)` already have composite indexes that serve their
queries, and the rest of the flagged columns (`Project.partyId`,
`GrnLine.poLineId`, `Jobcard.itemId`, `DispatchChallan.invoiceId`,
`ProjectTask.parentId`, the `*ById` columns) are never filtered on anywhere in
the code. Two real, five not — no index was added without a query to justify it.

## 7. Backup and restore — P1 (ops, AUD-127)

This is the financial record of a manufacturing business, there was no
documented procedure, and the production database has already been emptied once
with no backup taken.

Added `backend/scripts/backup.sh`, `backend/scripts/restore.sh` and
`docs/BACKUP_AND_RESTORE.md`. The scripts read `DATABASE_URL` — the variable the
app already uses — so there is no second place holding credentials, and they
back up the uploaded files as well: the database stores only filenames, so a
database-only backup restores an ERP whose drawings all 404.

**Drilled end to end**, not just written:

| Step | Result |
|---|---|
| 43 migrations replayed into an empty database, then seeded | applied, no error |
| Row counts before the dump | 83 items, 82 ledger rows, 5 invoices, 43 migration records |
| `DROP DATABASE`, then restore from the dump | same 83 / 82 / 5 / 43 |
| `prisma migrate status` on the restored database | **Database schema is up to date!** — no re-migration needed |
| `prisma migrate diff` against the data model | empty |
| `db:check-integrity` on the restored data | reported the two drifts injected before the dump, proving the copy is faithful |

On down-migrations (AUD-126): the documented answer is deliberately that there
are none. A hand-written `DROP COLUMN` run under pressure destroys the data the
column held. The procedure is to take a backup before `migrate deploy` — one
command, and the whole rollback plan — and otherwise to roll *forward*.

## 8. Smaller items

- **AUD-110** — `frontend/public/robots.txt` (`Disallow: /`) plus an
  `X-Robots-Tag: noindex, nofollow, noarchive` header on every response,
  including the 401s a crawler following a bookmark would get. An indexed login
  page on a public domain is an invitation to credential stuffing.
- **AUD-111** — a rate limit on `/api/reports`, the endpoints that each run a
  wide query or render a document and are the obvious way to tie up a single API
  process (60 per 5 minutes in production; generous for a person, useless to a
  script). Deliberately **not** an API-wide IP limit: the whole plant reaches
  the server from one NAT address, so that would be an outage waiting to happen.
- **AUD-109** — `REFRESH_EXPIRES_IN` was read into config and used nowhere,
  which invites whoever sets up the server to tune a value that changes nothing.
  Removed from `config/env.js` and replaced in `.env.example` with a line saying
  there are no refresh tokens.
- **AUD-113** — 17 permission keys (not 16) are seeded and grantable in the UI
  but gate nothing, so an admin ticks "Stock then Create" and nothing happens.
  Pinned in `tests/security/permissionKeyContract.test.js` with the reason for
  each, so a new dead key fails CI and wiring one up has to be deliberate. The
  mirror check — a route requiring a key no role can be granted — is clean.
  **Two of the 17 need your decision, see below.**
- **AUD-119 (extension)** — CI gained the two jobs that would have caught
  today's findings: a MySQL migration-replay-and-diff job, and the Playwright
  e2e suite.
- **AUD-128** — the `Expense.category` comment listed five categories while the
  form offers seven; the schema now enforces the seven the form offers and the
  comment matches.
- `tests/helpers/routeInventory.js` threw on any `app.use('/api/...', x)` whose
  second argument was not a router, which the new rate limiter is. It now skips
  middleware mounts.

## 9. Verified, not changed

- **Authorization.** `requireAuth` then `requirePermission` on every route, the
  privilege-escalation guards in `user.controller.js` (a Department Head cannot
  mint another Department Head or reset a password), `scopeToDepartment`
  enforced in 11 controllers. The 564-case authorization matrix is green.
- **Stock.** `moveCompanyStock` is the single writer of `Item.currentStock`, its
  conditional `updateMany` decrement is the concurrency guard, and the customer
  lot path never touches company stock. `Item.currentStock` set from
  `openingStock` does write its `OPENING` ledger row (checked — the invariant
  holds in the controller, the seed and the inventory import).
- **Item weight** still agrees with the metal calculator exactly.
- **Real browser, 41 e2e tests**: mobile drawer, seven viewports, sidebar
  collapse, inward to job card to certificate to invoice, invoice PDF, XLSX
  exports, GRN cancel, over-return caps.

## 10. Needs your decision

1. **`assignment.delete` and `vendorWorkOrder.delete`.** Both DELETE routes are
   gated on `.update`, so anyone who may edit may also delete, and the separate
   "delete" checkbox in the Roles screen does nothing. Should deleting an
   assignment or a vendor work order need its own permission? That is a decision
   about who may do what in the plant, so it was not changed quietly. The other
   15 dead keys describe actions the API has no endpoint for at all and are
   harmless, but they could be dropped from the seed so the Roles screen stops
   offering them.
2. **Password reset still does not work.** `nodemailer` is installed, OTP
   delivery only `console.log`s, and `verifyOtp` issues a token only for
   `purpose: 'login'`, so even a manually read code would not complete a reset.
   The login page honestly tells users to contact an admin. Wiring real mail
   delivery needs SMTP credentials — an infrastructure decision.
3. **The shared passwords.** `Admin@123` and `Akash@789` are still live on the
   accounts created this month.

## 11. Still not verified here

- **A real Android or iPhone**: install to the home screen, the update toast on
  an actual deploy, touch. Emulated viewports are not a phone.
- **The production server's timezone.** The date fix is correct on any
  timezone, so this is no longer a correctness question, but the backend should
  be run with an explicit `TZ` (`TZ=Asia/Kolkata`) so the printed day is the
  plant's day whatever the host is set to.
- **Colour contrast** and **touch-target sizes** — still unmeasured (AUD-122,
  AUD-123).
- **Physical printing on paper.** The certificate and invoice were verified as
  PDFs (A4, 595x842pt) in an earlier pass, not on a printer.

## 12. Deploying this

1. `./scripts/backup.sh /var/backups/utech` — the migration in this pass adds
   foreign keys, so a backup is not optional.
2. `npm run db:check-integrity` on production **before** migrating. If it
   reports an orphan `BomItem` row, look at that row first; the migration is
   designed to fail rather than rewrite it.
3. `npx prisma migrate deploy` — one new migration,
   `20261028100000_fk_integrity_and_return_line_indexes`. It adds two foreign
   keys, rewrites five delete rules and creates two indexes; on tables this size
   it is near-instant.
4. `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`
   must exit 0.
5. `cd frontend && npm ci && npm run build`. The first load after this is a
   different set of files, so the service worker will offer the update toast;
   one accepted reload per user.
6. `npm run db:check-integrity` again, and `curl -fsS https://www.lastrivon.tech/health`.
7. Run the backend with `TZ=Asia/Kolkata` so report days are plant days.
8. **Rollback:** restore the step-1 backup and check out the previous commit.
   The restored `_prisma_migrations` will not list the new migration, so code
   and database agree again. The frontend change is code-only.

## 13. Files changed

**Backend** — `prisma/migrations/20261028100000_fk_integrity_and_return_line_indexes/migration.sql`
(new), `prisma/schema.prisma` (two `@@index`, one corrected comment),
`src/services/integrityCheck.js` (new), `prisma/checkIntegrity.js` (new),
`src/utils/dates.js` (local-day bounds), `src/validators/expense.schema.js`
(new), `src/routes/expense.routes.js`, `src/server.js` (robots header, export
limiter), `src/config/env.js`, `.env.example`, `package.json`
(`db:check-integrity`), `scripts/backup.sh` and `scripts/restore.sh` (new).

**Backend tests** — `tests/unit/integrityCheck.test.js` (new, 17),
`tests/unit/reportDateBuckets.test.js` (new, 12),
`tests/api/expenseValidation.test.js` (new, 13),
`tests/api/crawlerAndExportLimits.test.js` (new, 5),
`tests/security/permissionKeyContract.test.js` (new, 3),
`tests/api/integrity2026-10-27.test.js`, `tests/api/stockAndBillingSafeguards.test.js`
(timezone-agnostic), `tests/helpers/routeInventory.js`.

**Frontend** — `src/App.jsx` (63 lazy routes, `lazyPage`, `PageUnavailable`),
`src/components/layout/AppLayout.jsx` (`Suspense` plus `RouteLoading`),
`vite.config.js` (`manualChunks` removed), `public/robots.txt` (new),
`tests/unit/routeSplitting.test.js` (new, 5),
`tests/routing/restrictedNav.test.jsx` (awaits lazy pages).

**Other** — `.github/workflows/ci.yml` (migrations and e2e jobs),
`docs/BACKUP_AND_RESTORE.md` (new), this report.

## 14. Commands run

```
backend   npm test            -> 34 files, 951 passed   (was 901)
          npm run lint        -> exit 0
frontend  npm test            -> 20 files, 192 passed   (was 187)
          npm run lint        -> exit 0
          npm run build       -> pass; initial JS 36 files/1,738,914 B -> 2 files/333,619 B
e2e       npx playwright test -> 41 passed, 1 skipped (real Chrome 141, Windows)
MySQL     prisma migrate deploy on an empty 8.0.45 schema  -> 44 migrations applied
          prisma migrate diff --exit-code                  -> 0 (no drift)
          npm run prisma:seed                              -> 73 inventory items, totals reconciled
          npm run db:check-integrity                       -> all checks OK
          backup -> DROP DATABASE -> restore -> migrate status -> integrity  -> all verified
```

The one skipped e2e test is the PWA offline spec, which runs only with
`E2E_PWA=1` against a production build; it was verified separately in the
previous pass.
