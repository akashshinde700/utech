import { useEffect, useState } from 'react';
import {
  Boxes, Users, Truck, Cog, AlertTriangle, PackageCheck,
  ArrowDownToLine, ArrowUpFromLine, ListFilter, SlidersHorizontal, Loader2,
} from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import Badge from '../../components/ui/Badge';
import { datetime, inr } from '../../lib/format';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import { styles } from '../../lib/formStyles';
import toast from 'react-hot-toast';

// Summary chip tones — brand/success/warning/danger/slate tokens only (the raw
// blue/purple/cyan/emerald scales are aliased or forbidden in this config).
const CARD_META = [
  { key: 'companyStock', label: 'Company Stock (qty)', icon: Boxes, color: 'text-brand-600 bg-brand-50' },
  { key: 'customerLots', label: 'Customer Lots', icon: Users, color: 'text-brand-700 bg-brand-100' },
  { key: 'atVendor', label: 'Material at Vendor', icon: Truck, color: 'text-warning-600 bg-warning-50' },
  { key: 'inProcess', label: 'Material In Process', icon: Cog, color: 'text-slate-600 bg-slate-100' },
  { key: 'lowStock', label: 'Low Stock', icon: AlertTriangle, color: 'text-danger-600 bg-danger-50' },
  { key: 'finishedGoods', label: 'Finished Goods', icon: PackageCheck, color: 'text-success-600 bg-success-50' },
  { key: 'todayInward', label: "Today's Inward", icon: ArrowDownToLine, color: 'text-success-600 bg-success-50' },
  { key: 'todayOutward', label: "Today's Outward", icon: ArrowUpFromLine, color: 'text-warning-600 bg-warning-50' },
];

