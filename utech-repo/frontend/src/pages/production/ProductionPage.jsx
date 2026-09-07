import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, Factory } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import { date } from '../../lib/format';

export default function ProductionPage() {
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
      const { data: response } = await api.get('/production/batches', { params: { page, q: search, status: status || undefined } });
      setData(response);
    } catch (err) {
      console.error(err);
      setError('Failed to load production batches');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, status]);

  return (
    <div>
      <PageHeader
        title="Production Batches"
        action={<Link to="/production/batches/new" className="btn-primary"><Plus className="w-4 h-4" /> New Batch</Link>}
      />
      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className="input pl-9 max-w-xs" placeholder="Search batch # or item"
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <select className="input max-w-[200px]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="PLANNED">Planned</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <Factory className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} batches
        </div>
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        onRowClick={(r) => navigate(`/production/batches/${r.id}`)}
        rows={data.items}
        emptyTitle="No production batches yet"
        emptyDescription="Plan a batch against a shift, item and BOM to start tracking output."
        emptyAction={{ label: 'New Batch', onClick: () => navigate('/production/batches/new'), icon: Plus }}
        columns={[
          { key: 'number', title: 'Number', width: 140 },
          { key: 'date', title: 'Date', render: (r) => date(r.date) },
          { key: 'shift', title: 'Shift', render: (r) => r.shift?.name || '-' },
          { key: 'item', title: 'Item', render: (r) => r.item?.name },
          { key: 'machine', title: 'Machine', render: (r) => r.machine?.name || '-' },
          { key: 'qtyPlanned', title: 'Planned', align: 'right', render: (r) => <span className="tabular-nums">{r.qtyPlanned}</span> },
          { key: 'qtyProduced', title: 'Produced', align: 'right', render: (r) => <span className="tabular-nums">{r.qtyProduced}</span> },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status}>{r.status}</Badge> },
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
