# FORMS_UX_PLAN.md — UI/UX professionalization round: forms contract

Task 6-a (foundation) deliverable. **Waves B / C / D must follow this document.**
Owner of this file: 6-a (ux-foundation-agent). Last updated: task 6-a.

App stack: React 18 + Vite 5 + Tailwind 3 (config: `tailwind.config.js`), plain JSX,
lucide-react icons, react-hot-toast toasts, zustand auth store, react-router-dom v6.

---

## 1. Existing design language (DO NOT re-invent — reuse it)

There are **no shadcn-style semantic tokens** (`primary`/`destructive`/`muted`) in this
app. The palette is defined in `tailwind.config.js` + `src/styles.css`:

| Role         | Token in this app                                  |
|--------------|----------------------------------------------------|
| primary      | `brand-*` (violet, `brand-600 = #7c3aed`)          |
| destructive  | `danger-*` (red, `danger-500/600/700`) or `red-*`  |
| muted        | `slate-*` (bg-slate-50/100, text-slate-400/500/600)|
| success      | `success-*` (green), also `emerald-*` (aliased to brand in config!) |
| warning      | `warning-*` (amber), also `amber-*`                |

> ⚠️ Gotcha: in `tailwind.config.js` the `emerald` scale is **aliased to violet** and
> `cyan` to orange — never use `emerald-*`/`cyan-*` expecting real green/cyan.
> Use `success-*` / `brand-*` instead.

Global component classes already in `src/styles.css` (use them for pages):
`.card`, `.card-flat`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`,
`.btn-ghost`, `.btn-icon`, `.input`, `.label`, `.badge`, `.table-th`, `.table-td`,
`.skeleton`, `.loading-spinner`, plus animations `.animate-fade-in`, `.animate-slide-up`,
`.animate-scale-in`. The webkit scrollbar is styled globally.

Existing patterns: `PageHeader` on every page; lists via `DataTable`; confirm dialogs
are native `window.confirm` (wave agents should replace with `ConfirmDialog` where a
task asks); modals are hand-rolled `fixed inset-0 … z-[70]` overlays.

---

## 2. New shared primitives (built by 6-a — the contract)

Location follows the existing convention: components in `src/components/ui/`, JS libs
in `src/lib/`. All plain JSX + Tailwind, zero new dependencies.

### 2.1 `src/lib/formStyles.js` — `import { styles } from '…/lib/formStyles'`

Single exported `styles` object of class-string constants. **Every form in waves B/C
must style inputs/buttons with these** so all forms look identical:

| Key           | Purpose / notes |
|---------------|-----------------|
| `input`       | h-10 rounded-lg border input; focus ring `brand-500/30`; disabled styles. Append `styles.inputError` when the field has an error. |
| `inputError`  | danger border/ring override — concat after `input`. |
| `textarea`    | like `input` but `min-h-[80px]` and auto height (use for `<textarea>`). Append `inputError` too. |
| `label`       | text-sm font-medium text-slate-700 (field labels). Render required asterisk as `<span className="text-danger-500"> *</span>`. |
| `hint`        | `mt-1 text-xs text-slate-400` help text. |
| `errorText`   | `mt-1 text-xs text-danger-600` error message. |
| `selectBtn`   | trigger-button styling matching `input` for `SearchableSelect`. |
| `primaryBtn`  | violet filled button (h-10). |
| `secondaryBtn`| white bordered button. |
| `ghostBtn`    | transparent/slate hover button. |
| `dangerBtn`   | red filled button. |
| `formGrid`    | `grid grid-cols-1 gap-4 sm:grid-cols-2` — default field grid. |
| `formGrid3`   | 1→2→3 cols responsive grid. |
| `formGrid4`   | 1→2→4 cols responsive grid. |
| `actionsBar`  | sticky bottom save/cancel bar with gradient backdrop: `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sticky bottom-0 …` — put `<Save>`/`<Cancel>` buttons inside; works inside `FormSection` and bare forms. |
| `sectionCard` | card-flat shell used by `FormSection`. |

Grid guidance: place each field in a `<FormField>` as a direct child of a
`formGrid*` container; a field spans the full row with
`className="sm:col-span-2"` (or `sm:col-span-2 lg:col-span-3` in grids of 3).
Do **not** nest grids inside grids.

### 2.2 `src/components/ui/FormField.jsx`

```jsx
<FormField id="party-name" label="Party Name" required hint="Legal name as per GST records"
  error={errors.name} className="sm:col-span-2">
  <input id="party-name" className={styles.input} … />
