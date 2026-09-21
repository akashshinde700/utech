import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListChecks, Plus, Loader2, CheckSquare, Square, Pencil, Trash2, Users,
  AlertTriangle, Clock, CheckCircle2,
} from 'lucide-react';
import api from '../../lib/api';
import Modal from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';
import FormField from '../ui/FormField';
import Badge from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { date } from '../../lib/format';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

// Task Progress on a project — the Department Head's list of work items for
// this project, each assigned to one or more operators. Replaces the old fixed
// six-item checklist widget; the same rows drive the project's Overall Progress.

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const EMPTY_FORM = {
  title: '', notes: '', processId: '', departmentId: '', assigneeIds: [],
  priority: 'MEDIUM', dueDate: '', requiresApproval: false,
};

function TaskForm({ open, onClose, onSaved, jobcardId, editing }) {
  const user = useAuth((s) => s.user);
  const locked = !!user?.scopeToDepartment; // Dept Head / Supervisor / Team Leader
  const [form, setForm] = useState(EMPTY_FORM);
  const [departments, setDepartments] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [people, setPeople] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setForm(editing
      ? {
        title: editing.title || editing.process?.name || '',
        notes: editing.notes || '',
        processId: editing.processId || '',
        departmentId: editing.departmentId || '',
        assigneeIds: (editing.assignees || []).map((a) => a.userId),
        priority: editing.priority || 'MEDIUM',
        dueDate: editing.dueDate ? String(editing.dueDate).slice(0, 10) : '',
        requiresApproval: !!editing.requiresApproval,
      }
      : { ...EMPTY_FORM, departmentId: locked ? user.departmentId : '' });
  }, [open, editing, locked, user?.departmentId]);

  useEffect(() => {
    if (!open || locked) return;
    api.get('/departments', { params: { pageSize: 200 } })
      .then((r) => setDepartments(r.data.items || []))
      .catch(() => setDepartments([]));
  }, [open, locked]);

  // the operator list and the process list both follow the chosen department
  useEffect(() => {
    if (!open || !form.departmentId) { setPeople([]); setProcesses([]); return; }
    api.get('/tasks/workload', { params: { departmentId: form.departmentId } })
      .then((r) => setPeople(r.data || []))
      .catch(() => setPeople([]));
    api.get('/processes', { params: { departmentId: form.departmentId, pageSize: 300, isActive: true } })
      .then((r) => setProcesses(r.data.items || []))
      .catch(() => setProcesses([]));
  }, [open, form.departmentId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleAssignee = (id) => setForm((f) => ({
    ...f,
    assigneeIds: f.assigneeIds.includes(id) ? f.assigneeIds.filter((x) => x !== id) : [...f.assigneeIds, id],
  }));

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!form.title.trim()) { setErr('Task name is required'); return; }
    if (!form.departmentId) { setErr('Department is required'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        notes: form.notes || null,
        processId: form.processId ? Number(form.processId) : null,
        departmentId: Number(form.departmentId),
        priority: form.priority,
        dueDate: form.dueDate || null,
        requiresApproval: form.requiresApproval,
      };
      if (editing) {
        await api.put(`/tasks/${editing.id}`, payload);
        // assignment has its own endpoint so it lands in the task's history
        const before = (editing.assignees || []).map((a) => a.userId).sort().join(',');
        if (form.assigneeIds.length && before !== [...form.assigneeIds].sort().join(',')) {
          await api.post(`/tasks/${editing.id}/assign`, { assigneeIds: form.assigneeIds });
        }
      } else {
        await api.post('/tasks', { ...payload, jobcardId, assigneeIds: form.assigneeIds });
      }
      toast.success(editing ? 'Task updated' : 'Task added');
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2.response?.data?.message || 'Could not save the task');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Task Progress' : 'Add Task Progress'}
      description={editing ? null : 'Create a work item for this project and assign the operators who will do it.'}
      size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="task-progress-form" className={styles.primaryBtn} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {editing ? 'Save changes' : 'Add task'}
          </button>
        </div>
      )}
    >
      <form id="task-progress-form" onSubmit={submit} className="space-y-4">
        {err && (
          <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{err}</span>
          </div>
        )}

        <FormField id="tp-title" label="Task Progress Name" required>
          <input
            id="tp-title" className={styles.input} value={form.title}
            onChange={(e) => set('title', e.target.value)} placeholder="e.g. Machine Setup" autoFocus
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="tp-dept" label="Department" required hint={locked ? 'Your department' : undefined}>
            {locked ? (
              <input id="tp-dept" className={styles.input} value={user?.departmentName || 'Your department'} disabled />
            ) : (
              <select
                id="tp-dept" className={styles.input} value={form.departmentId}
                onChange={(e) => set('departmentId', e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Select department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </FormField>

          <FormField id="tp-process" label="Process / Stage" hint="Optional — links this task to the workflow stage">
            <select
              id="tp-process" className={styles.input} value={form.processId}
              onChange={(e) => set('processId', e.target.value)} disabled={!form.departmentId}
            >
              <option value="">No specific process</option>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>{p.stage ? `${p.stage} — ${p.name}` : p.name}</option>
              ))}
            </select>
          </FormField>

          <FormField id="tp-priority" label="Priority">
            <select id="tp-priority" className={styles.input} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </FormField>

          <FormField id="tp-due" label="Due Date">
            <input id="tp-due" type="date" className={styles.input} value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </FormField>
        </div>

        <FormField
          id="tp-ops" label="Assign Operators"
          hint={form.departmentId ? 'The task appears only for the operators you tick here.' : 'Pick a department first.'}
        >
          <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {!form.departmentId && <div className="px-3 py-4 text-sm text-slate-400">Select a department to list its operators.</div>}
            {form.departmentId && !people.length && <div className="px-3 py-4 text-sm text-slate-400">No active users in this department.</div>}
            {people.map((p) => {
              const on = form.assigneeIds.includes(p.id);
              return (
                <button
                  key={p.id} type="button" onClick={() => toggleAssignee(p.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                >
                  {on ? <CheckSquare className="w-4 h-4 text-brand-600 shrink-0" /> : <Square className="w-4 h-4 text-slate-300 shrink-0" />}
                  <span className="flex-1 min-w-0 truncate text-slate-700">{p.name}</span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {p.activeTasks + p.pendingTasks} open{p.overdueTasks ? ` · ${p.overdueTasks} overdue` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </FormField>

        <FormField id="tp-notes" label="Instructions">
          <textarea
            id="tp-notes" className={styles.textarea} value={form.notes}
            onChange={(e) => set('notes', e.target.value)} placeholder="Anything the operator needs to know"
          />
        </FormField>

        <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
            checked={form.requiresApproval} onChange={(e) => set('requiresApproval', e.target.checked)}
          />
          <span>
            Needs my review before it counts as complete
            <span className="block text-xs text-slate-400">Operators submit the task; you approve it.</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

export default function JobcardTaskProgress({ jobcardId, onChanged }) {
  const user = useAuth((s) => s.user);
  const canManage = hasPermission(user, 'task.create');
  const canDelete = hasPermission(user, 'task.delete');

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/tasks', {
        params: { jobcardId, pageSize: 100, sortBy: 'createdAt', sortDir: 'asc' },
      });
      setTasks(r.data.items || []);
    } catch {
      setError('Could not load Task Progress');
    } finally {
      setLoading(false);
    }
  }, [jobcardId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const live = tasks.filter((t) => t.status !== 'CANCELLED');
    return {
      total: live.length,
      completed: live.filter((t) => t.status === 'COMPLETED').length,
      inProgress: live.filter((t) => ['ACCEPTED', 'IN_PROGRESS', 'REOPENED'].includes(t.status)).length,
      pending: live.filter((t) => ['NOT_STARTED', 'ASSIGNED'].includes(t.status)).length,
      overdue: live.filter((t) => t.overdue).length,
    };
  }, [tasks]);

  // the operator's checkbox — ticks only their own row on the task
  async function tick(task, done) {
    setBusyId(task.id);
    try {
      const r = await api.patch(`/tasks/${task.id}/my-completion`, { done });
      setTasks((list) => list.map((t) => (t.id === task.id ? r.data : t)));
      toast.success(done ? 'Marked complete' : 'Completion withdrawn');
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not update the task');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    try {
      await api.delete(`/tasks/${deleting.id}`);
      toast.success('Task deleted');
      setDeleting(null);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Could not delete the task');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-brand-600" aria-hidden="true" />
          <div className="font-semibold text-sm text-slate-800">Task Progress</div>
          {!!stats.total && (
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              {stats.completed} of {stats.total} done
            </span>
          )}
        </div>
        {canManage && (
          <button
            type="button" className={`${styles.secondaryBtn} !h-9 !px-3 text-xs`}
            onClick={() => { setEditing(null); setFormOpen(true); }}
          >
            <Plus className="w-3.5 h-3.5" /> Add Task Progress
          </button>
        )}
      </div>

      {canManage && !!stats.total && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {[
            { label: 'Pending', value: stats.pending, tone: 'text-slate-600 bg-slate-50' },
            { label: 'In Progress', value: stats.inProgress, tone: 'text-blue-600 bg-blue-50' },
            { label: 'Completed', value: stats.completed, tone: 'text-success-600 bg-success-50' },
            { label: 'Overdue', value: stats.overdue, tone: 'text-danger-600 bg-danger-50' },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.tone}`}>
              <div className="text-lg font-bold tabular-nums leading-tight">{c.value}</div>
              <div className="text-[10px] uppercase tracking-wide opacity-80">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading tasks…
        </div>
      )}

      {!loading && error && (
        <div className="py-6 text-center text-sm text-danger-600">
          {error}{' '}
          <button type="button" className="underline" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && !tasks.length && (
        <EmptyState
          icon={ListChecks}
          title="No Task Progress yet"
          description={canManage
            ? 'Add the work items for this project and assign the operators who will do them.'
            : 'Tasks your Department Head assigns to you on this project will appear here.'}
          className="py-8"
        />
      )}

      {!loading && !error && !!tasks.length && (
        <ul className="divide-y divide-slate-100">
          {tasks.map((t) => {
            const busy = busyId === t.id;
            const ticked = t.myAssignment?.status === 'COMPLETED';
            const closed = t.status === 'COMPLETED';
            return (
              <li key={t.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  {t.canTick ? (
                    <button
                      type="button" disabled={busy} onClick={() => tick(t, !ticked)}
                      aria-label={ticked ? `Undo completion of ${t.displayTitle}` : `Mark ${t.displayTitle} complete`}
                      className="shrink-0 mt-0.5 p-1 -m-1 rounded-lg hover:bg-slate-100 disabled:opacity-50"
                    >
                      {busy
                        ? <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
                        : ticked
                          ? <CheckSquare className="w-5 h-5 text-success-600" />
                          : <Square className="w-5 h-5 text-slate-300" />}
                    </button>
                  ) : (
                    <span className="shrink-0 mt-0.5 p-1 -m-1" aria-hidden="true">
                      {closed
                        ? <CheckSquare className="w-5 h-5 text-success-600" />
                        : <Square className="w-5 h-5 text-slate-200" />}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium ${closed || ticked ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}>
                      {t.displayTitle}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge status={t.overdue ? 'OVERDUE' : t.status}>
                        {t.overdue ? 'OVERDUE' : t.status.replace(/_/g, ' ')}
                      </Badge>
                      <Badge status={t.priority}>{t.priority}</Badge>
                      {t.dueDate && (
                        <span className={`text-[11px] ${t.overdue ? 'text-danger-600 font-medium' : 'text-slate-400'}`}>
                          Due {date(t.dueDate)}
                        </span>
                      )}
                      {t.requiresApproval && (
                        <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-2 py-0.5">
                          Needs review
                        </span>
                      )}
                    </div>

                    {!!t.assigneeTotal && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-slate-300 shrink-0" aria-hidden="true" />
                        {t.assignees.map((a) => (
                          <span
                            key={a.id}
                            className={`text-[11px] rounded-full border px-2 py-0.5 ${
                              a.status === 'COMPLETED'
                                ? 'bg-success-50 border-success-100 text-success-700'
                                : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                          >
                            {a.status === 'COMPLETED' ? '✓ ' : ''}{a.user.name}
                          </span>
                        ))}
                        {t.assigneeTotal > 1 && (
                          <span className="text-[11px] text-slate-400">
                            {t.assigneeDoneCount}/{t.assigneeTotal} done
                          </span>
                        )}
                      </div>
                    )}

                    {t.notes && <div className="mt-1.5 text-xs text-slate-500">{t.notes}</div>}
                  </div>

                  {canManage && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button" title="Edit task"
                        className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-slate-100"
                        onClick={() => { setEditing(t); setFormOpen(true); }}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {canDelete && (
                        <button
                          type="button" title="Delete task"
                          className="p-2 rounded-lg text-slate-400 hover:text-danger-600 hover:bg-danger-50"
                          onClick={() => setDeleting(t)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <TaskForm
        open={formOpen}
        editing={editing}
        jobcardId={Number(jobcardId)}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSaved={() => { load(); onChanged?.(); }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        variant="destructive"
        title="Delete this Task Progress?"
        confirmLabel="Delete task"
        message={deleting
          ? `"${deleting.displayTitle}"${deleting.assigneeTotal
            ? ` — assigned to ${deleting.assignees.map((a) => a.user.name).join(', ')}`
            : ''}. This cannot be undone. A task that already has completion history must be cancelled instead.`
          : ''}
      />
    </div>
  );
}
