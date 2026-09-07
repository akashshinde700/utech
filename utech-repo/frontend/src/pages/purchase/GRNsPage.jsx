import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import { date } from '../../lib/format';

export default function GRNsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/grns', { params: { page } });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load GRNs');
    } finally {
      setLoading(false);
    }
  }, [page]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="GRNs (Goods Receipt Notes)"
        action={<Link to="/grns/new" className="btn-primary"><Plus className="h-4 w-4" /> New GRN</Link>} />
      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        rows={data.items}
        onRowClick={(r) => navigate(`/grns/${r.id}`)}
        emptyTitle="No GRNs yet"
        emptyDescription="Record your first goods receipt to add stock."
        emptyAction={{ label: 'New GRN', onClick: () => navigate('/grns/new'), icon: Plus }}
        columns={[
          { key: 'number', title: 'Number' },
          { key: 'date', title: 'Date', render: (r) => date(r.date) },
          { key: 'po', title: 'PO', render: (r) => r.po?.number || '—' },
          { key: 'party', title: 'Vendor', render: (r) => r.party?.name || '—' },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status}>{r.status}</Badge> },
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