</FormField>
```

Props: `{ id, htmlFor?, label, required?, hint?, error?, children, className? }`.
- Label row: `text-sm font-medium` + red asterisk when `required`.
- Help hint rendered when `hint` set and no `error`.
- Error: `text-xs text-danger-600` with small `AlertCircle` icon, `role="alert"`.
- ARIA wiring: hint gets `id={`${id}-hint`}`, error `id={`${id}-error`}` — when wiring
  manually add `aria-describedby={`${id}-hint ${id}-error`}` (space-separated, omit
  absent ones) and `aria-invalid={!!error}` on the control.

### 2.3 `src/components/ui/FormSection.jsx`

```jsx
<FormSection icon={User} title="Basic Details" description="Who the party is"
  actions={<button className={styles.ghostBtn}>Import</button>}>
  <div className={styles.formGrid}> …FormFields… </div>
</FormSection>
```

Props: `{ icon?, title, description?, actions?, children, className? }`.
Renders `card-flat` section, header row (icon in soft brand circle, `title`
text-sm font-semibold, `description` text-xs muted, `actions` pushed right),
body padded `p-4 sm:p-5`. Stack multiple FormSections in a `space-y-5` wrapper.
Page-level layout guidance: `<form className="max-w-5xl space-y-5">` +
`actionsBar` pinned at the end.

### 2.4 `src/components/ui/SearchableSelect.jsx` — THE select upgrade

Replaces raw `<select>` everywhere (current selects cap at ~1000–2000 options and
are unsearchable). Dependency-free.

```jsx
<SearchableSelect
  id="party-id"
  value={form.partyId}                       // raw option value (string OR number)
  onChange={(v) => set('partyId', v)}        // receives the RAW option value ('' when cleared)
  options={[{ value: 1, label: 'P-001 — Vertex', subtitle: 'Mumbai' }]}
  placeholder="Select vendor…"
  error={errors.partyId} loading={partiesLoading} disabled={…}
/>
```

Props: `{ value, onChange(value), options: [{value,label,subtitle?}], placeholder='Select…',
disabled?, error?, loading?, allowClear=true, emptyText='No matches found', className?, id? }`.

Behavior: button trigger opens a popover with an auto-focused filter input
(case-insensitive substring filter on label+subtitle); full keyboard support
(ArrowUp/Down move active, Enter selects, Escape closes, Tab closes, Home/End jump);
ARIA `role="listbox"/"option"`, `aria-expanded`, `aria-activedescendant`;
closes on outside click (shared `useClickOutside` hook) and on scroll
(capture); clear (×) button when `allowClear` and a value is set; check icon on the
selected row; active row highlighted; list `max-h-60 overflow-y-auto`; loading spinner
row; "N matches" counter when >50; active option auto-scrolled into view; trigger
always displays the selected option's **label** (never the raw id), with placeholder
muted when empty. Values compared with `String(a) === String(b)` so numeric ids work.

### 2.5 `src/components/ui/Modal.jsx`

```jsx
<Modal open={open} onClose={close} title="Send to vendor" description="Optional note"
  size="md" footer={<><button className={styles.secondaryBtn}>Cancel</button>…</>}>
  …content…
</Modal>
```

Props: `{ open, onClose, title, description?, children, footer?, size='md'|'lg'|'xl'|'full',
closeOnOverlay=true, disableEscape=false }`.
Portals to `document.body`; overlay `bg-black/50 backdrop-blur-sm`; panel `animate-scale-in`,
sizes md=`max-w-lg`, lg=`max-w-2xl`, xl=`max-w-4xl`, full=`max-w-[96vw] h-[92vh]`;
focus trap (Tab cycling), initial focus on first focusable, focus restored on close;
Escape closes unless `disableEscape`; body scroll lock (ref-counted, safe for stacked
modals); `role="dialog" aria-modal aria-labelledby`; X close button; header fixed,
body scrolls, footer in bordered bar. Internal z-index `z-[70]` (above topbar).

### 2.6 `src/components/ui/ConfirmDialog.jsx`

```jsx
<ConfirmDialog open={confirmOpen} onClose={() => setConfirmOpen(false)}
  onConfirm={doDelete} title="Deactivate party?" message="P-0011 will be marked inactive."
  variant="destructive" confirmLabel="Deactivate" loading={deleting} />
