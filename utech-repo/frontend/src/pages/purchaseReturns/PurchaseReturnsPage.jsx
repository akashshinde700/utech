import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, ArrowLeftToLine } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import { styles } from '../../lib/formStyles';
import { inr, date } from '../../lib/format';

export default function PurchaseReturnsPage() {
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
      const { data: response } = await api.get('/purchase-returns', { params: { page, q: search, status: status || undefined } });
      setData(response);
    } catch (err) {
      console.error(err);
      setError('Failed to load purchase returns');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, status]);

  return (
    <div>
      <PageHeader
        title="Purchase Returns"
        action={<Link to="/purchase-returns/new" className="btn-primary"><Plus className="w-4 h-4" /> New Return</Link>}
      />
      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input className={`${styles.input} max-w-xs pl-9`} placeholder="Search return # or party"
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))} />
        </div>
        <select aria-label="Filter by status" className={`${styles.input} max-w-[200px]`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING_APPROVAL">Pending Approval</option>
          <option value="APPROVED">Approved</option>
          <option value="PROCESSED">Processed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <ArrowLeftToLine className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} returns
        </div>
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        onRowClick={(r) => navigate(`/purchase-returns/${r.id}`)}
        rows={data.items}
        emptyTitle="No purchase returns"
        emptyDescription="Record a return against a GRN or PO to send stock back to a vendor."
        emptyAction={{ label: 'New Return', onClick: () => navigate('/purchase-returns/new'), icon: Plus }}
        columns={[
          { key: 'number', title: 'Number', width: 140 },
          { key: 'date', title: 'Date', render: (r) => date(r.date) },
          { key: 'party', title: 'Party', render: (r) => r.party?.name },
          { key: 'grn', title: 'GRN', render: (r) => r.grn?.number || '-' },
          { key: 'total', title: 'Total', render: (r) => <span className="font-mono tabular-nums">{inr(r.total)}</span> },
          { key: 'creditNoteNo', title: 'Credit Note', render: (r) => r.creditNoteNo || '-' },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status === 'PROCESSED' ? 'PAID' : r.status === 'APPROVED' ? 'ISSUED' : r.status}>{r.status}</Badge> },
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
