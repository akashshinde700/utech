# UTech ERP — UI / UX & Accessibility Audit

**Date:** 2026-10-17 · **Surface:** 88 `.jsx` files (63 page files, 23 shared components),
320 `<button>`, 374 `<input>/<textarea>/<select>`, 37 router links, 23 `<form>`,
56 modal usages.

> **Method note.** No browser was available in this environment (Playwright and Puppeteer
> binaries cannot be downloaded), so no viewport was measured on a real rendering engine
> and no element was clicked in a real browser. Everything below is either (a) verified by
> an executed jsdom/React Testing Library test, (b) verified by static source inspection,
> or (c) explicitly marked **UNVERIFIED — needs a browser**.

---

## 1. Navigation and routing

### 1.1 Route table

77 `<Route>` declarations under a single authenticated layout route, plus `/login` and a
`*` → 404. Verified by test (`tests/routing/restrictedNav.test.jsx`):

| Behaviour | Result |
|---|---|
| Unauthenticated visit to `/invoices` | redirects to `/login`; login page renders |
| Unknown URL `/this-page-does-not-exist` | explicit 404 card (`Page not found`) — **not** a silent bounce to the dashboard |
| Manager visits `/invoices` | renders Invoices (unrestricted roles are untouched) |
| Operator visits `/invoices` | redirected to `/` |
| Operator visits `/my-tasks` | ✅ **AUD-101 — was redirected to `/`, now renders My Tasks** |
| Operator visits `/assignments` | renders Assignments |
| Department Head visits `/tasks` | ✅ **AUD-101 — now renders Task Progress** |
| Department Head visits `/processes` | ✅ **AUD-101 — now renders Process Master** |

### 1.2 AUD-101 — dead sidebar links for restricted roles (P1, FIXED)

`AppLayout` builds the restricted sidebar from `RESTRICTED_NAV_SECTIONS`, which offers
`/`, `/my-tasks`, `/assignments`, `/tasks`, `/processes`. The route guard in `App.jsx`
whitelisted only `/`, `/jobcards/:id` and `/assignments`. Every other link bounced the
user back to the dashboard with no message.

For an **Operator** — whose landing page is `OperatorDashboard` and whose main working
screen is My Tasks — the single most important link in their sidebar did nothing. For a
**Department Head / Supervisor / Team Leader**, both Task Management links were dead,
directly contradicting the code comment that says those roles "see the full Task
Management set".

The fix widens the allow-list to exactly what the restricted nav offers. It grants no data
access: each nav entry is permission-gated and the API re-checks the same permission.

### 1.3 AUD-104 — sidebar gate disagreed with the API (P2, FIXED)

The BOMs link was gated on `bom.read`; `/api/boms` checks `item.read`. The seeded MANAGER
role holds `item.read` but not `bom.read`, so the page was usable but invisible. Now gated
on `item.read`, and `tests/unit/navPermissionContract.test.js` (35 assertions) verifies
**every** permission-gated nav entry against the permission its backing API actually
enforces, plus that every route-required key exists in the seed.

---

## 2. Buttons and actions

A source scan for `<button>` elements with neither `onClick` nor `type="submit"` returned
5 hits; all 5 are false positives where the handler appears on a following line
(`DataTable.jsx:15`, `WorkUpdatesPanel.jsx:68`, `Pagination.jsx:52`, `RolesPage.jsx:233`,
`VendorWorkOrdersPage.jsx:297`). **No dead buttons were found.**

Controls verified by executed test:

| Control | Assertions |
|---|---|
| `DataTable` sortable header | real `<button>` with `aria-label="Sort by Name"`; clicking an ascending column requests `desc` (toggles) |
| `DataTable` retry | error banner renders the message and the Retry button invokes `onRetry` |
| `Pagination` Prev/Next | Prev disabled on page 1, Next disabled on the last page; clicking Next emits `page + 1` |
| `Pagination` range text | page 2 @ 20/page over 90 records reads "Showing 21–40 of 90" |
| `Pagination` empty list | renders "of 1", never "of 0" |
| `ConfirmDialog` | both actions wired; **both buttons disabled while `loading`** (duplicate-submit guard) |
| `ConfirmDialog` | Enter confirms when focus is not already on a button/link/textarea |
| `EmptyState` CTA | renders and invokes its handler |
| `OperatorDashboard` retry | **AUD-105** — a failed load now shows "Could not load your projects" + Try again, and retry re-issues the request |

**Duplicate-submission protection** is present in the shared components (`ConfirmDialog`
disables on `loading`; `AssignModal` disables on `saving`). Page-level submit handlers set
a `loading` flag in `try/finally`; this was confirmed by reading the forms but **not
exercised with rapid double-clicks in a real browser — UNVERIFIED**.

---

## 3. Forms and validation

23 `<form>` elements. The shared validator library (`src/lib/validation.js`) is covered by
24 executed assertions:

| Validator | Cases executed |
|---|---|
| `required` | `''`, `'   '`, `null`, `undefined` rejected; `0` accepted |
| `email` | `a@b.co`, `  first.last+tag@sub.example.com  ` accepted; `nope`, `a@b`, `@b.co`, `a b@c.co`, `a@b@c.co` rejected |
| `phone10` | `9876543210`, `+91 98765 43210`, `91-9876543210`, `09876543210` accepted; `1234563210`, 9-digit, 11-digit, alpha rejected |
| `normalizePhone` | `+91 98765-43210` → `9876543210` (stored bare, consistently) |
| `gstin` | case-insensitive accept; `27AAPFU0939F1Y5` and `12345` rejected |
| `pincode` | `411018` accepted; `011018` (leading zero) and 5-digit rejected |
| `positiveNumber` | empty/`abc`/`0`/`-4` rejected with distinct messages; inclusive `min`/`max` bounds |
| `gstRate` | 0/5/12/18/28 accepted; 29, −1, `18.123` rejected |
| `hsn` | 4/6/8 digits accepted; 5 rejected |
| `passwordStrong` | 8+ chars with a letter and a digit |
| `validateAll` | collects every field error; passes all values so cross-field rules work (password/confirm) |

