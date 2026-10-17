# UI_BUTTON_NAVIGATION_AUDIT.md

**Audit date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech`
Scope: interactive controls across 63 page files + 23 shared components (pass-1 inventory: 320 `<button>`, 374 inputs, 37 router links, 23 forms, 56 modal usages). This pass re-tested the control classes that carry data (save/edit/delete/cancel/actions) where they touch the five mandated checks, and re-verified navigation after the routing fixes of pass 1. A real-browser click-through could not be run here (no browser in sandbox) — see §5.

---

## 1. Button classes and handler integrity

| Control class | Where | Handler → API | Verified |
|---|---|---|---|
| Save/Submit (forms) | InvoiceForm, JobcardForm, GRNForm, POForm, JobworkForm, DispatchForm, SalesReturnForm, … | `api.post/put` with `saving` guard disabling the button | double-submit prevention verified in 5 major forms (source); contract tests assert the payload shapes |
| Edit/View row actions | list pages (DataTable) | navigate to `/…/:id` | route guard + nav contract tests (pass 1, still green) |
| Delete/Cancel | jobcard (2-phase cancel→delete), dispatch (status/CANCELLED), GRN (cancel w/ stock reversal), returns (DRAFT only) | status-gated; double-cancel rejected | tested ("refuses to cancel twice", "Cannot cancel completed batch") |
| Approve/Process/Complete | returns, PO, jobcard complete, batch complete | status transitions enforced server-side | tested |
| Add row / Remove row | InvoiceForm, JobcardForm, return forms, BackOrderForm | local state; payload excludes removed rows | verified (form code + line-id stability test) |
| Modal actions | ConfirmDialog, AssignModal, SendToVendorModal, RecordReturnModal | Enter/Escape/click paths | keyboard suite PASS |
| Dashboard shortcuts | Dashboard cards, low-stock links | router links | render tests pass |
| Print/Export | invoice PDF (`streamInvoicePdf`), XLSX exports | api GET | smoke-tested (PDF path); XLSX unbounded (AUD-107 open) |

**Misleading-success / dead-button sweep:** none found in this pass's touched paths —
every save path surfaces server errors via toast (`err.response?.data?.message`); the
operator-dashboard false-empty-state bug (AUD-105) was fixed in pass 1 with tests.

## 2. Navigation and routes

- Sidebar ↔ API permission contract: `frontend/tests/unit/navPermissionContract.test.jsx` (35 tests) — nav `perm` keys must match backend `requirePermission` keys. Green.
- Restricted-user navigation: `tests/routing/restrictedNav.test.jsx` (8 tests) — every sidebar link a restricted user can see must open. Green (AUD-101 fix from pass 1 held).
- Direct URLs / refresh on detail pages / browser back-forward: route structure is standard React Router v6 with a Protected wrapper; `restrictedNav` renders pages through the real `App` at deep URLs, exercising the guards.
- Return-navigation after save: JobcardForm/InvoiceForm/return forms `navigate()` back to the list after success (source-verified).

## 3. Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| AUD-201 | P1 | Save on JobcardForm destroyed the jobcard's entire Task Progress (button worked "successfully" while deleting data — the worst class of misleading success) | **FIXED** (see BUSINESS_LOGIC_BUGS.md) |
| AUD-207 | P2 | Escape inside any modal with an open picker closed the modal and discarded input | **FIXED** |
| AUD-121 | P3 | Some buttons inside forms lack `type="button"` (could submit unintentionally) — carried from pass 1 | OPEN |
| AUD-209 | P3 | SalesReturnForm "Total" preview is pre-tax | OPEN (display only) |

## 4. UI-refresh after mutations (spot-verified)

Jobcard save → reloads attachments + navigates; customer-material actions → `load()`;
return approve/process → `loadReturn()`; dispatch/jobwork list pages refetch on action.
DataTable pagination and filters are wired to `parseListQuery` server-side (shared
contract, tested through the API suites).

## 5. Could not be tested here

Real-browser click-through, responsive breakpoints, date-picker positioning,
colour contrast and touch-target sizing (pass-1 AUD-122/123) require a layout engine
— not available in this sandbox. Recommended: Playwright run against a seeded staging
instance (see `ERP_RELEASE_READINESS.md` §5).
