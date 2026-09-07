import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, Package } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';

export default function BomPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ items: [], pagination: null });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: response } = await api.get('/boms', { params: { page, q: search } });
      setData(response);
    } catch (err) {
      console.error(err);
      setError('Failed to load BOMs');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page]);

  return (
    <div>
      <PageHeader
        title="Bill of Materials"
        action={<Link to="/boms/new" className="btn-primary"><Plus className="w-4 h-4" /> New BOM</Link>}
      />
      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className="input pl-9 max-w-xs" placeholder="Search BOM code or name"
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <Package className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} BOMs
        </div>
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        onRowClick={(r) => navigate(`/boms/${r.id}`)}
        rows={data.items}
        emptyTitle="No BOMs yet"
        emptyDescription="Define a bill of materials so production batches can auto-load components."
        emptyAction={{ label: 'New BOM', onClick: () => navigate('/boms/new'), icon: Plus }}
        columns={[
          { key: 'code', title: 'Code', width: 140 },
          { key: 'name', title: 'Name' },
          { key: 'finishedItem', title: 'Finished Item', render: (r) => r.finishedItem?.name || '-' },
          { key: 'items', title: 'Components', render: (r) => r.items?.length || 0 },
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
