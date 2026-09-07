# UTech ERP — Backend

Express + Prisma + MySQL backend for U-Tech Automation Industries ERP.

## Setup

```bash
cd backend
cp .env.example .env
# edit .env -> set DATABASE_URL to your MySQL instance

npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed     # creates roles, permissions, admin user
npm run dev
```

Server runs at `http://localhost:4000`.

Default login:
- email: `admin@utech.local`
- password: `Admin@123`

## API quick-tour

```
POST  /api/auth/login            { email, password }     -> { token, user }
GET   /api/auth/me               (Bearer token)
POST  /api/auth/otp/request      { email, purpose }
POST  /api/auth/otp/verify       { email, code, purpose }

GET   /api/users
GET   /api/roles
GET   /api/parties?type=CUSTOMER&q=acme
GET   /api/items?lowStock=1
GET   /api/invoices?status=ISSUED&from=2026-01-01
GET   /api/invoices/:id/pdf      -> streams a PDF
POST  /api/invoices              { partyId, date, lines:[{...}], isIntraState }
POST  /api/invoices/:id/payments { date, amount, mode }

POST  /api/quotations            (same shape as invoice)
POST  /api/quotations/:id/convert -> creates an invoice

POST  /api/jobcards              { date, partyId, lines, operations }
POST  /api/jobcards/:id/revert   { reason }

POST  /api/jobwork               (challan with stock-out)
POST  /api/jobwork/:id/receive   { lines:[{id, qtyReceived}] }

POST  /api/dispatch              (challan with stock-out)
POST  /api/dispatch/:id/status/DELIVERED

GET   /api/dashboard/summary
```

All endpoints (except `/api/auth/*` and `/health`) require `Authorization: Bearer <token>`.
Permission gates use the `<module>.<action>` keys from the permissions table.

## Note on third-party integrations

Email (nodemailer), WhatsApp/SMS providers, and Tally export are **not wired**.
OTP requests log the code to the server console in dev mode (and return it in JSON
when `NODE_ENV !== 'production'`) so QA can test flows.
