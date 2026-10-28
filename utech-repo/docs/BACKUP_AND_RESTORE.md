# Backup and restore

This ERP is the financial and production record of the plant: invoices,
payments, the stock ledger, job cards, quality certificates. None of it can be
reconstructed from the repository. This page is the procedure for backing it up
and for getting it back, with the exact commands — they were run end to end
against a real MySQL 8 before this was written (see **The drill** below).

There was no documented procedure before this (AUD-127), and the production
database has already been emptied once, deliberately, with no backup taken.

## What has to be backed up

| | Where it lives | Why |
|---|---|---|
| **Database** | MySQL, the schema in `DATABASE_URL` | every document, every ledger row, every user |
| **Uploaded files** | `UPLOAD_DIR` (default `backend/uploads`) | drawings, attachments, quotation images. The database stores only their filenames — restoring the database alone gives you an ERP whose drawings all 404 |

Not backed up, on purpose: `node_modules`, the frontend build, logs. Those come
from the repository and `npm ci`.

Secrets (`JWT_SECRET`, the database password, the SSH credentials) are **not**
part of the backup and must never be committed. Keep them where they already
are, outside the repository. A restored database with a different `JWT_SECRET`
simply signs everyone out, which is harmless.

## Taking a backup

On the server:

```bash
cd /path/to/utech-repo/backend
set -a; . ./.env; set +a          # DATABASE_URL and UPLOAD_DIR
./scripts/backup.sh /var/backups/utech
```

It writes two files and prints their sizes:

```
database -> /var/backups/utech/utech-20261028-140000.sql.gz
uploads  -> /var/backups/utech/utech-uploads-20261028-140000.tar.gz
```

`mysqldump --single-transaction` is used, so the dump is consistent **without**
locking the plant out of the ERP while it runs. `_prisma_migrations` is an
ordinary table and is included, which is what lets a restored database know
which migrations it already has.

The script deletes its own files older than 14 days. That is the entire
retention policy — change the `-mtime +14` in `scripts/backup.sh` deliberately,
not by accident.

### Automate it

```bash
sudo crontab -e
# 02:30 every day
30 2 * * * cd /path/to/utech-repo/backend && set -a && . ./.env && set +a && ./scripts/backup.sh /var/backups/utech >> /var/log/utech-backup.log 2>&1
```

A backup that lives only on the same VPS as the database is not a backup — one
failed disk takes both. Copy the directory off the machine (`rclone`, `scp` to
another host, or an object-storage bucket) as a second cron line.

## Restoring

```bash
cd /path/to/utech-repo/backend
set -a; . ./.env; set +a

# 1. stop the API so nothing writes into a half-restored schema
sudo systemctl stop utech-api        # or: pm2 stop utech-api

# 2. restore the database (asks you to type the database name)
./scripts/restore.sh /var/backups/utech/utech-20261028-140000.sql.gz

# 3. restore the uploaded files
tar -xzf /var/backups/utech/utech-uploads-20261028-140000.tar.gz -C /path/to/utech-repo/backend

# 4. verify BEFORE letting anyone back in
npx prisma migrate status            # must end with "Database schema is up to date!"
npm run db:check-integrity           # must report every cached total as OK

# 5. start the API
sudo systemctl start utech-api
curl -fsS https://www.lastrivon.tech/health
```

Step 4 is the part that is usually skipped and is the only reason to trust the
restore. `prisma migrate status` proves the schema matches the code that is
about to run against it; `db:check-integrity` re-derives `Item.currentStock`
from the stock ledger and `Invoice.amountPaid` from the recorded payments and
reports anything that does not add up.

## Rolling back a deployment

**Code-only release (no new migration).** Check out the previous commit,
rebuild, restart. Nothing to undo in the database.

**Release with a migration.** There are no down-migrations in this project
(AUD-126), and there deliberately will not be: a hand-written `DROP COLUMN`
executed under pressure destroys the data the column held. The procedure is:

1. Take a backup **before** running `prisma migrate deploy`. Always. It is one
   command and it is the whole rollback plan.
2. To roll back, restore that backup and check out the matching commit. The
   restored `_prisma_migrations` table will not list the new migration, so the
   old code and the database agree again.
3. If the migration already ran and the data must be kept, roll *forward* with
   a new migration that corrects it, rather than reversing the old one.

A migration is therefore the point at which a backup stops being optional:

```bash
./scripts/backup.sh /var/backups/utech && npx prisma migrate deploy
```

## The drill

Run this on a copy, not on production. It is how the commands above were
verified, and it is worth repeating after any change to the server:

```bash
# 1. a scratch database built from the migrations, then seeded
mysql -e "CREATE DATABASE utech_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
DATABASE_URL='mysql://user:pass@localhost:3306/utech_drill' npx prisma migrate deploy
DATABASE_URL='mysql://user:pass@localhost:3306/utech_drill' npm run prisma:seed

# 2. back it up, then destroy it
DATABASE_URL='mysql://user:pass@localhost:3306/utech_drill' ./scripts/backup.sh /tmp/drill
mysql -e "DROP DATABASE utech_drill"

# 3. restore and verify
DATABASE_URL='mysql://user:pass@localhost:3306/utech_drill' RESTORE_YES=1 \
  ./scripts/restore.sh /tmp/drill/utech-*.sql.gz
DATABASE_URL='mysql://user:pass@localhost:3306/utech_drill' npx prisma migrate status
DATABASE_URL='mysql://user:pass@localhost:3306/utech_drill' npm run db:check-integrity
```

Executed on 28 Oct 2026 against MySQL 8.0.45, with 43 migrations replayed from
an empty schema and the company-inventory seed loaded:

| Step | Result |
|---|---|
| 43 migrations from an empty database | applied, no error |
| Row counts before the dump | 83 items · 82 ledger rows · 5 invoices · 43 migration records |
| `DROP DATABASE`, then restore | same 83 · 82 · 5 · 43 |
| `prisma migrate status` on the restored database | **Database schema is up to date!** |
| `prisma migrate diff` against `schema.prisma` | empty — no drift |
| `db:check-integrity` | reported the two drifts that had been injected on purpose before the dump, proving the copy is faithful and the check works on restored data |

## What to do when the numbers look wrong

`npm run db:check-integrity` is read-only and safe to run on production at any
time. It never writes a correction, and that is deliberate: a stock figure that
disagrees with its own ledger is a question about what happened on the floor,
and the answer is not something a script can guess. Bring the ledger and the
physical count together, then post an `ADJUSTMENT` through the Stock screen so
the correction is itself recorded.