export default function StockManagementPage() {
  const user = useAuth((s) => s.user);
  // the backend requires the stock.adjust permission on POST /stock/adjust
  // (a dedicated key, not part of the seeded module CRUD) — hide the form
  // instead of letting users fill it and hit a guaranteed 403
  const canAdjust = hasPermission(user, 'stock.adjust');
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [items, setItems] = useState([]);
  const [adj, setAdj] = useState({ itemId: '', qty: '', notes: '' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadSummary() { const r = await api.get('/stock/summary'); setSummary(r.data); }
  async function loadLedger() {
    const r = await api.get('/stock/ledger', { params: { ownerType: ownerFilter || undefined } });
    setLedger(r.data);
  }
  useEffect(() => { loadSummary(); api.get('/items', { params: { pageSize: 300 } }).then((r) => setItems(r.data.items)); }, []);
  useEffect(() => { loadLedger(); }, [ownerFilter]);

  const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const cardValues = summary ? {
    companyStock: nf.format(summary.companyInventory.totalStockQty || 0),
    customerLots: summary.customerInventory.activeLots,
    atVendor: summary.materialAtVendor.company + summary.materialAtVendor.customer,
    inProcess: summary.materialInProcess,
    lowStock: summary.companyInventory.lowStockCount,
    finishedGoods: summary.companyInventory.finishedGoods,
    todayInward: summary.todayInward,
    todayOutward: summary.todayOutward,
  } : {};

  function requestAdjustment(e) {
    e.preventDefault();
    if (!adj.itemId || !adj.qty) {
      toast.error('Select an item and enter a quantity');
      return;
    }
    setConfirmOpen(true);
  }

  async function submitAdjustment() {
    setBusy(true);
    try {
      await api.post('/stock/adjust', { itemId: Number(adj.itemId), qty: Number(adj.qty), notes: adj.notes || null });
      toast.success('Stock adjusted');
      setAdj({ itemId: '', qty: '', notes: '' });
      setConfirmOpen(false);
      loadSummary(); loadLedger();
    } catch (err) {
      // was a silent bare catch — failures now surface like every other page
      toast.error(err.response?.data?.message || 'Failed to adjust stock');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Stock Management"
        subtitle="Monitors both inventories — never merges Company and Customer stock"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {CARD_META.map((c) => (
          <div key={c.key} className="card p-4 flex items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.color}`} aria-hidden="true">
              <c.icon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <div className="text-xl font-bold text-slate-900 tabular-nums">{summary ? cardValues[c.key] : '—'}</div>
              <div className="text-[11px] text-slate-500 font-medium uppercase tracking-wide truncate">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4 mb-6 flex flex-wrap items-center gap-4 text-sm text-slate-600 bg-slate-50/60">
        <div>
          <span className="font-semibold text-slate-800">Company Inventory</span> —{' '}
          {summary ? summary.companyInventory.activeItems : '—'} active items,
          valued ≈{' '}
          <span className="tabular-nums">
            {summary ? inr(summary.companyInventory.stockValue || 0) : '—'}
          </span>{' '}
          (qty × purchase rate). Owned by the company; sold via invoices.
        </div>
        <div className="text-slate-400">•</div>
        <div>
          <span className="font-semibold text-slate-800">Customer Inventory</span> — material customers
          sent in for job work. Held &amp; processed, never owned or billed.
        </div>
        <div className="text-slate-400">•</div>
        <div><span className="font-semibold text-slate-800">Reserved Stock</span> = 0 (no order-allocation flow exists in the app yet — flagged as an open item).</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-flat p-5">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-800">
            <ListFilter className="w-4 h-4 text-brand-600" /> Stock Ledger
          </div>

          {/* filter card — labeled control consistent with the shared form styles */}
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
            <FormField id="ledger-owner" label="Owner" className="max-w-[220px]">
              <select
                id="ledger-owner"
                className={`${styles.input} !h-9 text-sm`}
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="">All owners</option>
                <option value="COMPANY">Company</option>
                <option value="CUSTOMER">Customer</option>
              </select>
            </FormField>
          </div>

          <div className="overflow-x-auto max-h-[480px] overflow-y-auto rounded-lg border border-slate-100">
            <table className="min-w-full">
              <thead><tr>
                <th className="table-th rounded-tl-lg sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Date</th>
                <th className="table-th sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Owner</th>
                <th className="table-th sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Item / Lot</th>
                <th className="table-th sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Type</th>
                <th className="table-th text-right sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">In</th>
                <th className="table-th text-right sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Out</th>
                <th className="table-th text-right rounded-tr-lg sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Balance</th>
              </tr></thead>
              <tbody>
                {ledger.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        icon={ListFilter}
                        title="No stock movements"
                        description="Ledger entries appear here as soon as stock moves — GRNs, dispatches, adjustments."
                      />
                    </td>
                  </tr>
                ) : ledger.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="table-td whitespace-nowrap">{datetime(r.date)}</td>
                    <td className="table-td"><Badge status={r.ownerType} /></td>
                    <td className="table-td">{r.item ? r.item.name : (r.customerMaterialLot?.inwardNumber || '—')}</td>
                    <td className="table-td">{(r.refType || '').replace(/_/g, ' ')}</td>
                    <td className="table-td text-right text-success-600 tabular-nums">{Number(r.qtyIn) || ''}</td>
                    <td className="table-td text-right text-danger-600 tabular-nums">{Number(r.qtyOut) || ''}</td>
                    <td className="table-td text-right font-semibold tabular-nums">{Number(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {canAdjust && (
        <div className="card-flat p-5 h-fit">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-800">
            <SlidersHorizontal className="w-4 h-4 text-brand-600" /> Manual Adjustment
          </div>
          <p className="text-xs text-slate-500 mb-3">Company stock only — every adjustment is audit-logged.</p>
          <form onSubmit={requestAdjustment} className="space-y-3">
            <FormField id="adj-item" label="Item" required>
              <SearchableSelect
                id="adj-item"
                value={adj.itemId}
                onChange={(v) => setAdj({ ...adj, itemId: v })}
                options={items.map((it) => ({
                  value: it.id,
                  label: `${it.code} — ${it.name}`,
                  subtitle: `Current stock: ${Number(it.currentStock)}`,
                }))}
                placeholder="Select item…"
              />
            </FormField>
            <FormField id="adj-qty" label="Quantity (+ in / − out)" required>
              <input
                id="adj-qty"
                required
                type="number"
                step="0.001"
                className={styles.input}
                value={adj.qty}
                onChange={(e) => setAdj({ ...adj, qty: e.target.value })}
              />
            </FormField>
            <FormField id="adj-notes" label="Reason" hint="Optional — stored on the audit log">
              <input
                id="adj-notes"
                className={styles.input}
                value={adj.notes}
                onChange={(e) => setAdj({ ...adj, notes: e.target.value })}
              />
            </FormField>
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Applying…
                </>
              ) : (
                'Apply Adjustment'
              )}
            </button>
          </form>
        </div>
        )}
      </div>

      {summary?.lowStockItems?.length > 0 && (
        <div className="card p-5 mt-6">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-danger-700">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Low Stock Items
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {summary.lowStockItems.map((i) => (
              <div key={i.id} className="text-xs bg-danger-50 border border-danger-100 rounded-lg px-3 py-2">
                <div className="font-medium text-slate-800">{i.name}</div>
                <div className="text-danger-600 tabular-nums">{Number(i.currentStock)} / min {Number(i.minStock)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submitAdjustment}
        title="Apply this stock adjustment?"
        message="It changes company stock immediately and is permanent."
        confirmLabel="Apply Adjustment"
        loading={busy}
      />
    </div>
  );
}
