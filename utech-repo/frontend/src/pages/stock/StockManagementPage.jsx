import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes, Users, Truck, Cog, AlertTriangle, PackageCheck,
  ArrowDownToLine, ArrowUpFromLine, ListFilter, SlidersHorizontal, Loader2, Plus,
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
  { key: 'companyStock', label: 'Company items', icon: Boxes, color: 'text-brand-600 bg-brand-50' },
  { key: 'customerLots', label: 'Customer Lots', icon: Users, color: 'text-brand-700 bg-brand-100' },
  { key: 'atVendor', label: 'At vendor (mixed units)', icon: Truck, color: 'text-warning-600 bg-warning-50' },
  { key: 'inProcess', label: 'In process (batches & lots)', icon: Cog, color: 'text-slate-600 bg-slate-100' },
  { key: 'lowStock', label: 'Low Stock', icon: AlertTriangle, color: 'text-danger-600 bg-danger-50' },
  { key: 'finishedGoods', label: 'Finished item types', icon: PackageCheck, color: 'text-success-600 bg-success-50' },
  { key: 'todayInward', label: "Inward documents today", icon: ArrowDownToLine, color: 'text-success-600 bg-success-50' },
  { key: 'todayOutward', label: "Outward documents today", icon: ArrowUpFromLine, color: 'text-warning-600 bg-warning-50' },
];