`FormField` links its `<label for>` to the control and renders the error in a
`role="alert"` element with a deterministic `id` for `aria-describedby` — both asserted,
and the rendered fragment is axe-clean.

**Server-side validation is independent of the client.** The API rejects every malformed
payload tested even with a valid bearer token and no frontend involvement — see
`API_TEST_REPORT.md` §4.

### 3.1 AUD-102 — the Sales Return form could never save (P1, FIXED)

`SalesReturnForm.handleSubmit` built `{ ...formData, items: [...] }`. The controller reads
`lines`. Consequence: `TypeError: lines is not iterable` → HTTP 500 → the user saw
"Failed to save sales return" on **every** attempt. The mapped lines also dropped
`invoiceLineId`, `description` and `gstRate`, all of which the server requires.

Reproduced by replaying the form's exact payload in `tests/api/uiContract.test.js` (500
before, 201 after). Fixed on both sides: the form now sends a complete `lines` array, and
`createSalesReturnSchema` guarantees a malformed body answers 400 rather than 500.

### 3.2 AUD-105 — a failed load looked like "no data" (P2, FIXED)

`OperatorDashboard` had no `.catch`. A failed `/jobcards` request fell through to
"No projects assigned to you yet" — the worst possible message on the shop floor, because
it is indistinguishable from the truth. Now shows an error card with the server message
and a Try again button. `ActivityTimeline` has the same shape and is still open (AUD-116).

---

## 4. Responsive layout — **UNVERIFIED, needs a browser**

Nothing in this section was measured. The audit environment has no rendering engine, so
claiming any of the six viewport sizes passes would be fabrication.

What static inspection supports:

- Every list page renders through the shared `DataTable`, which wraps its `<table>` in
  `overflow-x-auto scroll-x-hint` — wide tables scroll horizontally rather than breaking
  the layout.
- `PageHeader` uses `flex flex-wrap items-end justify-between` and truncates its title, so
  long titles and long action rows wrap instead of overflowing.
- The shared `Modal` caps at `max-h-[92vh]` with an independently scrolling body, so a long
  form cannot push its footer off-screen.
- Sidebar/header collision and sticky-header behaviour cannot be assessed without layout.

**Required next step:** run the six viewports (320×568, 375×812, 768×1024, 1024×768,
1366×768, 1920×1080) against a running instance and record overflow, cropped text and
touch-target sizes. Until then this section is **not assessed**.

---

## 5. Accessibility (WCAG 2.2 AA)

### 5.1 Verified by executed axe-core scans — zero violations

axe was run against rendered instances of `Modal`, `DataTable` and `FormField`. The only
rules disabled were `color-contrast` (jsdom produces no computed styles or font metrics)
and `region`.

### 5.2 Verified by executed behavioural tests

| Criterion | Evidence |
|---|---|
| **2.1.2 No keyboard trap** | Modal traps Tab *inside* the panel and releases it on close; Shift+Tab wraps back — both directions asserted |
| **2.4.3 Focus order** | Focus moves into the dialog on open and is **restored to the opening element** on unmount — asserted |
| **1.3.1 Info and relationships** | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` bound to the title `id` — asserted |
| **4.1.3 Status messages** | `FormField` errors are `role="alert"` with a stable `id` — asserted |
| **2.1.1 Keyboard** | Sortable table headers are real buttons with accessible names; Pagination Prev/Next are real buttons with `aria-label`; the close button is `aria-label="Close dialog"` |
| **3.3.1 Error identification** | error text names the field ("Party name is required") and renders next to it |
| **1.1.1 Non-text content** | decorative lucide icons carry `aria-hidden="true"` throughout the shared kit |
| **2.2.2 Pause/stop/hide** | `prefers-reduced-motion` respected via the `animate-*` utilities in Tailwind config — **static review only** |

### 5.3 Gaps found

| ID | Criterion | Finding |
|---|---|---|
| AUD-121 (P3) | 4.1.2 Name, role, value | A handful of buttons omit `type="button"` (e.g. `DataTable`'s Retry). Harmless today because none sits inside a `<form>`, but it is a latent submit-on-Enter bug. |
| AUD-122 (P3) | 1.4.3 Contrast minimum | **Not assessed** — requires a browser with real font rendering. |
| AUD-123 (P3) | 2.5.8 Target size (24×24) | Pagination buttons are `!h-8` (32 px) — passes. Icon-only controls in the shared kit are `h-8 w-8` (32 px) — passes. Table row action buttons were not measured. |

---

## 6. Consistency

The shared UI kit (`Badge`, `ConfirmDialog`, `DataTable`, `EmptyState`, `FormField`,
`FormSection`, `Modal`, `PageHeader`, `Pagination`, `SearchableSelect`) is used
consistently across pages, and `lib/formStyles.js` centralises button/label/error classes.
Loading (skeleton), empty, error and no-data states are all represented in `DataTable`;
the gap is in the two page-level loaders noted in §3.2.
