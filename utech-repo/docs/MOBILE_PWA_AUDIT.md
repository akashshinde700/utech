# Mobile / PWA Audit & Fixes — 2026-10-28

Stack: React 18 + Vite 8 + Tailwind 3, react-router 7, hand-rolled PWA
(`public/manifest.webmanifest` + `public/sw.js`), Express backend.

## Root causes found (not symptoms)

1. **Every list screen used one wide `<table>`** (`DataTable`, 29 pages). On a
   360px phone the columns squeezed/scrolled sideways — the main "mobile par
   proper nahi dikhta" complaint. No card/alternate presentation existed.
2. **Mobile drawer did not lock background scroll** — the page behind the
   open drawer kept scrolling / chain-scrolling on touch. Nav links were
   ~32px tall, below the 44px touch guideline.
3. **No offline / network-failure UX.** `/api` failures with no response
   (Wi-Fi drop, timeout) produced a generic toast per request and no global
   connection state; nothing told the user a transaction was *not* saved.
4. **Service worker silently took over on update** (`skipWaiting()` on every
   install) — a deploy could reload the shell under a half-filled form. There
   was no "new version" prompt. Cache version was still `v1`.
5. **Modals used `92vh`** — on mobile browsers with collapsing chrome the
   panel could extend under the browser UI; no safe-area padding; the close
   button was 32px.
6. **Filter/form controls could exceed their container** at 320px
   (`max-w-[180px]` selects + page padding), getting clipped by the global
   `overflow-x: clip` guard instead of wrapping.
7. Login / loading / error screens used `min-h-screen` (100vh) instead of
   `dvh`, causing bottom gaps/jumps with mobile browser chrome.

Already good (verified, kept): violet theme tokens, slide-out drawer with
Escape/outside-tap close + close-on-navigate, collapsible desktop sidebar,
`min-h-dvh` app shell, safe-area insets, 16px inputs on coarse pointers
(anti-zoom), `formGrid` single-column-on-mobile, line-item forms with
stacked mobile variants, manifest (standalone, maskable 512, theme
`#7c3aed`), SW that **never caches `/api` or `/uploads`**, network-first
navigations, code-split pages.

## Fixes implemented

| File | Change |
|---|---|
| `frontend/src/components/ui/DataTable.jsx` | Below `sm`, renders record **cards** from the same column renderers (1st column = heading, rest labelled rows, actions column = footer). No data/actions lost; `mobileCards={false}` opt-out; `hideOnMobile` per column. |
| `frontend/src/lib/useMediaQuery.js` | New reactive media-query hook (jsdom-safe). |
| `frontend/src/components/layout/AppLayout.jsx` | Drawer locks body scroll while open (restored on close); drawer nav links get 44px touch height on mobile only; mounts `OfflineBanner`. |
| `frontend/src/components/layout/OfflineBanner.jsx` | New sticky amber "You are offline — data cannot load or save" banner with Retry. Never fakes success. |
| `frontend/src/lib/api.js` | No-response failures (offline/timeout) get one clear "not saved" toast per 10s window instead of a toast storm. |
| `frontend/src/components/ui/Modal.jsx` | `92dvh`, safe-area bottom padding, 40px close target. |
| `frontend/src/styles.css` | Form controls capped at container width (`max-width:100%`), tap-highlight off, `touch-action: manipulation`. |
| `frontend/public/sw.js` | Cache `v2`; updates **wait** — only first install self-activates; `SKIP_WAITING` message honoured. Still never caches API/uploads. |
| `frontend/src/main.jsx` | Detects a waiting worker → persistent "New version — Reload" toast; reloads once on `controllerchange`; `updateViaCache:'none'`. |
| `frontend/src/App.jsx`, `main.jsx`, `pages/auth/Login.jsx` | `min-h-dvh` instead of `100vh`. |
| `frontend/e2e/mobile-viewports.spec.js` | Real-browser suite: 8 viewports × 10 routes overflow assertions, drawer behaviour, card-vs-table, desktop regression. |
| `frontend/tests/components/mobileResponsive.test.jsx` | jsdom tests for cards, opt-out, row-click vs action clicks, offline banner. |
| `frontend/tests/unit/pwa.test.js` | Pins the user-confirmed SW update contract. |

Business logic, permissions, print layouts, desktop layout: unchanged.
Transactions are **never** queued/replayed offline (stock movements are not
idempotent) — the user is told to reconnect and retry.

## Test results

| Check | Result |
|---|---|
| Frontend unit/component tests | **PASS** — 19 files, 187 tests (baseline: 178 pass + 1 file failing only because backend deps were not installed) |
| Backend tests | **PASS** — 29 files, 901 tests (untouched code, regression check) |
| `npm run lint` (frontend) | **PASS** |
| `npm run build` | **PASS** (pre-existing >500kB `charts`/`page-assignments` chunk warnings unchanged) |
| Manifest / icons / SW served by dev server | **PASS** (HTTP 200, valid JSON, violet theme) |
| Real-browser mobile viewports (320→1366, drawer, cards, install, offline) | **NOT TESTED in this sandbox** — Chromium's system libraries (`libnspr4`/`libnss3`) are unavailable and browser downloads are blocked. Run `npm run test:e2e` (executes `e2e/mobile-viewports.spec.js` on the disposable demo stack) on a workstation/CI with Chromium. |
| Installed PWA on real Android Chrome / iOS Safari | **NOT TESTED** — no physical device available. Verify: install prompt (Android) / Share → Add to Home Screen (iOS), standalone launch, deep-link refresh, update toast after a redeploy. |

## Deployment / rollback

Deploy as usual (static `frontend/dist` + unchanged backend). The cache
version bump (`v2`) purges old shell caches on activate. First load after
deploy may show the "New version — Reload" toast once; accepting it loads
the new shell. Rollback = redeploy the previous `dist`; old workers are
replaced the same way. No DB changes in this work.
