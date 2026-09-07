import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Send, PackageCheck, AlertTriangle,
  FileText, Factory, Truck, ShoppingCart,
} from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import SendToVendorModal from '../../components/vendorWorkOrders/SendToVendorModal';
import RecordReturnModal from '../../components/vendorWorkOrders/RecordReturnModal';
import VendorWorkOrderTrail from '../../components/vendorWorkOrders/VendorWorkOrderTrail';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import { date as fmtDate, inr, VWO_STATUS_LABELS, isVwoOverdue } from '../../lib/format';

export default function VendorWorkOrderView() {
  const { id } = useParams();
  const user = useAuth((s) => s.user);
  const [v, setV] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

  async function load() {
    try {
      const r = await api.get(`/vendor-work-orders/${id}`);
      setV(r.data);
    } catch (err) {
      setLoadError(err.response?.status === 403 ? 'forbidden' : 'not-found');
    }
  }
  useEffect(() => { load(); }, [id]);

  if (loadError) return (
    <div className="card p-10 text-center max-w-md mx-auto mt-10">
      <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
      <div className="font-semibold text-slate-800 mb-1">
        {loadError === 'forbidden' ? 'Not your work order' : 'Work order not found'}
      </div>
      <div className="text-sm text-slate-500 mb-4">
        {loadError === 'forbidden'
          ? 'This vendor work order is outside your department scope.'
          : "This work order doesn't exist or was removed."}
      </div>
      <Link to="/vendor-work-orders" className="btn-secondary">Back to list</Link>
    </div>
  );

  if (!v) return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-10">
      <div className="w-4 h-4 border-2 border-slate-300 border-t-brand-500 rounded-full animate-spin" />
      Loading…
    </div>
  );

  const canUpdate = hasPermission(user, 'vendorWorkOrder.update');
  const isDraft = v.status === 'DRAFT';
  const outstandingAll = (v.lines || []).some(
    (l) => Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected) > 0
  );
  const canReceive = canUpdate && !isDraft && v.status !== 'RECEIVED' && v.status !== 'SHORT_CLOSED' && v.status !== 'CANCELLED' && !v.po && outstandingAll;

  return (
    <div>
      <PageHeader
        title={`VWO ${v.number}`}
        subtitle={`${v.party?.name || '—'} • ${fmtDate(v.date)}`}
        action={
          <div className="flex gap-2">
            <Link to="/vendor-work-orders" className="btn-secondary"><ArrowLeft className="w-4 h-4" /> Back</Link>
            {isDraft && canUpdate && (
              <Link to={`/vendor-work-orders/${id}/edit`} className="btn-secondary"><Pencil className="w-4 h-4" /> Edit</Link>
            )}
            {isDraft && canUpdate && (
              <button className="btn-primary" onClick={() => setShowSend(true)}><Send className="w-4 h-4" /> Send to Vendor</button>
            )}
            {canReceive && (
              <button className="btn-primary" onClick={() => setShowReceive(true)}><PackageCheck className="w-4 h-4" /> Record Return</button>
            )}
          </div>
        }
      />

      <div className="card p-6 max-w-6xl space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Factory className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Vendor</span>
            </div>
            <div className="font-bold text-lg text-slate-900">{v.party?.name || '—'}</div>
            {v.department && <div className="text-sm text-slate-500">Department: {v.department.name}</div>}
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge status={v.status}>{VWO_STATUS_LABELS[v.status] || v.status}</Badge>
            {isVwoOverdue(v) && (
              <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" /> Overdue at vendor
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Sent Out', value: fmtDate(v.sentDate) },
            { label: 'Expected Back', value: fmtDate(v.expectedReturnDate) },
            { label: 'Returned On', value: fmtDate(v.actualReturnDate) },
            { label: 'Purchase Order', value: v.po ? v.po.number : '—' },
          ].map((s) => (
            <div key={s.label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <div className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">{s.label}</div>
              <div className="text-sm font-semibold text-slate-800 mt-0.5">{s.value}</div>
            </div>
          ))}
        </div>

        {(v.scopeDescription || v.instructions || v.notes) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {v.scopeDescription && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Scope</div>
                <div className="text-sm text-slate-700">{v.scopeDescription}</div>
              </div>
            )}
            {v.instructions && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Instructions</div>
                <div className="text-sm text-slate-700">{v.instructions}</div>
              </div>
            )}
            {v.notes && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Notes</div>
                <div className="text-sm text-slate-700">{v.notes}</div>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Truck className="w-4 h-4 text-brand-600" />
            <div className="font-semibold text-sm text-slate-800">Lines</div>
          </div>
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th rounded-tl-lg">Item / Description</th>
                  <th className="table-th">Drg / Part No</th>
                  <th className="table-th text-right">Sent</th>
                  <th className="table-th text-right">Received</th>
                  <th className="table-th text-right">Rejected</th>
                  <th className="table-th text-right">Outstanding</th>
                  <th className="table-th text-right rounded-tr-lg">Rate</th>
                </tr>
              </thead>
              <tbody>
                {(v.lines || []).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-sm text-slate-400 text-center">No lines</td></tr>
                ) : (v.lines || []).map((l, i) => {
                  const outstanding = Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected);
                  return (
                    <tr key={l.id} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                      <td className="table-td font-medium">
                        {l.item?.name || l.description || '—'}
                        {l.uomCode && <span className="text-slate-400 text-xs"> ({l.uomCode})</span>}
                      </td>
                      <td className="table-td">{[l.drawingNumber, l.partNumber].filter(Boolean).join(' / ') || '—'}</td>
                      <td className="table-td text-right tabular-nums font-mono">{Number(l.qtySent)}</td>
                      <td className="table-td text-right tabular-nums font-mono text-emerald-600">{Number(l.qtyReceived)}</td>
                      <td className="table-td text-right tabular-nums font-mono text-red-600">{Number(l.qtyRejected)}</td>
                      <td className="table-td text-right tabular-nums font-mono font-semibold">{outstanding}</td>
                      <td className="table-td text-right tabular-nums font-mono">{l.rate == null ? '—' : inr(l.rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {v.po && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <ShoppingCart className="w-4 h-4 text-brand-600" />
              <span>
                Purchase order <span className="font-semibold">{v.po.number}</span> ({v.po.status}) — returns are booked through a GRN.
              </span>
            </div>
            <Link to={`/purchase-orders/${v.po.id}`} className="btn-secondary !px-2 !py-1 text-xs">Open PO</Link>
          </div>
        )}

        {v.assignment && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-brand-600" />
              <div className="font-semibold text-sm text-slate-800">Work orders from this assignment</div>
            </div>
            <VendorWorkOrderTrail
              workOrders={(v.assignment.vendorWorkOrders || []).filter((w) => w.id !== v.id)}
              emptyHint="This is the only work order raised from the assigned document so far."
            />
          </div>
        )}
      </div>

      {showSend && (
        <SendToVendorModal
          workOrder={v}
          onClose={() => setShowSend(false)}
          onSaved={load}
        />
      )}
      {showReceive && (
        <RecordReturnModal
          workOrder={v}
          onClose={() => setShowReceive(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
