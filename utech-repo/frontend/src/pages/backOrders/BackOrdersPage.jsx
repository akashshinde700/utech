import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, Clock } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { date } from '../../lib/format';

export default function BackOrdersPage() {
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
      const { data: response } = await api.get('/back-orders', { params: { page, q: search, status: status || undefined } });
      setData(response);
    } catch (err) {
      console.error(err);
      setError('Failed to load back orders');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, status]);

  const pristine = !search && !status;

  return (
    <div>
      <PageHeader
        title="Back Orders"
        action={<Link to="/back-orders/new" className="btn-primary"><Plus className="w-4 h-4" /> New Back Order</Link>}
      />
      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className={`${styles.input} pl-9 max-w-xs`} placeholder="Search back order # or party"
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <select className={`${styles.input} max-w-[200px]`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PARTIALLY_FULFILLED">Partially Fulfilled</option>
          <option value="FULFILLED">Fulfilled</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <Clock className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} back orders
        </div>
      </div>

      {!loading && !error && data.items.length === 0 ? (
        <div className="card-flat">
          <EmptyState
            icon={Clock}
            title={pristine ? 'No back orders yet' : 'No matching back orders'}
            description={pristine ? 'Track outstanding customer quantities as back orders.' : 'Try a different search or clear the filters.'}
            action={pristine ? { label: 'New Back Order', onClick: () => navigate('/back-orders/new'), icon: Plus } : undefined}
          />
        </div>
      ) : (
        <DataTable
          loading={loading}
          error={error}
          onRetry={load}
          onRowClick={(r) => navigate(`/back-orders/${r.id}`)}
          rows={data.items}
          columns={[
            { key: 'number', title: 'Number', width: 140 },
            { key: 'date', title: 'Date', render: (r) => date(r.date) },
            { key: 'party', title: 'Party', render: (r) => r.party?.name },
            { key: 'invoice', title: 'Invoice', render: (r) => r.invoice?.number || '-' },
            { key: 'expectedDate', title: 'Expected', render: (r) => date(r.expectedDate) },
            { key: 'status', title: 'Status', render: (r) => <Badge status={r.status === 'FULFILLED' ? 'PAID' : r.status === 'PARTIALLY_FULFILLED' ? 'PARTIALLY_PAID' : r.status}>{r.status}</Badge> },
          ]}
        />
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
