import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, FileText, Eye, Pencil, Printer, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { styles } from '../../lib/formStyles';
import { inr, date } from '../../lib/format';
import toast from 'react-hot-toast';

export default function QuotationsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ items: [], pagination: null });
  // delete/cancel confirmation: { r, permanent } — permanent only when the
  // quotation is already CANCELLED (the API soft-cancels live quotations)
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: response } = await api.get('/quotations', { params: { page, q: search, status: status || undefined } });
      setData(response);
    } catch (err) {
      console.error(err);
      setError('Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, status]);

  const pristine = !search && !status;

  function askDelete(r, e) {
    e.stopPropagation();
    setConfirmTarget({ r, permanent: r.status === 'CANCELLED' });
  }

  async function doDelete() {
    if (!confirmTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/quotations/${confirmTarget.r.id}`);
      toast.success(confirmTarget.permanent ? 'Quotation deleted' : 'Quotation cancelled');
      setConfirmTarget(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete quotation');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Quotations"
        action={<Link to="/quotations/new" className="btn-primary"><Plus className="w-4 h-4" /> New Quotation</Link>}
      />
      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className={`${styles.input} pl-9 max-w-xs`} placeholder="Search quotation # or party"
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <select className={`${styles.input} max-w-[200px]`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CONVERTED">Converted</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <FileText className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} quotations
        </div>
      </div>

      {!loading && !error && data.items.length === 0 ? (
        <div className="card-flat">
          <EmptyState
            icon={FileText}
            title={pristine ? 'No quotations yet' : 'No matching quotations'}
            description={pristine ? 'Create your first quotation to start pitching customers.' : 'Try a different search or clear the filters.'}
            action={pristine ? { label: 'New Quotation', onClick: () => navigate('/quotations/new'), icon: Plus } : undefined}
          />
        </div>
      ) : (
        <DataTable
          loading={loading}
          error={error}
          onRetry={load}
          onRowClick={(r) => navigate(`/quotations/${r.id}`)}
          rows={data.items}
          columns={[
            { key: 'number', title: 'Number', width: 140 },
            { key: 'date', title: 'Date', render: (r) => date(r.date) },
            { key: 'party', title: 'Party', render: (r) => r.party?.name },
            { key: 'total', title: 'Total', align: 'right', render: (r) => inr(r.total) },
            { key: 'validUntil', title: 'Valid Until', render: (r) => r.validTill ? date(r.validTill) : '-' },
            { key: 'status', title: 'Status', render: (r) => <Badge status={r.status === 'APPROVED' ? 'PAID' : r.status}>{r.status}</Badge> },
            {
              key: 'actions', title: 'Action', render: (r) => (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button className="btn-icon" title="View" onClick={() => navigate(`/quotations/${r.id}`)}><Eye className="w-4 h-4" /></button>
                  <button className="btn-icon" title="Edit" onClick={() => navigate(`/quotations/${r.id}/edit`)}><Pencil className="w-4 h-4" /></button>
                  <button className="btn-icon" title="Print" onClick={() => navigate(`/quotations/${r.id}?print=1`)}><Printer className="w-4 h-4" /></button>
                  <button className="btn-icon text-danger-600 hover:bg-danger-50" title={r.status === 'CANCELLED' ? 'Delete permanently' : 'Cancel'} onClick={(e) => askDelete(r, e)}><Trash2 className="w-4 h-4" /></button>
                </div>
              ),
            },
          ]}
        />
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />

      <ConfirmDialog
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={doDelete}
        title={confirmTarget?.permanent ? `Delete quotation ${confirmTarget.r.number}?` : `Cancel quotation ${confirmTarget?.r.number}?`}
        message={confirmTarget?.permanent
          ? `Quotation ${confirmTarget.r.number} will be permanently deleted. This cannot be undone.`
          : `Quotation ${confirmTarget?.r.number} will be marked cancelled. You can delete it permanently afterwards.`}
        confirmLabel={confirmTarget?.permanent ? 'Delete permanently' : 'Cancel quotation'}
        variant={confirmTarget?.permanent ? 'destructive' : 'default'}
        loading={deleting}
      />
    </div>
  );
}
