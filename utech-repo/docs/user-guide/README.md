# U-Tech ERP — Hinglish user manual (with screenshots)

**[Utech-ERP-User-Guide-Hinglish.docx](./Utech-ERP-User-Guide-Hinglish.docx)** — the
printable manual: 19 chapters + 3 appendices, 50 annotated screenshots, written in
Hinglish for someone who has never used an ERP before.

Start reading at "0. Shuru karne se pehle", or jump to the chapter for the job at hand
(GRN, dispatch, invoice, production, jobwork, reports, admin …). Every screenshot has
orange boxes with numbers, and the legend under the picture says which field each number
is.

## What is inside

| Part | Contents |
| --- | --- |
| Cover + contents | What the guide is, how to read it, the 3 rules that matter most |
| 0–3 | What an ERP does, who does which job, login, menus, master data, stock ledger and adjustments |
| 4–6 | Purchase: PO → approval → GRN. Sales: dispatch challan, invoice, GST split, payment |
| 7–8 | Production (BOM, batch start/complete) and customer-owned material / jobwork |
| 9–13 | Returns, reports, users & permissions, Metal Calculator, Ctrl+K search, mobile |
| 14–15 | Daily checklists per role, and one complete worked example with expected stock after every step |
| 16–18 | 20 FAQs (problem → fix), safety rules, where to get help |
| Appendices | Screen map (menu → page → URL), glossary, screenshot index |

## How the screenshots were made

Nothing is hand-drawn or mocked — the pictures come from the running application.

```bash
cd frontend
SHOTS_DIR=../docs/user-guide/screenshots \
  npm run test:e2e -- user-guide-capture.spec.js
```

* [`frontend/e2e/user-guide-capture.spec.js`](../../frontend/e2e/user-guide-capture.spec.js)
  logs in to the seeded demo database, performs a full workflow (creates a customer,
  vendor, two items, a PO, a GRN, a dispatch, an invoice with a payment, a BOM, a
  production batch and a customer-material lot) and saves one PNG per step plus a
  `manifest.json` of captions.
* The spec is documentation tooling, not a regression test. It writes records, so it is
  meant for the disposable in-memory demo (`E2E_USE_DEMO=1`), never for real data.
* Screenshots are captured at 1440 px wide with a 2x device scale, then downscaled to
  1x for the document so the text stays sharp when printed or zoomed.

## How the document was built

```bash
pip install python-docx pillow
python3 docs/user-guide/build_docx.py
```

[`build_docx.py`](./build_docx.py) holds the entire text of the manual. It reads
`screenshots/manifest.json`, frames each picture, numbers it ("Chitra 12 — …"), and
writes `Utech-ERP-User-Guide-Hinglish.docx` (A4, brand colours, page numbers, header).
The source text is Hinglish on purpose — edit the Python strings and rebuild; the
screenshot captions live in the Playwright spec.

## Keeping it correct

The manual describes behaviour that the code enforces, so when a flow changes:

1. update the wording in `build_docx.py` (and the caption in the spec),
2. re-run the capture spec so the screenshot shows the new screen,
3. re-run `build_docx.py`.

Facts worth re-checking after a release: GST split (intra/inter state), whether invoice
still says "Billing does not move stock", the adjustment/GRN cancel rules in chapter 3,
and the roles/permission list in chapter 11.
