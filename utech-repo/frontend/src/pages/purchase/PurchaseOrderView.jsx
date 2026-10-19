import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ShoppingCart, ListPlus, FileText, Plus, Check, X } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import FormSection from '../../components/ui/FormSection';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import FormField from '../../components/ui/FormField';
import { styles } from '../../lib/formStyles';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import { inr, date } from '../../lib/format';
import toast from 'react-hot-toast';

export default function PurchaseOrderView() {
  const { id } = useParams();
  const user = useAuth((s) => s.user);
  const canDecide = hasPermission(user, 'purchase.update');
  const [po, setPo] = useState(null);
  const [decision, setDecision] = useState(null); // 'approve' | 'reject'
  const [rejectReason, setRejectReason] = useState('');
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(() => {
    api.get(`/purchase-orders/${id}`).then((r) => setPo(r.data));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  if (!po) return <div className="text-sm text-slate-500">Loading…</div>;

  const canApproveOrReject = canDecide && ['DRAFT', 'PENDING_APPROVAL'].includes(po.status);
  const canCreateGrn = ['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status);

  async function handleApprove() {
    setDeciding(true);
    try {
      await api.post(`/purchase-orders/${id}/approve`);
      toast.success('Purchase order approved');
      setDecision(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve PO');
    } finally {
      setDeciding(false);
    }
  }

  async function handleReject() {
    setDeciding(true);
    try {
      await api.post(`/purchase-orders/${id}/reject`, { reason: rejectReason.trim() });
      toast.success('Purchase order rejected');
      setDecision(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reject PO');
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title={`PO ${po.number}`}
        subtitle={`${po.party?.name ?? '—'} • ${date(po.date)}`}
        action={
          <div className="flex items-center gap-2">
            {canApproveOrReject && (
              <>
                <button type="button" className="btn-primary" onClick={() => setDecision('approve')}>
                  <Check className="h-4 w-4" /> Approve
                </button>
                <button type="button" className="btn-danger" onClick={() => { setRejectReason(''); setDecision('reject'); }}>
                  <X className="h-4 w-4" /> Reject
                </button>
              </>
            )}
            {canCreateGrn && (
              <Link to={`/grns/new?poId=${po.id}`} className="btn-primary">
                <Plus className="h-4 w-4" /> Create GRN
              </Link>
            )}
          </div>
        }
      />

      <FormSection icon={ShoppingCart} title="PO Details" description={`Raised on ${date(po.date)} — current status shown below`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">Vendor</div>
            <div className="font-semibold">{po.party?.name ?? '—'}</div>
          </div>
          <Badge status={po.status}>{po.status}</Badge>
        </div>
      </FormSection>

      <FormSection icon={ListPlus} title="Item Lines" description={`${(po.lines || []).length} line${(po.lines || []).length === 1 ? '' : 's'} ordered`}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Item</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Ordered</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Received</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(po.lines || []).map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">{l.item?.name}</td>
                  <td className="px-3 py-2">{l.description || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qtyReceived)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(l.rate)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{inr(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-4 max-w-sm rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="font-mono tabular-nums">{inr(po.subtotal)}</span></div>
          <div className="flex justify-between"><span>GST</span><span className="font-mono tabular-nums">{inr(po.gstTotal)}</span></div>
          <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span className="font-mono tabular-nums">{inr(po.total)}</span></div>
        </div>
      </FormSection>

      {po.grns && po.grns.length > 0 && (
        <FormSection icon={FileText} title="Goods Receipts" description={`${po.grns.length} GRN${po.grns.length === 1 ? '' : 's'} booked against this order`}>
          <ul className="text-sm space-y-1">
            {po.grns.map((g) => <li key={g.id}>{g.number} — {date(g.date)} — {g.status}</li>)}
          </ul>
        </FormSection>
      )}

      <ConfirmDialog
        open={decision === 'approve'}
        onClose={() => setDecision(null)}
        onConfirm={handleApprove}
        title="Approve this purchase order?"
        message={`${po.number || 'This PO'} will move to APPROVED and become open for goods receipts.`}
        confirmLabel="Approve"
        loading={deciding}
      />

      <Modal
        open={decision === 'reject'}
        onClose={() => setDecision(null)}
        title="Reject this purchase order?"
        description="The vendor request is cancelled — record why so the trail stays clear."
        size="md"
        footer={
          <>
            <button type="button" className={styles.secondaryBtn} onClick={() => setDecision(null)} disabled={deciding}>Cancel</button>
            <button
              type="button"
              className={styles.dangerBtn}
              disabled={deciding || !rejectReason.trim()}
              onClick={handleReject}
            >
              Reject
            </button>
          </>
        }
      >
        <FormField id="reject-reason" label="Rejection reason" required htmlFor="reject-reason">
          <textarea
            id="reject-reason"
            className={styles.textarea}
            placeholder="e.g. Wrong specification — needs re-quote"
            value={rejectReason}
            autoFocus
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </FormField>
      </Modal>
    </div>
  );
}
