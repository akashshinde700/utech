import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, RotateCcw } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { inr, date } from '../../lib/format';

export default function SalesReturnsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ items: [], pagination: null });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: response } = await api.get('/sales-returns', { params: { page, q: search, status: status || undefined } });
      setData(response);
    } catch (err) {
      console.error(err);
      setError('Failed to load sales returns');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, status]);

  const pristine = !search && !status;

  return (
    <div>
      <PageHeader
        title="Sales Returns"
        action={<Link to="/sales-returns/new" className="btn-primary"><Plus className="w-4 h-4" /> New Return</Link>}
      />
      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className={`${styles.input} pl-9 max-w-xs`} placeholder="Search return # or party"
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <select className={`${styles.input} max-w-[200px]`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="APPROVED">Approved</option>
          <option value="PROCESSED">Processed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <RotateCcw className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} returns
        </div>
      </div>

      {!loading && !error && data.items.length === 0 ? (
        <div className="card-flat">
          <EmptyState
            icon={RotateCcw}
            title={pristine ? 'No sales returns yet' : 'No matching returns'}
            description={pristine ? 'Record a return against an issued invoice to bring stock back.' : 'Try a different search or clear the filters.'}
            action={pristine ? { label: 'New Return', onClick: () => navigate('/sales-returns/new'), icon: Plus } : undefined}
          />
        </div>
      ) : (
        <DataTable
          loading={loading}
          error={error}
          onRetry={load}
          onRowClick={(r) => navigate(`/sales-returns/${r.id}`)}
          rows={data.items}
          columns={[
            { key: 'number', title: 'Number', width: 140 },
            { key: 'date', title: 'Date', render: (r) => date(r.date) },
            { key: 'party', title: 'Party', render: (r) => r.party?.name },
            { key: 'invoice', title: 'Invoice', render: (r) => r.invoice?.number || '-' },
            { key: 'total', title: 'Total', align: 'right', render: (r) => inr(r.total) },
            { key: 'refundAmount', title: 'Refund', align: 'right', render: (r) => inr(r.refundAmount) },
            { key: 'status', title: 'Status', render: (r) => <Badge status={r.status === 'PROCESSED' ? 'PAID' : r.status === 'APPROVED' ? 'ISSUED' : r.status}>{r.status}</Badge> },
          ]}
        />
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
