import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, ClipboardList, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { date } from '../../lib/format';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

export default function JobcardsPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const canDelete = hasPermission(user, 'jobcard.delete');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ items: [], pagination: null });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/jobcards', { params: { page, q: search, status: status || undefined } });
      setData(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load jobcards');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, status]);

  const isCancelledDelete = confirmDelete?.status === 'CANCELLED';
  const deleteMessage = confirmDelete
    ? isCancelledDelete
      ? `Permanently delete jobcard ${confirmDelete.number}? This cannot be undone.`
      : `Delete jobcard ${confirmDelete.number}? This will mark it as CANCELLED — delete again to remove it for good.`
    : '';

  async function doDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const { data: res } = await api.delete(`/jobcards/${confirmDelete.id}`);
      toast.success(res.deleted ? 'Jobcard permanently deleted' : 'Jobcard marked as cancelled');
      setConfirmDelete(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete jobcard');
    } finally {
      setDeleting(false);
    }
  }

  const filtersActive = !!(search || status);

  return (
    <div>
      <PageHeader title="Jobcards" action={<Link to="/jobcards/new" className="btn-primary"><Plus className="w-4 h-4" /> New Jobcard</Link>} />
      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className="input pl-9 max-w-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <select className="input max-w-[200px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option>DRAFT</option><option>IN_PROGRESS</option><option>ON_HOLD</option>
          <option>REVERTED</option><option>COMPLETED</option><option>CANCELLED</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <ClipboardList className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} jobcards
        </div>
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        onRowClick={(r) => navigate(`/jobcards/${r.id}`)}
        rows={data.items}
        filtered={filtersActive}
        emptyTitle="No jobcards yet"
        emptyDescription="Raise your first production jobcard to start tracking materials and drawings."
        emptyAction={{ label: 'New Jobcard', onClick: () => navigate('/jobcards/new'), icon: Plus }}
        columns={[
          { key: 'number', title: 'Number', width: 130 },
          { key: 'date', title: 'Date', render: (r) => date(r.date) },
          { key: 'party', title: 'Party', render: (r) => r.party?.name || '—' },
          { key: 'projectNumber', title: 'Project No', render: (r) => r.projectNumber || '—' },
          { key: 'assignedOperator', title: 'Engineer', render: (r) => r.assignedOperator?.name || '—' },
          { key: 'qtyOrdered', title: 'Ordered', render: (r) => Number(r.qtyOrdered) },
          { key: 'qtyProduced', title: 'Produced', render: (r) => Number(r.qtyProduced) },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status}>{r.status}</Badge> },
          ...(canDelete ? [{ key: '__act', title: '', width: 60, render: (r) => (
            <button className="btn-danger !px-2 !py-1" aria-label={`Delete jobcard ${r.number}`} onClick={(e) => { e.stopPropagation(); setConfirmDelete(r); }}><Trash2 className="w-3.5 h-3.5" /></button>
          ) }] : []),
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={doDelete}
        title={isCancelledDelete ? 'Delete jobcard permanently?' : 'Delete jobcard?'}
        message={deleteMessage}
        confirmLabel={isCancelledDelete ? 'Delete permanently' : 'Mark as cancelled'}
        variant="destructive"
        loading={deleting}
      />
    </div>
  );
}
