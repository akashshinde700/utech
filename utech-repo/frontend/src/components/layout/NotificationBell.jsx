import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, ArrowRight } from 'lucide-react';
import api from '../../lib/api';
import { datetime } from '../../lib/format';
import useClickOutside from '../../lib/useClickOutside';
import EmptyState from '../ui/EmptyState';

// notification.refType → detail route (refId appended when present). Anything
// unmapped falls back to a sensible section page via typePrefix below.
const REF_TYPE_ROUTES = {
  VENDOR_WORK_ORDER: '/vendor-work-orders',
  JOBCARD: '/jobcards',
  JOBWORK: '/jobwork',
  ASSIGNMENT: '/assignments',
  INVOICE: '/invoices',
  QUOTATION: '/quotations',
  GRN: '/grns',
  DISPATCH: '/dispatch',
  SALES_RETURN: '/sales-returns',
  PURCHASE_RETURN: '/purchase-returns',
  PURCHASE_ORDER: '/purchase-orders',
};

// notification.type prefix → route used when there's no known refType
const TYPE_PREFIX_ROUTES = [
  ['VENDOR_WORK_ORDER', '/vendor-work-orders'],
  ['JOBCARD', '/jobcards'],
  ['JOBWORK', '/jobwork'],
  ['ASSIGNMENT', '/assignments'],
  ['INVOICE', '/invoices'],
  ['QUOTATION', '/quotations'],
  ['LOW_STOCK', '/items'],
  ['STOCK', '/stock'],
  ['GRN', '/grns'],
  ['DISPATCH', '/dispatch'],
  ['SALES_RETURN', '/sales-returns'],
  ['PURCHASE_RETURN', '/purchase-returns'],
  ['PURCHASE_ORDER', '/purchase-orders'],
];

// pick the most relevant page for a notification: detail route when we know
// the referenced record, else the section page, else null (stay put)
export function routeForNotification(n) {
  const refType = (n.refType || '').toUpperCase();
  if (refType && REF_TYPE_ROUTES[refType]) {
    return n.refId != null ? `${REF_TYPE_ROUTES[refType]}/${n.refId}` : REF_TYPE_ROUTES[refType];
  }
  const type = (n.type || '').toUpperCase();
  const hit = TYPE_PREFIX_ROUTES.find(([prefix]) => type.startsWith(prefix));
  if (hit) {
    // a few types carry a usable refId even without a matching refType
    if (n.refId != null && ['INVOICE', 'QUOTATION', 'VENDOR_WORK_ORDER', 'JOBCARD'].includes(hit[0])) {
      return `${hit[1]}/${n.refId}`;
    }
    return hit[1];
  }
  return null;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const boxRef = useRef(null);
  const navigate = useNavigate();

  async function loadCount() {
    try {
      const r = await api.get('/notifications/unread-count');
      setCount(r.data.count);
    } catch {}
  }

  async function loadList() {
    try {
      const r = await api.get('/notifications');
      setItems(r.data);
    } catch {}
  }

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000);
    return () => clearInterval(t);
  }, []);

  // outside click + Escape both dismiss the popover (shared hook)
  useClickOutside(boxRef, () => setOpen(false), { active: open });

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await loadList();
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all');
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setCount(0);
    } catch {}
  }

  async function markOneRead(id) {
    try {
      await api.post(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      loadCount();
    } catch {}
  }

  // clicking a notification: mark read (as before) + jump to the related page
  async function onNotificationClick(n) {
    setOpen(false);
    if (!n.isRead) await markOneRead(n.id);
    const to = routeForNotification(n);
    if (to) navigate(to);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" className="relative btn-icon" onClick={toggle} aria-label="Notifications" aria-expanded={open}>
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] leading-none rounded-full w-4 h-4 flex items-center justify-center font-medium shadow-sm">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg p-1.5 z-50 animate-fade-in">
          <div className="flex items-center justify-between px-2.5 py-2 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            {items.some((n) => !n.isRead) && (
              <button type="button" className="text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1 rounded px-1 py-0.5 transition-colors" onClick={markAllRead}>
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="No notifications"
                description="Alerts about jobcards, invoices and stock will show up here."
                className="!px-3 !py-6"
              />
            ) : (
              items.map((n) => {
                const hasRoute = !!routeForNotification(n);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onNotificationClick(n)}
                    title={hasRoute ? 'Open related page' : undefined}
                    className={`group relative w-full text-left rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ${
                      n.isRead ? '' : 'bg-brand-50/40'
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      {/* unread dot */}
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.isRead ? 'bg-transparent' : 'bg-brand-500'}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-slate-800 font-medium">{n.title}</span>
                        {n.body && <span className="block text-xs text-slate-500 mt-0.5">{n.body}</span>}
                        <span className="block text-[11px] text-slate-400 mt-1">{datetime(n.createdAt)}</span>
                      </span>
                      {hasRoute && (
                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
