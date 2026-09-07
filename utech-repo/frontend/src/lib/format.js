export const inr = (n) =>
  '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

// local-date-safe YYYY-MM-DD for <input type="date"> prefills — toISOString()
// renders *yesterday* between 00:00–05:30 IST (UTC conversion), this doesn't
export const toLocalInput = (d = new Date()) => {
  const dt = d instanceof Date ? d : new Date(d);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
};

export const todayLocal = () => toLocalInput(new Date());

export const datetime = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const STATUS_COLORS = {
  DRAFT: 'bg-slate-100 text-slate-700',
  ISSUED: 'bg-blue-100 text-blue-700',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  OVERDUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-red-100 text-red-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  ON_HOLD: 'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  REVERTED: 'bg-orange-100 text-orange-700',
  ISSUED_JW: 'bg-blue-100 text-blue-700',
  PARTIAL_RECEIVED: 'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700',
  DISPATCHED: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  NOT_STARTED: 'bg-slate-100 text-slate-700',
  TESTING: 'bg-purple-100 text-purple-700',
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-amber-100 text-amber-700',
  URGENT: 'bg-red-100 text-red-700',
  IN_PROCESS: 'bg-blue-100 text-blue-700',
  AT_VENDOR: 'bg-purple-100 text-purple-700',
  CONSUMED: 'bg-slate-100 text-slate-700',
  RETURNED_TO_CUSTOMER: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  // vendor work order / purchase order lifecycle
  SENT: 'bg-indigo-100 text-indigo-700',
  SHORT_CLOSED: 'bg-orange-100 text-orange-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  PARTIALLY_RECEIVED: 'bg-amber-100 text-amber-700',
  ASSIGNED: 'bg-slate-100 text-slate-700',
  REOPENED: 'bg-orange-100 text-orange-700',
  // task 6-d additive fills — statuses that pages were remapping through
  // unrelated keys (e.g. ACTIVE→'PAID', PLANNED→'DRAFT') because these were
  // missing. No existing keys changed; only new soft tones from the same palette.
  ACTIVE: 'bg-success-100 text-success-700',
  INACTIVE: 'bg-slate-100 text-slate-600',
  MAINTENANCE: 'bg-amber-100 text-amber-700',
  PLANNED: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-amber-100 text-amber-700',
  DONE: 'bg-success-100 text-success-700',
  OPEN: 'bg-blue-100 text-blue-700',
  CLOSED: 'bg-slate-100 text-slate-600',
  EXPIRED: 'bg-red-100 text-red-700',
  ACCEPTED: 'bg-success-100 text-success-700',
  DECLINED: 'bg-red-100 text-red-700',
};

// Vendor-facing wording over the raw VendorWorkOrderStatus enum — "SENT" means
// the scope is physically outside the company, which is what everyone watching
// a project actually wants to read.
export const VWO_STATUS_LABELS = {
  DRAFT: 'Draft',
  SENT: 'At Vendor',
  PARTIAL_RECEIVED: 'Partly Returned',
  RECEIVED: 'Returned',
  SHORT_CLOSED: 'Short Closed',
  CANCELLED: 'Cancelled',
};

// statuses where the work is still outstanding at the vendor
export const VWO_OPEN_STATUSES = ['DRAFT', 'SENT', 'PARTIAL_RECEIVED'];

export const isVwoOverdue = (v) =>
  !!v.expectedReturnDate &&
  new Date(v.expectedReturnDate) < new Date() &&
  VWO_OPEN_STATUSES.includes(v.status);
