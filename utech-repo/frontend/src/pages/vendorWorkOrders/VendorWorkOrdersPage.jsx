import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Eye, AlertTriangle, ClipboardList } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { date as fmtDate, VWO_STATUS_LABELS, isVwoOverdue } from '../../lib/format';

const PAGE_SIZE = 20;

function projectLabel(r) {
  if (r.jobcard) return r.jobcard.projectNumber || r.jobcard.number;
  if (r.assignment && r.assignment.attachment) return r.assignment.attachment.filename;
  return '—';
}

function returnProgress(r) {
  const lines = r.lines || [];
  const sent = lines.reduce((s, l) => s + Number(l.qtySent), 0);
  const back = lines.reduce((s, l) => s + Number(l.qtyReceived) + Number(l.qtyRejected), 0);
  return { sent, back, pct: sent ? Math.round((back / sent) * 100) : 0 };
}

function StatCards({ stats }) {
  if (!stats) return null;
  const cards = [
    { label: 'Total', value: stats.total },
    { label: 'Draft', value: stats.draft },
    { label: 'At Vendor', value: stats.atVendor },
    { label: 'Partly Returned', value: stats.partial },
    { label: 'Returned', value: stats.received },
    { label: 'Overdue', value: stats.overdue, danger: stats.overdue > 0 },
    { label: 'On Time %', value: `${stats.onTimePercentage}%` },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl border border-slate-200/80 p-3 text-center shadow-sm">
          <div className={`text-xl font-bold tabular-nums ${c.danger ? 'text-red-600' : 'text-slate-900'}`}>{c.value}</div>
          <div className="text-[11px] text-slate-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function VendorWorkOrdersPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const jobcardId = searchParams.get('jobcardId') || '';

  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [parties, setParties] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', partyId: '', search: '', openOnly: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // search box state is kept local and only pushed into `filters` after a
  // 300ms pause — otherwise every keystroke fires a fresh API request
  const [searchInput, setSearchInput] = useState('');
  const debounceTimer = useRef(null);
  const reqId = useRef(0);

  useEffect(() => {
    api
      .get('/parties', { params: { type: 'VENDOR', pageSize: 200 } })
      .then((r) => setParties(r.data.items))
      .catch(() => setParties([]));
  }, []);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const params = { page, pageSize: PAGE_SIZE };
    if (jobcardId) params.jobcardId = jobcardId;
    if (filters.status) params.status = filters.status;
    if (filters.partyId) params.partyId = filters.partyId;
    if (filters.search) params.search = filters.search;
    if (filters.openOnly) params.open = 'true';

    setLoading(true);
    setError(null);
    try {
      const [listRes, statsRes] = await Promise.all([
        api.get('/vendor-work-orders', { params }),
        api.get('/vendor-work-orders/stats', { params: jobcardId ? { jobcardId } : {} }),
      ]);
      if (id !== reqId.current) return;
      setItems(listRes.data.items);
      setTotal(listRes.data.total);
      setStats(statsRes.data);
    } catch (err) {
      console.error(err);
      if (id !== reqId.current) return;
      setError('Failed to load vendor work orders');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [page, jobcardId, filters]);

  useEffect(() => {
    load();
  }, [load]);

  // any filter change invalidates the current page number
  function updateFilter(patch) {
    setPage(1);
    setFilters((f) => ({ ...f, ...patch }));
  }

  function updateSearch(value) {
    setSearchInput(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setPage(1);
      setFilters((f) => ({ ...f, search: value }));
    }, 300);
  }

  const vendorOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name, subtitle: p.code || undefined })),
    [parties]
  );

  const filtersActive = !!(filters.status || filters.partyId || filters.search || filters.openOnly || jobcardId);

  const columns = [
    {
      key: 'number',
      title: 'VWO No',
      render: (r) => (
        <Link to={`/vendor-work-orders/${r.id}`} className="text-brand-600 hover:underline font-semibold">
          {r.number}
        </Link>
      ),
    },
    {
      key: 'project',
      title: 'Project / Document',
      render: (r) => (
        <div>
          <div className="font-medium text-slate-800">{projectLabel(r)}</div>
          {r.scopeDescription && (
            <div className="text-[11px] text-slate-400 truncate max-w-[16rem]" title={r.scopeDescription}>
              {r.scopeDescription}
            </div>
          )}
        </div>
      ),
    },
    { key: 'vendor', title: 'Vendor', render: (r) => (r.party ? r.party.name : '—') },
    { key: 'department', title: 'Department', render: (r) => (r.department ? r.department.name : '—') },
    { key: 'sentDate', title: 'Sent Out', render: (r) => fmtDate(r.sentDate) },
    {
      key: 'expectedReturnDate',
      title: 'Due Back',
      render: (r) => (
        <span className={isVwoOverdue(r) ? 'text-red-600 font-semibold inline-flex items-center gap-1' : ''}>
          {isVwoOverdue(r) && <AlertTriangle className="w-3 h-3" />}
          {fmtDate(r.expectedReturnDate)}
        </span>
      ),
    },
    { key: 'actualReturnDate', title: 'Returned On', render: (r) => fmtDate(r.actualReturnDate) },
    {
      key: 'progress',
      title: 'Returned Qty',
      render: (r) => {
        const p = returnProgress(r);
        return (
          <div className="min-w-[5rem]">
            <div className="text-xs font-medium text-slate-700 tabular-nums font-mono">
              {p.back} / {p.sent}
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${p.pct}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'po',
      title: 'Purchase Order',
      render: (r) =>
        r.po ? (
          <Link to={`/purchase-orders/${r.po.id}`} className="text-brand-600 hover:underline text-xs font-medium">
            {r.po.number}
          </Link>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (r) => <Badge status={r.status}>{VWO_STATUS_LABELS[r.status] || r.status}</Badge>,
    },
    {
      key: '__act',
      title: '',
      width: 90,
      render: (r) => (
        <div className="flex justify-end">
          <Link to={`/vendor-work-orders/${r.id}`} className="btn-secondary !px-2 !py-1 text-xs">
            <Eye className="w-3.5 h-3.5" /> View
          </Link>
        </div>
      ),
    },
  ];

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Vendor Work Orders"
        subtitle="Project work sent outside the company — who has it, since when, and whether it came back"
        action={
          <Link to="/vendor-work-orders/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Vendor Work Order
          </Link>
        }
      />

      <StatCards stats={stats} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="input max-w-[240px]"
          placeholder="Search VWO, vendor or project…"
          aria-label="Search vendor work orders"
          value={searchInput}
          onChange={(e) => updateSearch(e.target.value)}
        />
        <select
          className="input max-w-[190px]"
          aria-label="Filter by status"
          value={filters.status}
          onChange={(e) => updateFilter({ status: e.target.value })}
        >
          <option value="">All statuses</option>
          {Object.entries(VWO_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <SearchableSelect
          className="max-w-[220px]"
          value={filters.partyId}
          onChange={(v) => updateFilter({ partyId: v })}
          options={vendorOptions}
          placeholder="All vendors"
          allowClear
        />
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.openOnly}
            onChange={(e) => updateFilter({ openOnly: e.target.checked })}
          />
          Still outstanding only
        </label>
      </div>

      {!loading && !error && items.length === 0 && !filtersActive ? (
        <div className="card-flat">
          <EmptyState
            icon={ClipboardList}
            title="No vendor work orders yet"
            description="Raise a work order when project scope or parts go out to an external vendor."
            action={{ label: 'New Vendor Work Order', onClick: () => navigate('/vendor-work-orders/new'), icon: Plus }}
          />
        </div>
      ) : (
        <DataTable columns={columns} rows={items} loading={loading} error={error} onRetry={load} filtered={filtersActive} />
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <div>
            {total} work order{total === 1 ? '' : 's'}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary !px-3 !py-1" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {lastPage}
            </span>
            <button
              className="btn-secondary !px-3 !py-1"
              disabled={page >= lastPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
