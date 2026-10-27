import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Truck, Send, CheckCircle2, RotateCcw } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../store/auth';
import { hasPermission } from '../../lib/permissions';
import { date } from '../../lib/format';
import toast from 'react-hot-toast';

export default function DispatchPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const user = useAuth((s) => s.user);
  const canUpdate = hasPermission(user, 'dispatch.update');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/dispatch', { params: { page } });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load dispatch challans');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(id, status) {
    try {
      await api.post(`/dispatch/${id}/status/${status}`);
      toast.success(`Challan marked ${status.toLowerCase()}`);
      await load();
      return true;
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to update challan status');
      return false;
    }
  }

  return (
    <div>
      <PageHeader title="Dispatch Challans" action={<Link to="/dispatch/new" className="btn-primary"><Plus className="w-4 h-4" /> New dispatch</Link>} />

      <div className="mb-4 flex items-center gap-1.5 text-xs text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200/80 shadow-sm w-fit">
        <Truck className="w-3.5 h-3.5" />
        {data.pagination?.total ?? 0} challans
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        rows={data.items}
        emptyTitle="No dispatch challans"
        emptyDescription="Create a challan to ship goods out — stock is deducted automatically."
        emptyAction={{ label: 'New dispatch', onClick: () => navigate('/dispatch/new'), icon: Plus }}
        columns={[
          { key: 'number', title: 'Number' },
          { key: 'date', title: 'Date', render: (r) => date(r.date) },
          { key: 'party', title: 'Customer', render: (r) => r.party?.name },
          { key: 'vehicleNo', title: 'Vehicle' },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status}>{r.status}</Badge> },
          { key: '__act', title: '', render: (r) => (
            <div className="flex gap-1 justify-end">
              {canUpdate && r.status === 'DRAFT' && <button className="btn-secondary !px-2 !py-1" onClick={() => setStatus(r.id, 'DISPATCHED')}><Send className="w-3.5 h-3.5" /> Dispatch</button>}
              {canUpdate && r.status === 'DISPATCHED' && <button className="btn-secondary !px-2 !py-1" onClick={() => setStatus(r.id, 'DELIVERED')}><CheckCircle2 className="w-3.5 h-3.5" /> Deliver</button>}
              {canUpdate && ['DRAFT', 'DISPATCHED'].includes(r.status) && <button className="btn-secondary !px-2 !py-1 text-danger-700" onClick={() => setCancelTarget(r)}><RotateCcw className="w-3.5 h-3.5" /> Cancel dispatch</button>}
            </div>
          )},
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />
      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel dispatch?"
        message={`Cancelling ${cancelTarget?.number || 'this dispatch'} restores its quantities to company stock. This cannot be undone.`}
        confirmLabel="Cancel dispatch"
        loading={cancelling}
        onClose={() => setCancelTarget(null)}
        onConfirm={async () => {
          setCancelling(true);
          if (await setStatus(cancelTarget.id, 'CANCELLED')) setCancelTarget(null);
          setCancelling(false);
        }}
      />
    </div>
  );
}
