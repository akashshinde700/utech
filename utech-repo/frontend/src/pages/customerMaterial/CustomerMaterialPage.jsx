import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users, Search } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import { date } from '../../lib/format';

export default function CustomerMaterialPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [data, setData] = useState({ items: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/customer-material', {
        params: { page, q: search, activeOnly: activeOnly ? 1 : undefined },
      });
      setData(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load customer material');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, activeOnly]);

  return (
    <div>
      <PageHeader
        title="Customer Inventory"
        subtitle="Customer-owned material — always kept separate from company stock"
        action={<Link to="/customer-material/new" className="btn-primary"><Plus className="w-4 h-4" /> New inward</Link>}
      />

      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className="input pl-9 max-w-xs" placeholder="Inward no, heat no, lot no…" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <label className={`text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-colors cursor-pointer select-none ${activeOnly ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
          <input type="checkbox" className="sr-only" checked={activeOnly} onChange={(e) => { setActiveOnly(e.target.checked); setPage(1); }} />
          Active only
        </label>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <Users className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} lots
        </div>
      </div>

      <DataTable
        onRowClick={(r) => navigate(`/customer-material/${r.id}`)}
        rows={data.items}
        loading={loading}
        error={error}
        onRetry={load}
        filtered={!!search}
        emptyTitle="No customer material lots yet"
        emptyDescription="Record the first inward of customer-owned material."
        emptyAction={{ label: 'New inward', onClick: () => navigate('/customer-material/new'), icon: Plus }}
        columns={[
          { key: 'inwardNumber', title: 'Inward No', width: 130 },
          { key: 'receivedDate', title: 'Date', render: (r) => date(r.receivedDate) },
          { key: 'customer', title: 'Customer', render: (r) => r.customer?.name },
          { key: 'materialDescription', title: 'Material' },
          { key: 'lot', title: 'Heat / Lot', render: (r) => [r.heatNumber, r.lotNumber].filter(Boolean).join(' / ') || '—' },
          { key: 'qty', title: 'Qty', align: 'right', render: (r) => <span className="tabular-nums">{Number(r.qty)}</span> },
          { key: 'availableQty', title: 'Available', align: 'right', render: (r) => <span className="tabular-nums">{Number(r.availableQty)}</span> },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status}>{(r.status || '').replace(/_/g, ' ')}</Badge> },
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
