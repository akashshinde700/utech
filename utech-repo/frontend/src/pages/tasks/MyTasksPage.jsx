import { useEffect, useState } from 'react';
import { ListChecks, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import FormField from '../../components/ui/FormField';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { date } from '../../lib/format';
import { useAuth } from '../../store/auth';
import TaskDetail from './TaskDetail';

const STATUSES = ['NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'REJECTED', 'CANCELLED', 'REOPENED'];

export default function MyTasksPage() {
  const user = useAuth((s) => s.user);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState({ items: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openTaskId, setOpenTaskId] = useState(null);

  async function load() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const params = { page, assignedToId: user.id };
      if (status) params.status = status;
      const r = await api.get('/tasks', { params });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load your tasks');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, status, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (data.items || []).filter((t) => ['NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(t.status)).length;
  const overdue = (data.items || []).filter((t) => t.overdue).length;
  const completed = (data.items || []).filter((t) => t.status === 'COMPLETED').length;

  return (
    <div className="animate-fade-in">
      <PageHeader title="My Tasks" subtitle="Work assigned to you across every project" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="card p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-brand-600 bg-brand-50"><ListChecks className="w-5 h-5" /></span>
          <div><div className="text-xl font-bold tabular-nums">{data.pagination?.total ?? open}</div><div className="text-[11px] text-slate-500 uppercase tracking-wide">Total</div></div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-blue-600 bg-blue-50"><Clock className="w-5 h-5" /></span>
          <div><div className="text-xl font-bold tabular-nums">{open}</div><div className="text-[11px] text-slate-500 uppercase tracking-wide">Open</div></div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-success-600 bg-success-50"><CheckCircle2 className="w-5 h-5" /></span>
          <div><div className="text-xl font-bold tabular-nums">{completed}</div><div className="text-[11px] text-slate-500 uppercase tracking-wide">Completed</div></div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-danger-600 bg-danger-50"><AlertTriangle className="w-5 h-5" /></span>
          <div><div className="text-xl font-bold tabular-nums">{overdue}</div><div className="text-[11px] text-slate-500 uppercase tracking-wide">Overdue</div></div>
        </div>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <FormField id="mt-status" label="Status" className="max-w-[180px]">
          <select id="mt-status" className={styles.input} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </FormField>
      </div>

      {!loading && !error && data.items.length === 0 ? (
        <div className="card-flat">
          <EmptyState icon={CheckCircle2} title="Nothing assigned to you" description="Tasks your Department Head assigns to you will show up here." />
        </div>
      ) : (
        <DataTable
          loading={loading}
          error={error}
          onRetry={load}
          rows={data.items}
          onRowClick={(r) => setOpenTaskId(r.id)}
          columns={[
            { key: 'title', title: 'Task', render: (r) => (
              <div className="min-w-[160px]">
                <div className="font-medium text-slate-800">{r.displayTitle}</div>
                <div className="text-xs text-slate-400">{r.jobcard.number}{r.process?.stage ? ` · ${r.process.stage}` : ''}</div>
              </div>
            ) },
            { key: 'priority', title: 'Priority', render: (r) => <Badge status={r.priority}>{r.priority}</Badge> },
            { key: 'progressPercent', title: 'Progress', width: 140, render: (r) => (
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${r.progressPercent}%` }} />
                </div>
                <span className="text-xs tabular-nums text-slate-500">{r.progressPercent}%</span>
              </div>
            ) },
            { key: 'dueDate', title: 'Due', render: (r) => r.dueDate ? <span className={r.overdue ? 'text-danger-600 font-medium' : ''}>{date(r.dueDate)}</span> : '—' },
            { key: 'status', title: 'Status', render: (r) => <Badge status={r.overdue ? 'OVERDUE' : r.status}>{r.overdue ? 'OVERDUE' : r.status.replace(/_/g, ' ')}</Badge> },
          ]}
        />
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />

      {openTaskId && <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={load} />}
    </div>
  );
}
