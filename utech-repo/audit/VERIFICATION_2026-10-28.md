# Verification Report — 2026-10-28 (browser + hand-calculation pass)

Branch `arena/8b1c94d6-utech`. This pass exists because the previous one verified
the sidebar/theme in jsdom only. Everything below was executed in a real
Chromium (Playwright + @sparticuz/chromium) against the isolated in-memory
demo stack. New permanent tests: `frontend/e2e/manual-verification.spec.js`,
`backend/tests/api/listOrdering.test.js`. Screenshots:
`audit/evidence-2026-10-28/dashboard-expanded.png`, `dashboard-collapsed.png`.

## 1. UI — sidebar collapse/expand, content resize, blank space

**Actually tested** (`manual-verification.spec.js`, real browser, 1440×900):
expanded sidebar 248px → collapse → 64px rail; main content width grows by
>150px (content truly reclaims the space); rail links keep `title` tooltips +
accessible names; collapsed state survives navigation to /items **and** a full
reload (`localStorage`); expand restores 248px.

**Blank space:** on `/`, `/items`, `/invoices`, `/reports`, `/quality`,
`/stock` the test measures `scrollHeight` vs the real content bottom — the
scroll area never extends >48px past the content (shell padding). No phantom
blank scroll area on any checked page. Mobile 390px: drawer opens/closes,
horizontal overflow ≤1px.

**Found in screenshots & fixed:** (a) collapsed header squeezed logo + toggle
into 64px and clipped — now stacked; (b) expanded subtitle
"MANUFACTURING WOR…" truncated — smaller tracking/size, no truncation;
(c) dashboard hero banner was still teal `#153443` — now deep violet `#2a1656`
with violet accents. Re-screenshotted after the fix.

## 2. Business logic — inward → job cards → certificate → invoice

**Actually tested** end-to-end (API through the browser session + UI pages):
GRN inward (vendor) → item stock; two job cards for the customer; customer
material inward lot → reservations to both cards → release → consume; quality
check with certificate number against job card A; invoice to the customer;
dispatch; full payment. Over-reservation (31 > remaining 30) correctly
refused with 400. Certificate page renders the job-card number and cert no.

**One expectation of mine was wrong, system was right:** I first expected
`/consume` to reduce reserved qty. The documented rule (and UI flow) is
"release the reservation, then move the material" — after release + consume
the numbers reconcile exactly. My test was corrected, not the code.

## 3. Calculations — hand-checked sample (paper first, then asserted)

| Step | Hand calculation | System |
|---|---|---|
| GRN | 100 received − 5 rejected = **95** stock | 95 ✓ |
| Lot reservations | 100 − 40 (card A) − 30 (card B) = **30 pcs**; 50 − 20 − 15 = **15 kg** unallocated | 30 / 15 ✓ |
| Consume | release A, consume 25/10 → on-hand **75 pcs / 40 kg**, reserved **30/15**, unallocated **45/25** | exact ✓ |
| Invoice | 40×250 + 10×100 = 11,000; −500 discount → taxable 10,500; GST 18% = **1,890** (CGST 945 + SGST 945, IGST 0); total **12,390** | exact ✓ |
| Stock after invoice | billing must not move stock: **95** | 95 ✓ |
| Dispatch 40 | 95 − 40 = **55**; ledger independently re-summed (Σ in − out) = 55; running balances [95, 55] | exact ✓ |
| Payment | pay 12,390 → PAID; party ledger debit/credit match in prior suite | ✓ |

## 4. Print / Excel — files actually inspected, not just clicked

- **Certificate print:** Chromium print-to-PDF of `/quality/:id/certificate` —
  parsed with pdfjs: contains certificate no, job-card no, inspector, PASS;
  page size 595×842pt (A4); **no sidebar/UI text** in the PDF.
- **Invoice PDF** (`GET /api/invoices/:id/pdf`): parsed — invoice number,
  customer name and ₹12,390 total present.
- **Invoices Excel:** downloaded **by clicking the Reports page button**
  (real download event), opened with ExcelJS: my invoice row found,
  Total = Paid = 12,390.
- **Stock-ledger Excel:** GRN row (In 95, balance 95) and DISPATCH row
  (Out 40, balance 55) for the test item present and correct.

## 5. Bug found & fixed: newly saved records could vanish to page 2

The pre-existing E2E suite failed 1 test on merged main:
`invoice … do not move stock` timed out waiting for row `INV-26-00007`.
Root cause (real UX bug, not a flaky test): every list endpoint sorted by a
single non-unique key (`date`) with **no tiebreaker**; all documents share
today's date, so ordering was undefined and a just-saved invoice landed on
page 2 — the user returns to a list that does not show their new record.
Fix: all 25 list queries now use `[{sortBy}, {id}]` (newest-first under
desc). Regression tests: `backend/tests/api/listOrdering.test.js` (12
same-date invoices come back strictly newest-first across pages) + the
previously failing Playwright test now passes.

## 6. Test results — exact

| Suite | Before this pass | After |
|---|---|---|
| Playwright E2E (`npm run test:e2e`) | 26 passed, **1 failed** | **29 passed, 0 failed** (incl. 2 new) |
| Backend unit/API (`npm test`) | 900 passed | **901 passed** (+1 ordering) |
| Frontend unit (`npm test`) | 176 passed | 176 passed |
| Lint (backend + frontend) | clean | clean |
| Frontend build | pass | pass (pre-existing chunk-size warning only) |

**Failed during this pass (all resolved):** the page-2 invoice bug above;
my own wrong consume/reservation expectation (test fixed); a PDF-text
hyphen-wrap artifact in my assertion (assertion normalised — the printed
certificate itself was correct).

**Still not verified:** real MySQL (migrations, InnoDB isolation) — tests use
the in-memory adapter; physical printing on paper; colour-contrast audit;
backup/restore drill. Run the same suites against a staging MySQL before
production.
