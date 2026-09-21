import { useEffect, useState } from 'react';
import {
  ListChecks, AlertTriangle, Clock, CheckCircle2, Loader2,
  Check, Play, Send, ChevronRight, Calendar, User,
} from 'lucide-react';
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
import toast from 'react-hot-toast';

const STATUSES = ['NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'REOPENED'];

// The one obvious next step for the person the task is assigned to. Anything
// more (hold, comments, files, progress slider) lives in the detail sheet —
// operators get a single tap for the common case.
function primaryAction(task) {
  // `tick` routes through PATCH /tasks/:id/my-completion, which closes only the
  // caller's own share of a task that several operators may be working on. The
  // server decides whether that finishes the task or sends it to review.
  const finish = task.requiresApproval
    ? { label: 'Submit for Review', icon: Send, status: 'SUBMITTED' }
    : { label: 'Mark Complete', icon: CheckCircle2, status: 'COMPLETED' };
  if (task.canTick) finish.tick = true;

  switch (task.status) {
    case 'ASSIGNED': return { label: 'Accept', icon: Check, status: 'ACCEPTED' };
    case 'ACCEPTED': return { label: 'Start', icon: Play, status: 'IN_PROGRESS' };
    case 'IN_PROGRESS':
    case 'REOPENED':
      // already ticked, just waiting on a colleague
      if (task.myAssignment?.status === 'COMPLETED') return null;
      return finish;
    case 'ON_HOLD': return { label: 'Resume', icon: Play, status: 'IN_PROGRESS' };
    default: return null;
  }
}

function ProgressBar({ value }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500 w-9 text-right">{value}%</span>
    </div>
  );
}

export default function MyTasksPage() {
  const user = useAuth((s) => s.user);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState({ items: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [busyId, setBusyId] = useState(null);

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

  async function runAction(task, action) {
    setBusyId(task.id);
    try {
      if (action.tick) {
        await api.patch(`/tasks/${task.id}/my-completion`, { done: true });
      } else {
        await api.patch(`/tasks/${task.id}/status`, { status: action.status });
      }
      toast.success(`${action.label} — done`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update the task');
    } finally {
      setBusyId(null);
    }
  }

  const open = (data.items || []).filter((t) => ['NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'REOPENED'].includes(t.status)).length;
  const overdue = (data.items || []).filter((t) => t.overdue).length;
  const completed = (data.items || []).filter((t) => t.status === 'COMPLETED').length;

  return (
    <div className="animate-fade-in">
      <PageHeader title="My Tasks" subtitle="Work assigned to you across every project" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
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
        <>
          {/* phone / tablet: one card per task with a single obvious action */}
          <div className="space-y-3 lg:hidden">
            {loading && data.items.length === 0 && (
              <div className="card p-6 flex items-center justify-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            )}
            {data.items.map((t) => {
              const action = primaryAction(t);
              return (
                <div key={t.id} className="card p-4 space-y-3">
                  <button type="button" className="w-full text-left" onClick={() => setOpenTaskId(t.id)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 leading-snug">{t.displayTitle}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {t.jobcard.number}{t.process?.stage ? ` · ${t.process.stage}` : ''}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" aria-hidden="true" />
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge status={t.overdue ? 'OVERDUE' : t.status}>{t.overdue ? 'OVERDUE' : t.status.replace(/_/g, ' ')}</Badge>
                    <Badge status={t.priority}>{t.priority}</Badge>
                    {t.requiresApproval && <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-2 py-0.5">Needs approval</span>}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                    {t.assignedBy && (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <User className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">By {t.assignedBy.name}</span>
                      </div>
                    )}
                    <div className={`flex items-center gap-1.5 ${t.overdue ? 'text-danger-600 font-medium' : ''}`}>
                      <Calendar className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Due {date(t.dueDate)}</span>
                    </div>
                  </div>

                  {t.assigneeTotal > 1 && (
                    <div className="text-[11px] text-slate-500">
                      Shared task — {t.assigneeDoneCount}/{t.assigneeTotal} operators done
                      {t.myAssignment?.status === 'COMPLETED' && <span className="text-success-600 font-medium"> · your part is done</span>}
                    </div>
                  )}

                  <ProgressBar value={t.progressPercent} />

                  <div className="flex gap-2">
                    {action && (
                      <button
                        type="button"
                        className={`${styles.primaryBtn} flex-1`}
                        onClick={() => runAction(t, action)}
                        disabled={busyId === t.id}
                      >
                        {busyId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <action.icon className="w-4 h-4" />}
                        {action.label}
                      </button>
                    )}
                    <button type="button" className={action ? styles.secondaryBtn : `${styles.secondaryBtn} flex-1`} onClick={() => setOpenTaskId(t.id)}>
                      Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* desktop: table */}
          <div className="hidden lg:block">
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
                { key: 'progressPercent', title: 'Progress', width: 150, render: (r) => <ProgressBar value={r.progressPercent} /> },
                { key: 'dueDate', title: 'Due', render: (r) => r.dueDate ? <span className={r.overdue ? 'text-danger-600 font-medium' : ''}>{date(r.dueDate)}</span> : '—' },
                { key: 'status', title: 'Status', render: (r) => <Badge status={r.overdue ? 'OVERDUE' : r.status}>{r.overdue ? 'OVERDUE' : r.status.replace(/_/g, ' ')}</Badge> },
                { key: '__act', title: '', width: 150, render: (r) => {
                  const action = primaryAction(r);
                  if (!action) return null;
                  return (
                    <button
                      type="button"
                      className="btn-secondary !px-2.5 !py-1 text-xs"
                      onClick={(e) => { e.stopPropagation(); runAction(r, action); }}
                      disabled={busyId === r.id}
                    >
                      {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <action.icon className="w-3.5 h-3.5" />}
                      {action.label}
                    </button>
                  );
                } },
              ]}
            />
          </div>
        </>
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />

      {openTaskId && <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={load} />}
    </div>
  );
}
