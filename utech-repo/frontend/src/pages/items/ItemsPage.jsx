import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, Package, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { inr } from '../../lib/format';
import toast from 'react-hot-toast';

export default function ItemsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ items: [], pagination: null });

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/items', {
        params: { page, q: search, type: type || undefined, lowStock: lowStock ? 1 : undefined },
      });
      setData(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load items');
    } finally {
      setLoading(false);
    }
  }
  // search is applied on Enter (not per keystroke) — keep the effect scoped to the server filters
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [page, type, lowStock]);

  const pristine = !search && !type && !lowStock;

  return (
    <div>
      <PageHeader
        title="Items"
        subtitle="Inventory master"
        action={<Link to="/items/new" className="btn-primary"><Plus className="w-4 h-4" /> New item</Link>}
      />
      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className={`${styles.input} pl-9 max-w-xs`} placeholder="Search name, code, HSN…" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <select className={`${styles.input} max-w-[200px]`} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Filter by item type">
          <option value="">All types</option>
          <option value="RAW_MATERIAL">Raw Material</option>
          <option value="SEMI_FINISHED">Semi-finished</option>
          <option value="FINISHED">Finished</option>
          <option value="CONSUMABLE">Consumable</option>
          <option value="SERVICE">Service</option>
        </select>
        <label className={`text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-colors cursor-pointer select-none ${lowStock ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
          <AlertTriangle className="w-3.5 h-3.5" />
          <input type="checkbox" className="sr-only" checked={lowStock} onChange={(e) => { setLowStock(e.target.checked); setPage(1); }} />
          Low stock
        </label>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <Package className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} items
        </div>
      </div>

      {!loading && data.items.length === 0 ? (
        <div className="card-flat">
          <EmptyState
            icon={Package}
            title={pristine ? 'No items yet' : 'No matching items'}
            description={pristine ? 'Add your first item to start quoting, invoicing and tracking stock.' : 'Try a different search or clear the filters.'}
            action={pristine ? { label: 'Add Item', onClick: () => navigate('/items/new'), icon: Plus } : undefined}
          />
        </div>
      ) : (
        <DataTable
          loading={loading}
          onRowClick={(r) => navigate(`/items/${r.id}`)}
          rows={data.items}
          columns={[
            { key: 'code', title: 'Code', width: 90 },
            { key: 'name', title: 'Name' },
            { key: 'project', title: 'Project', render: (r) => r.project?.code || r.projectNumber || '—' },
            { key: 'type', title: 'Type' },
            { key: 'hsnCode', title: 'HSN' },
            { key: 'uom', title: 'UOM', render: (r) => r.uom?.code || '—' },
            { key: 'currentStock', title: 'Stock', render: (r) => `${Number(r.currentStock).toFixed(2)} (min ${Number(r.minStock).toFixed(2)})` },
            { key: 'saleRate', title: 'Sale Rate', render: (r) => inr(r.saleRate) },
            { key: 'gstRate', title: 'GST%', render: (r) => `${Number(r.gstRate || 0).toFixed(0)}%` },
          ]}
        />
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
