# KEYBOARD_SHORTCUT_AUDIT.md

**Audit date:** 2026-10-17 · **Branch:** `arena/5f43ac08-utech`
Scope: every keyboard handler discovered in `frontend/src` (grep for `keydown`, `onKeyDown`, `metaKey`, `ctrlKey`, `e.key`), plus regression tests in `frontend/tests/unit/keyboardShortcuts.test.jsx` (10 tests) and `tests/components/uiKit.test.jsx`.

---

## 1. Shortcut inventory

| Shortcut | Module | Expected action | Actual action | Conflict | Result |
|---|---|---|---|---|---|
| Escape | Modal (all forms/modals) | close / cancel | closes; `disableEscape` opt-out works | was broken with open dropdown — see AUD-207 | **PASS** (post-fix) |
| Escape | SearchableSelect | close popover only | closes popover only (window-capture consumer) | previously closed the whole Modal too | **PASS** (post-fix, AUD-207) |
| Escape | PdfViewerModal | close viewer | closes | none | PASS (code + cleanup verified) |
| Escape | ImageLightbox | close lightbox | closes | none | PASS (code + cleanup verified) |
| Escape | JobcardTaskProgress inline edit | cancel edit | cancels, `stopPropagation` so Modal stays | none | PASS |
| Escape | useClickOutside (`escape` opt-in) | click-away | fires `onAway` | none | PASS |
| Enter | ConfirmDialog | confirm | confirms once | must not fire from textarea/button — guarded and tested | **PASS** |
| Enter | JobcardTaskProgress edit/add inputs | save / add | saves / adds | input-scoped, no global handler | PASS |
| Enter | SearchableSelect filter input | select active option | selects and closes | input-scoped | **PASS** (tested) |
| Tab / Shift+Tab | Modal | focus trap | cycles within panel | none | PASS (code verified) |
| Tab | SearchableSelect | close popover | closes | none | PASS |
| ↑ / ↓ | SearchableSelect | move active option | moves (wraps) | prevented default (no caret jump) | **PASS** (tested) |
| Home / End | SearchableSelect | first / last option | sets index | none | PASS (code) |
| ← / → | PdfViewerModal | prev / next page | navigates | none | PASS (code) |
| Ctrl/Cmd + S global | — | — | **not implemented anywhere** | n/a | NOT APPLICABLE (documented, not added — out of scope to invent) |

## 2. Cross-cutting guarantees verified

1. **Shortcuts fire once.** Enter on a focused ConfirmDialog button is left to the native click path (no double-submit) — tested.
2. **Shortcuts do not fire while typing destructively.** ConfirmDialog ignores Enter from `textarea`/`button`/`a`; SearchableSelect shortcuts are input-scoped on its own filter box; no global Ctrl/letter handlers exist.
3. **Layered Escape is topmost-wins.** Fixed AUD-207: the select's consumer now listens on `window` capture (one node above the Modal's `document` listener) so `stopPropagation` genuinely blocks the parent layer. Tested: Escape closes the dropdown, Modal survives; second Escape closes the Modal.
4. **Global listeners are cleaned up on unmount** — every handler pair (`addEventListener`/`removeEventListener`) verified in source and asserted for Modal, ConfirmDialog and SearchableSelect by test (spy counts match).
5. **Mac/Windows modifiers** — no modifier-key shortcuts exist yet; nothing to break.
6. **Discoverability** — keyboard affordances are documented on the components (comments); a user-facing shortcut help page does not exist (P3 recommendation, not added).
7. **Accessible alternatives** — every keyboard action has a clickable equivalent (buttons/links); axe-core passes on Modal/DataTable/FormField (prior pass).

## 3. Defect found and fixed

### AUD-207 — P2 — FIXED — "Escape closes the dropdown AND the whole modal"

- **Affected:** `frontend/src/components/ui/SearchableSelect.jsx` inside any `Modal` (AssignModal, SendToVendorModal, JobworkForm dialogs, …).
- **Repro:** open a modal containing the item/party picker → open the dropdown → press Escape once.
- **Expected:** dropdown closes; modal and its unsaved input remain.
- **Actual (pre-fix):** both closed; `onClose` fired — the form data was silently discarded. Proven by an instrumented probe (`onClose` calls = 1 with the dropdown open).
- **Root cause:** the component comment claimed a capture-phase `document` listener "runs before a surrounding Modal's own Escape handler and stops it". Two flaws: (a) `stopPropagation()` does not stop other listeners on the **same** node, only propagation to other nodes; (b) the Modal's handler registered first (mount before popover-open) and ran first — probe order: `onKeyDown` (Modal) then `onKeyCapture` (select).
- **Fix:** the select's Escape consumer now registers on `window` in the capture phase — the event is consumed one node *above* the Modal's `document` listener, so `stopPropagation` blocks the parent layer. No API change; comment corrected.
- **Tests:** `keyboardShortcuts.test.jsx` — layering test (fails pre-fix), listener cleanup test (fails pre-fix while keyed to window), selection/navigation tests.
- **Verification:** pre-fix run failed 2 tests; post-fix full frontend suite 144/144 PASS.
