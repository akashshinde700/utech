# UTech Automation Industries — ERP

Custom ERP for U-Tech Automation Industries. Monorepo with Express + Prisma backend and React + Vite frontend.

```
utech erp/
├── backend/   # Node.js + Express + Prisma + MySQL
└── frontend/  # React + Vite + Tailwind
```

## Quick start

**Backend**
```bash
cd backend
cp .env.example .env
# edit DATABASE_URL, JWT_SECRET in .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run dev
```
Backend runs at http://localhost:4000

**Frontend**
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at http://localhost:5173

Login: `admin@utech.local` / `Admin@123`

## Modules built

| Module | Backend | Frontend | Notes |
|---|---|---|---|
| Auth (login + OTP scaffold) | YES | YES | OTP logs to console in dev |
| User + Role + Permission matrix | YES | YES | 3 system roles seeded |
| Party (Customer/Vendor) + ledger | YES | YES | with GST/PAN, opening balance |
| Item master + UoM + Category | YES | YES | with stock + low-stock filter |
| Machine master | YES | partial | CRUD only |
| Process master | YES | YES | new |
| Quotation + convert-to-invoice | YES | partial | API only, no list page |
| Invoice + line items + GST + payment + PDF | YES | YES | pdfkit-based |
| Jobcard with materials + operations + revert | YES | YES | |
| Jobwork challan + auto stock OUT/IN | YES | YES | |
| Dispatch challan + status flow | YES | YES | |
| Purchase Order + approve/reject | YES | YES | new — pending approval workflow |
| GRN + auto stock IN + PO status rollup | YES | YES | new |
| Quality Inspection + parameters | YES | YES | new |
| Project + Tasks (manual stages) | YES | YES | new — basic, no BOM stepwise yet |
| Expense management + category summary | YES | YES | new |
| File Attachments (multer) | YES | hooks ready | new — 100/record limit, UI hooks pending |
| XLSX exports (invoices, jobcards, items, expenses) | YES | YES | new |
| Audit log helper + auto-write | YES | n/a | new — wired into new controllers; old controllers can be retrofitted |
| Dashboard summary | YES | YES | |

## API surface (21 mounted routes)

```
/api/auth, /api/users, /api/roles
/api/parties, /api/items, /api/machines, /api/processes
/api/quotations, /api/invoices
/api/jobcards, /api/jobwork, /api/dispatch
/api/purchase-orders, /api/grns, /api/quality
/api/projects, /api/expenses
/api/attachments, /api/reports
/api/dashboard
```

## NOT built (intentional — flagged for client conversation)

These were in the original quote but need business decisions / external credentials before they can be built. Don't promise these to the client without scoping:

1. **Tally export / append** — needs Tally version + sample XML from client
2. **Batch manufacturing + production planning + shift-wise reports** — needs schema design with shift schedule, machine utilization formulas
3. **BOM stepwise + Project budget allocation** — DB ready (`Bom`, `BomItem`, `Project.budget`), no UI yet
4. **Sales returns / Purchase returns / Back orders** — workflow not designed
5. **WhatsApp / SMS integration** — needs MSG91/Twilio account
6. **Email send (nodemailer)** — needs SMTP credentials
7. **Audit log retrofit** — `audit()` helper exists, only newer controllers call it; older ones (auth/invoice/jobcard) need it added

## Honest status before client demo

- Demo flow (login → masters → invoice → jobcard → PO → GRN → quality → reports) works end-to-end
- DB migrations need to be run for the first time on real MySQL — schema is validated, 30 models / 37 relations consistent
- Frontend builds with `npm run build` — uses `lucide-react` for icons and `clsx`/`zustand` for state
- No automated tests — add at minimum: invoice GST math, jobwork stock-ledger consistency, PO/GRN stock IN
- PDF is functional but not designed (no logo, no letterhead) — swap pdfkit for Puppeteer + HTML template if you need pixel-perfect

## Architecture quick notes

- Money: `Decimal(14,2)` everywhere; `gst.js` util handles rounding
- Stock: every change writes a `StockLedger` row in the same transaction as the `Item.currentStock` update — full audit trail
- Doc numbers: `INV-26-00001`, `PO-26-00001` etc. via `numbering.js` — simple max+1 lookup, fine for single-process dev. For production under load, use a DB sequence or row-locked counter.
- Permission keys: `<module>.<action>` (e.g., `invoice.create`). `SUPERADMIN` bypasses all checks. Seed creates SUPERADMIN, MANAGER, OPERATOR.
