import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FormField from '../../components/ui/FormField';
import { styles } from '../../lib/formStyles';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import { inr, date } from '../../lib/format';
import toast from 'react-hot-toast';

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  // approve/reject hit the PO status endpoints which the backend guards with
  // purchase.update — hide the buttons instead of guaranteeing 403s
  const canDecide = hasPermission(user, 'purchase.update');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ items: [], pagination: null });
  // { type: 'approve' | 'reject', po } — pending decision on a pending PO
  const [decision, setDecision] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/purchase-orders', { params: { page, status: status || undefined } });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [page, status]);
  useEffect(() => { load(); }, [load]);

  async function approve(id) {
    setDeciding(true);
    try {
      await api.post(`/purchase-orders/${id}/approve`);
      toast.success('Purchase order approved');
      setDecision(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to approve PO');
    } finally {
      setDeciding(false);
    }
  }

  async function reject(id, reason) {
    setDeciding(true);
    try {
      await api.post(`/purchase-orders/${id}/reject`, { reason });
      toast.success('Purchase order rejected');
      setDecision(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to reject PO');
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div>
      <PageHeader title="Purchase Orders"
        action={<Link to="/purchase-orders/new" className="btn-primary"><Plus className="h-4 w-4" /> New PO</Link>} />

      <div className="mb-3 flex gap-2">
        <select
          aria-label="Filter by status"
          className={`${styles.input} max-w-[200px]`}
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          <option>DRAFT</option><option>PENDING_APPROVAL</option><option>APPROVED</option>
          <option>REJECTED</option><option>PARTIALLY_RECEIVED</option><option>RECEIVED</option><option>CANCELLED</option>
        </select>
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        onRowClick={(r) => navigate(`/purchase-orders/${r.id}`)}
        rows={data.items}
        emptyTitle="No purchase orders"
        emptyDescription="Raise a PO to order stock from a vendor."
        emptyAction={{ label: 'New PO', onClick: () => navigate('/purchase-orders/new'), icon: Plus }}
        columns={[
          { key: 'number', title: 'Number' },
          { key: 'date', title: 'Date', render: (r) => date(r.date) },
          { key: 'party', title: 'Vendor', render: (r) => r.party?.name },
          { key: 'total', title: 'Total', render: (r) => <span className="font-mono tabular-nums">{inr(r.total)}</span> },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status}>{r.status}</Badge> },
          { key: '__act', title: '', render: (r) => (
            canDecide && r.status === 'PENDING_APPROVAL' ? (
              <div className="flex justify-end gap-1">
                <button className="btn-secondary !px-2 !py-1" onClick={(e) => { e.stopPropagation(); setDecision({ type: 'approve', po: r }); }}>Approve</button>
                <button className="btn-danger !px-2 !py-1" onClick={(e) => { e.stopPropagation(); setDecision({ type: 'reject', po: r }); setRejectReason(''); }}>Reject</button>
              </div>
            ) : null
          )},
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />

      <ConfirmDialog
        open={decision?.type === 'approve'}
        onClose={() => setDecision(null)}
        onConfirm={() => approve(decision.po.id)}
        title="Approve this purchase order?"
        message={`${decision?.po?.number || 'This PO'} will move to APPROVED and become open for goods receipts.`}
        confirmLabel="Approve"
        loading={deciding}
      />

      <Modal
        open={decision?.type === 'reject'}
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
              onClick={() => reject(decision.po.id, rejectReason.trim())}
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
