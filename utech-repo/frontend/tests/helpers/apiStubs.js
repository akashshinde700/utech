// Canned API responses for the routing tests.
//
// Most list endpoints answer with a paginated envelope and a few answer with a
// bare array; the default stub below satisfies both at once. The endpoints that
// answer with a shaped OBJECT have to be listed explicitly, otherwise a page
// reading `data.summary.x` crashes for reasons that have nothing to do with the
// route guard being tested.
export function makePage() {
  const arr = [];
  arr.items = [];
  arr.pagination = { total: 0, page: 1, pageSize: 20, totalPages: 1 };
  arr.count = 0;
  return arr;
}

const OBJECT_RESPONSES = {
  '/tasks/dashboard': {
    summary: {
      notStarted: 0, assigned: 0, inProgress: 0, onHold: 0,
      submitted: 0, completed: 0, cancelled: 0, overdue: 0,
    },
    byStage: [],
  },
  '/assignments/stats': { total: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 },
  '/stock/summary': {
    companyItemCount: 0, companyStockValue: 0, finishedGoodsCount: 0,
    customerActiveLots: 0, materialAtVendorLines: 0, lowStockItems: [],
  },
  '/dashboard/summary': {
    invoices: [], jobcards: [], lowStock: [], recentInvoices: [],
    totals: { revenue: 0, outstanding: 0, growthPct: 0 },
  },
};

export function stubApi(user) {
  const api = globalThis.__apiMock;
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    const u = String(url).split('?')[0];
    if (u.includes('/auth/me')) return Promise.resolve({ data: { user } });
    const shaped = Object.keys(OBJECT_RESPONSES).find((k) => u.endsWith(k));
    if (shaped) return Promise.resolve({ data: OBJECT_RESPONSES[shaped] });
    return Promise.resolve({ data: makePage() });
  });
  return api;
}
