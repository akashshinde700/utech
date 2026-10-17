import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom has no matchMedia / scrollIntoView — components that touch them would
// throw for reasons unrelated to what is being tested.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
// jsdom has no layout engine, so `offsetParent` is always null. Modal's focus
// trap filters out invisible elements with `offsetParent !== null`, which in
// jsdom would filter out EVERYTHING. Report a parent instead so the trap is
// exercised for real.
Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
  get() { return this.parentNode; },
  configurable: true,
});

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// The app talks to /api through axios. Tests must never touch the network, so
// axios is replaced with a spy instance whose calls resolve to an empty page —
// the shape every list endpoint returns. Individual tests can still override a
// single call with mockResolvedValueOnce.
// Some endpoints answer with a paginated envelope, others with a bare array.
// The default stub satisfies BOTH shapes at once (an array that also carries
// `items` / `pagination`), so a page can do either `res.data.items` or
// `res.data.map(...)` without the test having to know which endpoint it hit.
const emptyPage = () => {
  const arr = [];
  arr.items = [];
  arr.count = 0;
  arr.total = 0;
  arr.pagination = { total: 0, page: 1, pageSize: 20, totalPages: 1 };
  return { data: arr };
};

const handlers = {
  get: vi.fn(() => Promise.resolve(emptyPage())),
  post: vi.fn(() => Promise.resolve({ data: { ok: true, id: 1 } })),
  put: vi.fn(() => Promise.resolve({ data: { ok: true, id: 1 } })),
  patch: vi.fn(() => Promise.resolve({ data: { ok: true, id: 1 } })),
  delete: vi.fn(() => Promise.resolve({ data: { ok: true } })),
};

vi.mock('axios', () => {
  const instance = {
    ...handlers,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    defaults: { headers: { common: {} } },
  };
  const axios = { create: () => instance, ...handlers };
  axios.default = axios;
  axios.__instance = instance;
  return { default: axios };
});

// exposed so a test can point a single endpoint at a canned payload
globalThis.__apiMock = handlers;
