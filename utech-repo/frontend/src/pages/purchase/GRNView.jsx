import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, PackageCheck, ListPlus, RotateCcw, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import Modal from '../../components/ui/Modal';
import { styles } from '../../lib/formStyles';
import { useAuth } from '../../store/auth';
import { hasPermission } from '../../lib/permissions';
import toast from 'react-hot-toast';
import { inr, date } from '../../lib/format';

export default function GRNView() {
  const { id } = useParams();
  const [grn, setGrn] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  // set when the server refuses to reverse because the received stock is gone
  const [shortfall, setShortfall] = useState(null);
  const user = useAuth((s) => s.user);
  // the server only honours force for stock.adjust holders / Super Admin
  const canForce = hasPermission(user, 'stock.adjust');
  async function cancelGrn(force = false) {
    if (!reason.trim()) { toast.error('Enter a reason for cancelling the GRN'); return; }
    setCancelBusy(true);
    try {
      const { data } = await api.delete(`/grns/${id}`, { data: { reason: reason.trim(), force } });
      setGrn(data.grn);
      setCancelOpen(false);
      setShortfall(null);
      toast.success(force && data.forcedNegative ? 'GRN cancelled — stock reversed into negative' : 'GRN cancelled and stock reversed');
    } catch (err) {
      const message = err.response?.data?.message || 'Could not cancel GRN';
      // stock shortfall: keep the dialog open and explain exactly what is missing
      if (err.response?.status === 400 && /no longer on hand/i.test(message)) {
        setShortfall(message);
      } else {
        toast.error(message);
      }
    } finally { setCancelBusy(false); }
  }
  useEffect(() => { api.get(`/grns/${id}`).then((r) => setGrn(r.data)); }, [id]);
  if (!grn) return <div className="text-sm text-slate-500">Loading…</div>;

  const total = grn.lines.reduce((sum, l) => sum + (l.rate ? Number(l.qtyAccepted) * Number(l.rate) : 0), 0);

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title={`GRN ${grn.number}`}
        subtitle={`${grn.party?.name || '—'} • ${date(grn.date)}`}
        action={<div className="flex flex-wrap gap-2">
          <Link to="/grns" className="btn-secondary"><ArrowLeft className="h-4 w-4" /> Back</Link>
          {grn.status !== 'CANCELLED' && hasPermission(user, 'grn.delete') && <button type="button" className="btn-secondary text-danger-700" onClick={() => { setReason(''); setCancelOpen(true); }}><RotateCcw className="h-4 w-4" /> Cancel GRN</button>}
        </div>}
      />

      <FormSection icon={PackageCheck} title="Receipt Details" description={`Received on ${date(grn.date)}`}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
          <div><div className="text-xs text-slate-500">Vendor</div><div className="font-semibold text-slate-800">{grn.party?.name || '—'}</div></div>
          <div><div className="text-xs text-slate-500">PO</div><div className="font-semibold text-slate-800">{grn.po?.number || '—'}</div></div>
          <div><div className="text-xs text-slate-500">Vehicle No</div><div className="font-semibold text-slate-800">{grn.vehicleNo || '—'}</div></div>
          <div><div className="mb-0.5 text-xs text-slate-500">Status</div><Badge status={grn.status}>{grn.status}</Badge></div>
        </div>
        {grn.notes && (
          <div className="mt-4 border-t border-slate-100 pt-3"><div className="text-xs text-slate-500">Notes</div><div className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{grn.notes}</div></div>
        )}
      </FormSection>

      <FormSection icon={ListPlus} title="Item Lines" description={`${grn.lines.length} line${grn.lines.length === 1 ? '' : 's'} received`}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Item</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Qty</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Accepted</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grn.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">{l.item?.name || l.description || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qtyAccepted)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qtyRejected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.rate != null ? inr(l.rate) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{l.rate != null ? inr(Number(l.qtyAccepted) * Number(l.rate)) : '—'}</td>
                  <td className="px-3 py-2">{l.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="ml-auto mt-4 max-w-sm rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
            <div className="flex justify-between font-bold"><span>Total (accepted)</span><span className="font-mono tabular-nums">{inr(total)}</span></div>
          </div>
        )}
      </FormSection>
      <Modal open={cancelOpen} onClose={() => { if (!cancelBusy) { setCancelOpen(false); setShortfall(null); } }} title="Cancel this GRN?" size="md"
        footer={<>
          <button type="button" className={styles.secondaryBtn} onClick={() => { setCancelOpen(false); setShortfall(null); }} disabled={cancelBusy}>Keep GRN</button>
          {shortfall && canForce ? (
            <button type="button" className={styles.dangerBtn} onClick={() => cancelGrn(true)} disabled={cancelBusy}>
              {cancelBusy && <Loader2 className="h-4 w-4 animate-spin" />} Reverse anyway (negative stock)
            </button>
          ) : (
            <button type="button" className={styles.dangerBtn} onClick={() => cancelGrn(false)} disabled={cancelBusy}>
              {cancelBusy && <Loader2 className="h-4 w-4 animate-spin" />} Cancel GRN
            </button>
          )}
        </>}>
        <p className="mb-4 text-sm text-slate-600">This reverses accepted stock and the linked PO receipt. The cancellation is refused if the received material has already been consumed or dispatched — posting a negative balance would corrupt every valuation downstream.</p>
        <FormField id="grn-cancel-reason" label="Reason" required><textarea id="grn-cancel-reason" className={styles.textarea} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
        {shortfall && (
          <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-semibold">Stock is no longer available</div>
            <p className="mt-1">{shortfall}</p>
            <p className="mt-2">
              {canForce
                ? 'As a stock administrator you may reverse anyway, but the item balance will go negative and the ledger will record it as a forced reversal.'
                : 'Post a stock adjustment for the missing quantity first, or ask a stock administrator to reverse it.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
