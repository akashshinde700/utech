# UTech ERP — Frontend

React + Vite + Tailwind UI for the U-Tech Automation ERP.

## Setup

```bash
cd frontend
npm install
npm run dev
```

Dev server runs at `http://localhost:5173` and proxies `/api` and `/uploads` to the backend at `http://localhost:4000` (see `vite.config.js`).

## Production build

```bash
npm run build
npm run preview
```

## What's wired

- Login (with JWT in `localStorage`)
- Dashboard summary
- Users + Roles + Permissions matrix
- Parties (Customer/Vendor) — list/create/edit
- Items + lookups (UoM, category)
- Invoices — list/create/edit/view, GST calc, PDF download, payment recording
- Jobcards — list/create/edit/view + revert
- Jobwork — list/create + receive (auto stock-in)
- Dispatch — list/create + status flow

## Not wired (intentionally — needs business decisions / 3rd-party creds)

- WhatsApp / SMS / Email actual sending
- Tally export
- File upload UI for jobcards (backend Attachment model exists; UI deferred)
- Project-based manufacturing module screens (BOM/stages exist in DB; needs UX design)
- Reports export (XLSX) UI
