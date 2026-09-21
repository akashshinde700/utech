import { useEffect, useMemo, useState } from 'react';
import {
  Plus, ListChecks, Clock, PauseCircle, CheckCircle2, AlertTriangle, Loader2,
  Layers, Search, X, Send, Trash2, CheckSquare, Square, Users,
} from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { required, validateAll } from '../../lib/validation';
import { date } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { hasPermission } from '../../lib/permissions';
import TaskDetail from './TaskDetail';
import toast from 'react-hot-toast';

const STATUSES = ['NOT_STARTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'REOPENED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const CARD_META = [
  { key: 'total', label: 'Total Tasks', icon: ListChecks, color: 'text-brand-600 bg-brand-50' },
  { key: 'notStarted', label: 'Not Started', icon: Layers, color: 'text-slate-600 bg-slate-100' },
  { key: 'inProgress', label: 'In Progress', icon: Clock, color: 'text-blue-600 bg-blue-50' },
  { key: 'onHold', label: 'On Hold', icon: PauseCircle, color: 'text-amber-600 bg-amber-50' },
  { key: 'submitted', label: 'Pending Review', icon: Send, color: 'text-purple-600 bg-purple-50' },
  { key: 'completed', label: 'Completed', icon: CheckCircle2, color: 'text-success-600 bg-success-50' },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, color: 'text-danger-600 bg-danger-50' },
];

function newTaskForm(defaults) {
  return {
    jobcardId: '', departmentId: defaults.scopedDeptId || '', processId: '', title: '', notes: '',
    assigneeIds: [], priority: 'MEDIUM', plannedStartAt: '', dueDate: '', estimatedHours: '', requiresApproval: false,
  };
}