export default function StockManagementPage() {
  const user = useAuth((s) => s.user);
  // the backend requires the stock.adjust permission on POST /stock/adjust
  // (a dedicated key, not part of the seeded module CRUD) — hide the form
  // instead of letting users fill it and hit a guaranteed 403
  const canAdjust = hasPermission(user, 'stock.adjust');
  const canReadItems = hasPermission(user, 'item.read');
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [ledgerItem, setLedgerItem] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [items, setItems] = useState([]);
  const [adj, setAdj] = useState({ itemId: '', qty: '', notes: '' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [ledgerError, setLedgerError] = useState(false);
  const [itemError, setItemError] = useState(false);
  const itemRequest = useRef(0);

  async function loadSummary() {
    try { const r = await api.get('/stock/summary'); setSummary(r.data); setSummaryError(false); }
    catch { setSummaryError(true); }
  }
  async function loadLedger() {
    try {
      const r = await api.get('/stock/ledger', { params: {
        ownerType: ownerFilter || undefined, itemId: ledgerItem || undefined,
        from: fromDate || undefined, to: toDate || undefined,
      } });
      setLedger(r.data); setLedgerError(false);
    } catch { setLedgerError(true); }
  }
  const loadItems = useCallback(async (query = '') => {
    const request = ++itemRequest.current;
    try {
      const r = await api.get('/items', { params: { pageSize: 100, q: query } });
      if (request === itemRequest.current) {
        setItems((old) => [...new Map([...old, ...r.data.items].map((item) => [String(item.id), item])).values()]);
        setItemError(false);
      }
    } catch { if (request === itemRequest.current) setItemError(true); }
  }, []);
  useEffect(() => { loadSummary(); if (canReadItems) loadItems(); }, [canReadItems, loadItems]);
  useEffect(() => { loadLedger(); }, [ownerFilter, ledgerItem, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const cardValues = summary ? {
    companyStock: nf.format(summary.companyInventory.activeItems || 0),
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
    if (!adj.itemId || !Number.isFinite(Number(adj.qty)) || Number(adj.qty) === 0) {
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
      await Promise.all([loadSummary(), loadLedger(), loadItems()]);
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
        subtitle="Track movements across your company and customer-owned inventory"
        action={<div className="flex flex-wrap gap-2">{hasPermission(user, 'item.read') && <Link to="/items" className="btn-secondary">View items</Link>}{hasPermission(user, 'grn.create') && <Link to="/grns/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden="true" /> Receive stock</Link>}</div>}
      />
      {summaryError && <div role="alert" className="mb-4 rounded-lg border border-danger-100 bg-danger-50 p-3 text-sm text-danger-700">Could not load stock summary. <button type="button" className="font-bold underline" onClick={loadSummary}>Try again</button></div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {CARD_META.map((c) => (
          <div key={c.key} className="card-flat p-4 min-h-[96px] flex items-start gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.color}`} aria-hidden="true">
              <c.icon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <div className="text-xl font-bold text-slate-900 tabular-nums">{summary ? cardValues[c.key] : '—'}</div>
              <div className="mt-1 text-[11px] leading-4 text-slate-500 font-bold uppercase tracking-wide">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-3 rounded-xl border border-brand-100 bg-brand-50/70 p-4 text-sm text-slate-600 md:grid-cols-2">
        <div><span className="block font-bold text-slate-800">Company inventory</span><span className="block mt-1 leading-6">{summary ? summary.companyInventory.activeItems : '—'} active items · Approx. {summary ? inr(summary.companyInventory.stockValue || 0) : '—'} at purchase rate. A dispatch moves stock out; an invoice alone does not.</span></div>
        <div><span className="block font-bold text-slate-800">Customer material</span><span className="block mt-1 leading-6">Tracked separately from company stock. There is no stock reservation / allocation flow yet.</span></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-flat p-5">
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-800">
            <ListFilter className="w-4 h-4 text-brand-600" /> Stock Ledger
          </div>
          <p className="mb-3 text-xs text-slate-500">Latest 500 movements, in posting order. Document dates can differ.</p>

          {/* filter card — labeled control consistent with the shared form styles */}
          <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <FormField id="ledger-owner" label="Owner">
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
            {canReadItems && <FormField id="ledger-item" label="Item">
              <SearchableSelect id="ledger-item" value={ledgerItem} onChange={setLedgerItem} placeholder="All items"
                options={items.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` }))}
                onSearchChange={loadItems} />
            </FormField>}
            <FormField id="ledger-from" label="Document date from"><input id="ledger-from" type="date" className={styles.input} value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></FormField>
            <FormField id="ledger-to" label="Document date to"><input id="ledger-to" type="date" className={styles.input} value={toDate} onChange={(e) => setToDate(e.target.value)} /></FormField>
          </div>

          {ledgerError && <div role="alert" className="mb-3 rounded-lg bg-danger-50 p-3 text-sm text-danger-700">Could not load the stock ledger. <button type="button" className="font-bold underline" onClick={loadLedger}>Try again</button></div>}
          <p className="mb-2 text-xs text-slate-500">Scroll sideways to see all ledger columns when needed.</p>
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto rounded-lg border border-slate-100">
            <table className="min-w-[660px] w-full">
              <thead><tr>
                <th className="table-th !px-2 rounded-tl-lg sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Posted</th>
                <th className="table-th !px-2 sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Owner</th>
                <th className="table-th !px-2 sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Item / Lot</th>
                <th className="table-th !px-2 sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Type</th>
                <th className="table-th !px-2 text-right sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">In</th>
                <th className="table-th !px-2 text-right sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Out</th>
                <th className="table-th !px-2 text-right rounded-tr-lg sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Balance</th>
              </tr></thead>
              <tbody>
                {ledgerError ? null : ledger.length === 0 ? (
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
                    <td className="table-td !px-2 whitespace-nowrap">{datetime(r.createdAt || r.date)}</td>
                    <td className="table-td !px-2 whitespace-nowrap"><Badge status={r.ownerType} /></td>
                    <td className="table-td !px-2">{r.item ? r.item.name : (r.customerMaterialLot?.inwardNumber || '—')}</td>
                    <td className="table-td !px-2 whitespace-nowrap">{(r.refType || '').replace(/_/g, ' ')}</td>
                    <td className="table-td !px-2 text-right text-success-600 tabular-nums">{Number(r.qtyIn) || ''}</td>
                    <td className="table-td !px-2 text-right text-danger-600 tabular-nums">{Number(r.qtyOut) || ''}</td>
                    <td className="table-td !px-2 text-right font-semibold tabular-nums">{Number(r.balance)}</td>
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
          <p className="text-xs leading-5 text-slate-500 mb-3">For stock corrections only. Use a positive quantity to add or a negative quantity to remove. Every adjustment is recorded.</p>
          {itemError && <p role="alert" className="mb-3 text-sm text-danger-700">Could not load items. <button type="button" className="font-bold underline" onClick={() => loadItems()}>Try again</button></p>}
          <form onSubmit={requestAdjustment} className="space-y-3">
            <FormField id="adj-item" label="Item" required hint="Search by item name or code">
              <SearchableSelect
                id="adj-item"
                value={adj.itemId}
                onChange={(v) => setAdj({ ...adj, itemId: v })}
                options={items.map((it) => ({
                  value: it.id,
                  label: `${it.code} — ${it.name}`,
                  subtitle: `Current stock: ${Number(it.currentStock)}`,
                }))}
                placeholder="Select or search item…"
                onSearchChange={loadItems}
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
        message={`This ${Number(adj.qty) > 0 ? 'adds' : 'removes'} ${Math.abs(Number(adj.qty) || 0)} units ${Number(adj.qty) > 0 ? 'to' : 'from'} company stock immediately. The movement remains in the ledger.`}
        confirmLabel="Apply Adjustment"
        loading={busy}
      />
    </div>
  );
}
