import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, Trash2, Users } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

export default function PartiesPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const canDelete = hasPermission(user, 'party.delete');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  // deactivated parties are soft-deleted (isActive=false) but still listed —
  // this filter + the row badge make their state visible. The backend list
  // endpoint has no ?isActive filter, so this filters the loaded rows client-side.
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ items: [], pagination: null });
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/parties', { params: { page, q: search, type: type || undefined } });
      setData(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load parties');
    } finally {
      setLoading(false);
    }
  }
  // search is applied on Enter (not per keystroke) — keep the effect scoped to page/type
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [page, type]);

  const visibleRows = data.items.filter((r) =>
    statusFilter === 'all' || (statusFilter === 'active' ? r.isActive !== false : r.isActive === false)
  );
  const pristine = !search && !type && statusFilter === 'all';

  async function deactivate() {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await api.delete(`/parties/${deactivateTarget.id}`);
      toast.success('Deactivated successfully');
      setDeactivateTarget(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to deactivate party');
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Parties"
        subtitle="Customers and vendors"
        action={<Link to="/parties/new" className="btn-primary"><Plus className="w-4 h-4" /> New party</Link>}
      />

      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            className={`${styles.input} pl-9 max-w-xs`}
            placeholder="Search name, GSTIN, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))}
          />
        </div>
        <select className={`${styles.input} max-w-[180px]`} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Filter by party type">
          <option value="">All types</option>
          <option value="CUSTOMER">Customers</option>
          <option value="VENDOR">Vendors</option>
          <option value="BOTH">Both</option>
        </select>
        <select className={`${styles.input} max-w-[150px]`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="all">All parties</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <Users className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} parties
        </div>
      </div>

      {!loading && visibleRows.length === 0 ? (
        <div className="card-flat">
          <EmptyState
            icon={Users}
            title={pristine ? 'No parties yet' : 'No matching parties'}
            description={pristine ? 'Add your first customer or vendor to start billing.' : 'Try a different search or clear the filters.'}
            action={pristine ? { label: 'Add Party', onClick: () => navigate('/parties/new'), icon: Plus } : undefined}
          />
        </div>
      ) : (
        <DataTable
          loading={loading}
          onRowClick={(r) => navigate(`/parties/${r.id}`)}
          rows={visibleRows}
          columns={[
            { key: 'code', title: 'Code', width: 100 },
            { key: 'name', title: 'Name', render: (r) => (
              <span className="inline-flex items-center gap-2">
                <span className={r.isActive === false ? 'text-slate-400' : ''}>{r.name}</span>
                {r.isActive === false && <Badge status="INACTIVE">Inactive</Badge>}
              </span>
            ) },
            { key: 'type', title: 'Type', width: 100 },
            { key: 'gstin', title: 'GSTIN' },
            { key: 'phone', title: 'Phone' },
            { key: 'city', title: 'City' },
            ...(canDelete ? [{ key: '__act', title: '', width: 90, render: (r) => (
              <button
                className="btn-icon text-danger-600 hover:bg-danger-50"
                aria-label={`Deactivate ${r.name}`}
                title="Deactivate"
                onClick={(e) => { e.stopPropagation(); setDeactivateTarget(r); }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ) }] : []),
          ]}
        />
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />

      <ConfirmDialog
        open={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={deactivate}
        title="Deactivate party?"
        message={`${deactivateTarget?.name ?? 'This party'} will be marked inactive and stop appearing in active party lists.`}
        confirmLabel="Deactivate"
        variant="destructive"
        loading={deactivating}
      />
    </div>
  );
}