```

Props: `{ open, onClose, onConfirm, title, message, confirmLabel='Confirm',
cancelLabel='Cancel', variant='default'|'destructive', loading }`.
Built on Modal. `loading` disables both buttons + spinner in confirm. Enter = confirm,
Escape = cancel. Destructive shows red `AlertTriangle` badge and `dangerBtn`.

### 2.7 `src/components/ui/EmptyState.jsx`

```jsx
<EmptyState icon={PackageOpen} title="No GRNs yet" description="Record your first goods receipt."
  action={{ label: 'New GRN', onClick: () => navigate('/grns/new'), icon: Plus }} />
```

Props: `{ icon?, title, description?, action?: {label, onClick, icon?}, className? }`.
Centered, muted icon in soft circle, primary `sm` CTA button.

### 2.8 `src/lib/validation.js`

Every validator returns an **error string or `null`**; empty input is valid for the
"format" validators (pair with `required`), `required`/`positiveNumber` fail on empty.

- `required(v, label)` — non-empty after trim.
- `email(v)` — simple RFC-ish regex.
- `phone10(v)` — Indian 10-digit; strips spaces/dashes, accepts optional `+91`/`91`/`0`
  prefix. Companion `normalizePhone(v)` returns the bare 10-digit number (use it in the
  payload, not just validation).
- `gstin(v)` — `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`
  (uppercases + trims first, empty allowed).
- `pincode(v)` — `^[1-9][0-9]{5}$` (empty allowed).
- `positiveNumber(v, label, { min, max } = {})` — must parse to a finite number > 0,
  optionally ≥ min / ≤ max (fails empty).
- `gstRate(v)` — 0–28 inclusive, ≤ 2 decimals (0 itself is valid; empty allowed).
- `hsn(v)` — empty allowed, else 4/6/8 digits.
- `passwordStrong(v)` — ≥ 8 chars with at least one letter and one number.
- `validators` — the map of the above (`validators.required`, …).
- `validateAll(values, schema)` → `{ errors: {field: msg}, ok: boolean }` where
  `schema = { fieldName: (value, allValues) => errorStringOrNull }`. Validator fns may
  take `(value, allValues)` — extra args ignored by simple validators.

Usage pattern for waves B/C:
```js
const { errors, ok } = validateAll(form, {
  name: (v) => required(v, 'Name'),
  email: (v) => email(v),
  gstin: (v) => gstin(v),
  phone: (v) => phone10(v),
  pincode: (v) => pincode(v),
});
if (!ok) { toast.error('Please fix the highlighted fields'); setErrors(errors); return; }
```

### 2.9 `src/lib/useClickOutside.js`

`useClickOutside(ref, onAway, { active = true, escape = true, events = ['mousedown','touchstart'] })`
— fires `onAway` on clicks outside `ref` (mousedown/touchstart on document) and on
Escape (when `escape` true; disable via `escape:false`). Used by SearchableSelect,
the topbar user dropdown and the notifications popover. `active:false` pauses the
listeners while closed.

---

## 3. Full form inventory (state as of task 6-a, before wave work)

Legend: raw = uses bare `.input/.label` classes + native selects; n/a = no inputs.
"→ wave" column is the assignment contract (§4).

### Form pages (`src/pages/**`)

| File | Fields | Current state | Wave |
|------|--------|--------------|------|
| quotations/QuotationForm.jsx | 2 sel / 10 in / 3 ta | raw; party select pageSize 1000; image upload blocks; no validation grid | B |
| quotations/QuotationsPage.jsx | 1 sel / 1 in | filter bar only | B |
| quotations/QuotationView.jsx | — | read-only doc view | B |
| invoices/InvoiceForm.jsx | 2 sel / 10 in / 2 ta | raw; party/item selects; no client validation | B |
| invoices/InvoicesPage.jsx | 1 sel / 1 in | filter bar | B |
| invoices/InvoiceView.jsx | 1 sel / 3 in | read-only + record-payment inline form | B |
| salesReturns/SalesReturnForm.jsx | 1 sel / 6 in / 2 ta | raw; invoice select 1000 | B |
| salesReturns/SalesReturnsPage.jsx | 1 sel / 1 in | filter bar | B |
| backOrders/BackOrderForm.jsx | 3 sel / 7 in / 1 ta | raw; invoice/party/item selects | B |
| backOrders/BackOrdersPage.jsx | 1 sel / 1 in | filter bar | B |
| parties/PartyForm.jsx | 1 sel / 16 in / 1 ta | raw; flat 3-col grid; only `required` on name; **no GSTIN/phone/pincode validation** | B |
| parties/PartiesPage.jsx | 2 sel / 1 in | list + type/status filter selects | B |
| items/ItemForm.jsx | 3 sel / 8 in / 1 ta | raw; type/unit selects; no HSN/gstRate validation | B |
| items/ItemsPage.jsx | 1 sel / 2 in | filter bar | B |
| purchase/GRNForm.jsx | 2 sel / 8 in | raw; PO-ID typed by hand (should be a select); line-item table with plain selects | C |
| purchase/GRNsPage.jsx | — | list (DataTable) | C |
| purchase/GRNView.jsx | — | read-only | C |
| purchase/PurchaseOrderForm.jsx | 2 sel / 6 in / 1 ta | raw; party/item selects | C |
| purchase/PurchaseOrdersPage.jsx | 1 sel | filter bar | C |
| purchase/PurchaseOrderView.jsx | — | read-only | C |
| purchaseReturns/PurchaseReturnForm.jsx | 3 sel / 6 in / 2 ta | raw; GRN/PO/party selects | C |
| purchaseReturns/PurchaseReturnsPage.jsx | 1 sel / 1 in | filter bar | C |
| quality/QualityPage.jsx | 3 sel / 7 in / 1 ta | inline QC form + list on one page | C |
| dispatch/DispatchForm.jsx | 2 sel / 8 in / 1 ta | raw; invoice select; vehicle no | C |
| dispatch/DispatchPage.jsx | — | list | C |
| jobcards/JobcardForm.jsx | 4 sel / 14 in | raw; machine/department selects | C |
| jobcards/JobcardsPage.jsx | 1 sel / 1 in | filter bar | C |
| jobcards/JobcardView.jsx | 2 in | read-only + inline updates | C |
| jobwork/JobworkForm.jsx | 3 sel / 6 in / 1 ta | raw | C |
| jobwork/JobworkPage.jsx | 2 in | list + inline actions | C |
| vendorWorkOrders/VendorWorkOrderForm.jsx | 2 sel / 9 in / 3 ta | raw; item/department selects | C |
| vendorWorkOrders/VendorWorkOrdersPage.jsx | 2 sel / 2 in | filter bar | C |
| vendorWorkOrders/VendorWorkOrderView.jsx | — | read-only (built in task C3) | C |
| expense/ExpensesPage.jsx | 4 sel / 7 in | inline expense form + list | C |
| users/UsersPage.jsx | 11 sel / 19 in | **biggest form surface**; create/edit user + role permission matrix | C |
| roles/RolesPage.jsx | 1 sel / 8 in | role create/edit + permissions | C |
| departments/DepartmentsPage.jsx | 1 sel / 5 in | inline dept form | C |
| departments/DepartmentSubCategoryPage.jsx | 2 sel / 5 in | inline sub-role form | C |
| machines/MachineForm.jsx | 1 sel / 4 in / 1 ta | raw | C |
| machines/MachinesPage.jsx | 1 in | list | C |
| process/ProcessPage.jsx | 4 in / 1 ta | inline process form | C |
| production/ProductionForm.jsx | 6 sel / 7 in / 1 ta | raw; jobcard/item/bom/machine selects | C |
| production/ProductionPage.jsx | 1 sel / 1 in | filter bar | C |
| production/ShiftsPage.jsx | 5 in | inline shift form | C |
| bom/BomForm.jsx | 2 sel / 5 in / 1 ta | raw; item select | C |
| bom/BomPage.jsx | 1 in | list | C |
| customerMaterial/CustomerMaterialForm.jsx | 3 sel / 8 in / 1 ta | raw | C |
| customerMaterial/CustomerMaterialPage.jsx | 2 in | list + inline form | C |
| customerMaterial/CustomerMaterialView.jsx | 2 in | read-only + actions | C |
| assignments/AssignmentsPage.jsx | 1 sel / 1 in / 3 ta | list + inline assign controls | C |
| project/ProjectsPage.jsx | 2 sel / 5 in | inline project form | C |
| project/ProjectView.jsx | 1 sel / 3 in | detail + inline forms | C |
| stock/StockManagementPage.jsx | 2 sel / 2 in | filters + adjust-stock inline form | D |
| auth/Login.jsx | 2 in | leave for wave D | D |

### Form-ish components (`src/components/**`)

| File | Current state | Wave |
|------|--------------|------|
| layout/ChangePasswordModal.jsx | hand-rolled modal, 3 password inputs, toast errors | D |
| layout/NotificationBell.jsx | popover; items now navigate (6-a) | D |
| layout/AppLayout.jsx | user dropdown outside-click/Escape fixed (6-a) | D |
| assignments/AssignModal.jsx | hand-rolled modal, 2 selects + note | C |
| vendorWorkOrders/SendToVendorModal.jsx | hand-rolled modal, 6 inputs + 1 select | C |
| vendorWorkOrders/RecordReturnModal.jsx | hand-rolled modal, 2 inputs + 1 textarea | C |
| jobcards/ChecklistWidget.jsx | toggles only | C |
| jobcards/WorkUpdatesPanel.jsx | 1 input | C |
| gallery/ImageLightbox.jsx, pdf/* | no forms | — |

### Shell / read-only (wave D)

Dashboard.jsx, operator/OperatorDashboard.jsx, pages/auth/Login.jsx, NotFound (inline
in App.jsx), components/ui/DataTable.jsx, Pagination.jsx, PageHeader.jsx, Badge.jsx,
reports/ReportsPage.jsx, analytics/{Sales,Production,Inventory}Analytics.jsx,
stock/StockManagementPage.jsx, layout/AppLayout.jsx, layout/NotificationBell.jsx,
layout/ChangePasswordModal.jsx.

---

## 4. Wave assignments (contract)

- **Wave B — sales & core masters:** QuotationForm/QuotationsPage, InvoiceForm/
  InvoicesPage/InvoiceView, SalesReturnForm/SalesReturnsPage, BackOrderForm/
  BackOrdersPage, PartyForm/PartiesPage, ItemForm/ItemsPage.
- **Wave C — ops/purchase/admin:** GRNForm/GRNsPage/GRNView, PurchaseOrderForm/
  PurchaseOrdersPage/PurchaseOrderView, PurchaseReturnForm/PurchaseReturnsPage,
  QualityPage, DispatchForm/DispatchPage, JobcardForm/JobcardsPage/JobcardView +
  jobcards components, JobworkForm/JobworkPage, VendorWorkOrderForm/
  VendorWorkOrdersPage/VendorWorkOrderView + its 2 modals, ExpensesPage, UsersPage,
  RolesPage, DepartmentsPage, DepartmentSubCategoryPage, MachineForm/MachinesPage,
  ProcessPage, ProductionForm/ProductionPage/ShiftsPage, BomForm/BomPage,
  CustomerMaterialForm/Page/View, AssignmentsPage + AssignModal, ProjectsPage,
  ProjectView.
- **Wave D — dashboard/shell/read-only:** Dashboard, OperatorDashboard, Login,
  NotFound, DataTable, Pagination, PageHeader, Badge, ReportsPage, 3× analytics,
  StockManagementPage, AppLayout, NotificationBell, ChangePasswordModal.

## 5. Rules for waves B/C/D

1. Never introduce a new palette; use `styles.*` from `lib/formStyles.js` + existing
   `.card/.btn-*/.table-*` classes. Primary = `brand-*`, destructive = `danger-*`.
2. Replace every entity `<select>` (parties, items, invoices, …) with
   `SearchableSelect`; keep plain `<select>` ONLY for tiny static enums (≤ 8 options,
   e.g. status filters) — and then still use `styles.input`.
3. Wrap field groups in `FormSection`; wrap each field in `FormField` with real
   validation errors from `lib/validation.js`; surface submit errors via
   `toast.error` + inline field errors.
4. Replace `window.confirm` deletes with `ConfirmDialog` (destructive).
5. Empty tables/lists get `EmptyState`, not bare "No records" text (DataTable's
   built-in empty can stay for tables; page-level empties use EmptyState).
6. Actions live in `styles.actionsBar` (forms) or `PageHeader action` (lists).
7. Keep all APIs/network contracts unchanged; this round is visual/UX only.
8. Do not edit `lib/formStyles.js`, `lib/validation.js`, or the six ui primitives
   without updating this doc — they are shared dependencies.