export default function TasksPage() {
  const user = useAuth((s) => s.user);
  const scopedDeptId = user?.scopeToDepartment ? user.departmentId : null;
  const canCreate = hasPermission(user, 'task.create');
  const canDelete = hasPermission(user, 'task.delete');

  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dashboard, setDashboard] = useState(null);

  const [filters, setFilters] = useState({ status: '', priority: '', stage: '', assignedToId: '', search: '' });
  const [departments, setDepartments] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [jobcards, setJobcards] = useState([]);
  const [users, setUsers] = useState([]);
  const [workload, setWorkload] = useState([]);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [adding, setAdding] = useState(null);
  const [addErrors, setAddErrors] = useState({});
  const [addBusy, setAddBusy] = useState(false);
  const [openTaskId, setOpenTaskId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // the list API's free-text filter is the `q` query param, not `search`
      const { search, ...restFilters } = filters;
      const params = { page, ...restFilters, q: search };
      Object.keys(params).forEach((k) => { if (params[k] === '') delete params[k]; });
      const r = await api.get('/tasks', { params });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }
  async function loadDashboard() {
    const r = await api.get('/tasks/dashboard');
    setDashboard(r.data);
  }
  useEffect(() => { load(); }, [page, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadDashboard(); }, []);
  useEffect(() => {
    api.get('/departments', { params: { pageSize: 100 } }).then((r) => setDepartments(r.data.items));
    api.get('/processes', { params: { pageSize: 500 } }).then((r) => setProcesses(r.data.items));
    api.get('/jobcards', { params: { pageSize: 200 } }).then((r) => setJobcards(r.data.items));
  }, []);

  const stageOptions = useMemo(() => {
    const stages = [...new Set(processes.map((p) => p.stage).filter(Boolean))];
    return stages.map((s) => ({ value: s, label: s }));
  }, [processes]);

  async function openAddTask() {
    setAddErrors({});
    setAdding(newTaskForm({ scopedDeptId }));
    if (scopedDeptId) loadUsersAndWorkload(scopedDeptId);
  }

  async function loadUsersAndWorkload(departmentId) {
    if (!departmentId) { setUsers([]); setWorkload([]); return; }
    const [u, w] = await Promise.all([
      api.get('/users', { params: { departmentId, isActive: true, pageSize: 200 } }),
      api.get('/tasks/workload', { params: { departmentId } }),
    ]);
    setUsers(u.data.items);
    setWorkload(w.data);
  }

  function setAddField(k, v) {
    setAdding((f) => ({ ...f, [k]: v }));
    setAddErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
    if (k === 'departmentId') loadUsersAndWorkload(v);
  }

  const assigneeOptions = users.map((u) => {
    const w = workload.find((x) => x.id === u.id);
    return {
      value: u.id,
      label: u.name,
      subtitle: w ? `Active: ${w.activeTasks} · Pending: ${w.pendingTasks}${w.overdueTasks ? ` · Overdue: ${w.overdueTasks}` : ''}` : u.email,
    };
  });
  const processOptions = (processes || [])
    .filter((p) => !adding?.departmentId || !p.departmentId || p.departmentId === Number(adding.departmentId))
    .map((p) => ({ value: p.id, label: `${p.name}${p.stage ? ` — ${p.stage}` : ''}` }));
  const jobcardOptions = jobcards.map((j) => ({ value: j.id, label: `${j.number}${j.itemDescription ? ` — ${j.itemDescription}` : ''}` }));

  async function saveTask() {
    const { errors, ok } = validateAll(adding, {
      jobcardId: (v) => required(v, 'Jobcard'),
      departmentId: (v) => required(v, 'Department'),
    });
    if (!ok) { setAddErrors(errors); toast.error('Please fix the highlighted fields'); return; }
    setAddBusy(true);
    try {
      const payload = {
        ...adding,
        jobcardId: Number(adding.jobcardId),
        departmentId: Number(adding.departmentId),
        processId: adding.processId ? Number(adding.processId) : null,
        assigneeIds: adding.assigneeIds.map(Number),
        estimatedHours: adding.estimatedHours === '' ? null : Number(adding.estimatedHours),
        plannedStartAt: adding.plannedStartAt || null,
        dueDate: adding.dueDate || null,
      };
      await api.post('/tasks', payload);
      toast.success('Task created');
      setAdding(null);
      load();
      loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create task');
    } finally {
      setAddBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    try {
      await api.delete(`/tasks/${deleting.id}`);
      toast.success('Task deleted');
      setDeleting(null);
      load();
      loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete task');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Task Progress"
        subtitle="What's pending, who's working on what, what's delayed"
        action={canCreate && <button className="btn-primary" onClick={openAddTask}><Plus className="w-4 h-4" /> Add Task</button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
        {CARD_META.map((c) => (
          <div key={c.key} className="card p-4 flex items-center gap-3">
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.color}`} aria-hidden="true">
              <c.icon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <div className="text-xl font-bold text-slate-900 tabular-nums">{dashboard ? dashboard.summary[c.key] : '—'}</div>
              <div className="text-[11px] text-slate-500 font-medium uppercase tracking-wide truncate">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {dashboard?.byStage?.length > 0 && (
        <div className="card-flat p-4 mb-6 overflow-x-auto scroll-x-hint">
          <div className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2"><Layers className="w-4 h-4 text-brand-600" /> Workflow Stages</div>
          <div className="flex gap-3 min-w-max">
            {dashboard.byStage.map((s) => (
              <button
                key={s.stage}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, stage: f.stage === s.stage ? '' : s.stage }))}
                className={`text-left rounded-xl border px-3 py-2.5 min-w-[150px] transition-colors ${filters.stage === s.stage ? 'border-brand-400 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
              >
                <div className="text-xs font-semibold text-slate-700 truncate">{s.stage}</div>
                <div className="text-lg font-bold text-slate-900 tabular-nums">{s.total}</div>
                <div className="text-[10px] text-slate-500">{s.completed} done · {s.inProgress} active{s.overdue ? ` · ${s.overdue} late` : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <FormField id="f-search" label="Search" className="max-w-[220px]">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input id="f-search" className={`${styles.input} pl-8`} value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Title, jobcard #…" />
          </div>
        </FormField>
        <FormField id="f-status" label="Status" className="max-w-[160px]">
          <select id="f-status" className={styles.input} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </FormField>
        <FormField id="f-priority" label="Priority" className="max-w-[140px]">
          <select id="f-priority" className={styles.input} value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
            <option value="">All</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField id="f-stage" label="Stage" className="max-w-[180px]">
          <select id="f-stage" className={styles.input} value={filters.stage} onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}>
            <option value="">All stages</option>
            {stageOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </FormField>
        {(filters.status || filters.priority || filters.stage || filters.search) && (
          <button type="button" className="btn-secondary text-xs" onClick={() => setFilters({ status: '', priority: '', stage: '', assignedToId: '', search: '' })}>
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {!loading && !error && data.items.length === 0 ? (
        <div className="card-flat">
          <EmptyState icon={ListChecks} title="No tasks yet" description="Add a task and assign it to get the workflow moving." action={canCreate ? { label: 'Add Task', onClick: openAddTask, icon: Plus } : undefined} />
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
            { key: 'assignedTo', title: 'Assigned Operators', render: (r) => (
              (r.assignees || []).length ? (
                <div className="flex flex-wrap items-center gap-1 min-w-[140px]">
                  {r.assignees.map((a) => (
                    <span
                      key={a.id}
                      className={`text-[11px] rounded-full border px-2 py-0.5 ${a.status === 'COMPLETED'
                        ? 'bg-success-50 border-success-100 text-success-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                    >
                      {a.status === 'COMPLETED' ? '✓ ' : ''}{a.user.name}
                    </span>
                  ))}
                  {r.assigneeTotal > 1 && (
                    <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                      <Users className="w-3 h-3" />{r.assigneeDoneCount}/{r.assigneeTotal}
                    </span>
                  )}
                </div>
              ) : <span className="text-slate-400">Unassigned</span>
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
            ...(canDelete ? [{ key: '__del', title: '', width: 48, render: (r) => (
              <button
                type="button" title="Delete task"
                className="p-1.5 rounded-lg text-slate-400 hover:text-danger-600 hover:bg-danger-50"
                onClick={(e) => { e.stopPropagation(); setDeleting(r); }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ) }] : []),
          ]}
        />
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />

      {adding && (
        <Modal
          open
          onClose={() => setAdding(null)}
          title="Add Task"
          description="Create a task from the manufacturing workflow and assign it"
          size="lg"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setAdding(null)} disabled={addBusy}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={saveTask} disabled={addBusy}>
                {addBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {addBusy ? 'Creating…' : 'Create Task'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField id="add-jobcard" label="Project / Jobcard" required error={addErrors.jobcardId}>
              <SearchableSelect id="add-jobcard" value={adding.jobcardId} onChange={(v) => setAddField('jobcardId', v)} options={jobcardOptions} placeholder="Select jobcard…" />
            </FormField>
            <div className={styles.formGrid}>
              <FormField id="add-dept" label="Department" required error={addErrors.departmentId} hint={scopedDeptId ? 'Locked to your department' : undefined}>
                <SearchableSelect id="add-dept" value={adding.departmentId} onChange={(v) => setAddField('departmentId', v)} options={departments.map((d) => ({ value: d.id, label: d.name }))} disabled={!!scopedDeptId} allowClear={false} />
              </FormField>
              <FormField id="add-process" label="Stage / Sub-Process">
                <SearchableSelect id="add-process" value={adding.processId} onChange={(v) => setAddField('processId', v)} options={processOptions} placeholder="Select process…" />
              </FormField>
            </div>
            <FormField id="add-title" label="Task Title" hint="Blank uses the process name">
              <input id="add-title" className={styles.input} value={adding.title} onChange={(e) => setAddField('title', e.target.value)} placeholder="e.g. Complete OD turning as per drawing" />
            </FormField>
            <FormField id="add-notes" label="Description / Instructions">
              <textarea id="add-notes" rows={2} className={styles.textarea} value={adding.notes} onChange={(e) => setAddField('notes', e.target.value)} />
            </FormField>
            <FormField
              id="add-assignee" label="Assign Operators"
              hint={adding.departmentId
                ? 'Tick everyone who will work on this. Each ticks their own checkbox; the task closes when all are done.'
                : 'Pick a department first'}
            >
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {!adding.departmentId && <div className="px-3 py-4 text-sm text-slate-400">Select a department to list its employees.</div>}
                {adding.departmentId && !assigneeOptions.length && <div className="px-3 py-4 text-sm text-slate-400">No active employees in this department.</div>}
                {assigneeOptions.map((o) => {
                  const on = adding.assigneeIds.includes(o.value);
                  return (
                    <button
                      key={o.value} type="button"
                      onClick={() => setAddField('assigneeIds', on
                        ? adding.assigneeIds.filter((x) => x !== o.value)
                        : [...adding.assigneeIds, o.value])}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                    >
                      {on ? <CheckSquare className="w-4 h-4 text-brand-600 shrink-0" /> : <Square className="w-4 h-4 text-slate-300 shrink-0" />}
                      <span className="flex-1 min-w-0 truncate text-slate-700">{o.label}</span>
                    </button>
                  );
                })}
              </div>
            </FormField>
            <div className={styles.formGrid3}>
              <FormField id="add-priority" label="Priority">
                <select id="add-priority" className={styles.input} value={adding.priority} onChange={(e) => setAddField('priority', e.target.value)}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </FormField>
              <FormField id="add-start" label="Planned Start">
                <input id="add-start" type="date" className={styles.input} value={adding.plannedStartAt} onChange={(e) => setAddField('plannedStartAt', e.target.value)} />
              </FormField>
              <FormField id="add-due" label="Due Date">
                <input id="add-due" type="date" className={styles.input} value={adding.dueDate} onChange={(e) => setAddField('dueDate', e.target.value)} />
              </FormField>
            </div>
            <FormField id="add-hours" label="Estimated Hours" className="max-w-[200px]">
              <input id="add-hours" type="number" step="0.5" min="0" className={styles.input} value={adding.estimatedHours} onChange={(e) => setAddField('estimatedHours', e.target.value)} />
            </FormField>
            <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brand-600"
                checked={adding.requiresApproval}
                onChange={(e) => setAddField('requiresApproval', e.target.checked)}
              />
              <span className="text-sm">
                <span className="font-medium text-slate-800">Needs my approval before it closes</span>
                <span className="block text-xs text-slate-500">
                  The operator submits the work for review instead of marking it complete — you then approve it or send it back for rework.
                </span>
              </span>
            </label>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        variant="destructive"
        title="Delete this Task Progress?"
        confirmLabel="Delete task"
        message={deleting
          ? `"${deleting.displayTitle}" on ${deleting.jobcard?.number || 'this project'}${(deleting.assignees || []).length
            ? ` — assigned to ${deleting.assignees.map((a) => a.user.name).join(', ')}`
            : ''}. This cannot be undone. A task that already has completion history must be cancelled instead.`
          : ''}
      />

      {openTaskId && (
        <TaskDetail
          taskId={openTaskId}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => { load(); loadDashboard(); }}
        />
      )}
    </div>
  );
}
