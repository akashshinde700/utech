import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListChecks, Plus, Loader2, CheckSquare, Square, Pencil, Trash2, Users, AlertTriangle,
} from 'lucide-react';
import api from '../../lib/api';
import Modal from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';
import FormField from '../ui/FormField';
import Badge from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { date, datetime } from '../../lib/format';
import { hasPermission } from '../../lib/permissions';
import { stageLabel, stageNumber, WORKFLOW_STAGES } from '../../lib/workflowStages';
import { roleLabel } from '../../lib/roleLabel';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

// Task Progress on a project. The Department Head adds items from their own
// department's predefined list (Process Master, owned per workflow stage) and
// gives them to operators; each operator ticks their own checkbox. The same
// rows drive the project's Overall Progress (completed / total).

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const NEW_GROUP = '__new_group__';

function TaskForm({ open, onClose, onSaved, jobcardId, editing, projectTasks }) {
  const user = useAuth((s) => s.user);
  const locked = !!user?.scopeToDepartment; // Department Head / Supervisor / Team Leader
  const [departmentId, setDepartmentId] = useState('');
  // the assignment board: newly ticked items -> their operators, and changed
  // operators on items already on the project (taskId -> operators)
  const [selection, setSelection] = useState({});
  const [existingEdits, setExistingEdits] = useState({});
  const [assigneeIds, setAssigneeIds] = useState([]); // edit mode (one task)
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [people, setPeople] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setSelection({});
    setExistingEdits({});
    setAddingTo(null);
    setItemEdit(null);
    setItemConfirm(null);
    setDepartmentId(editing ? editing.departmentId : (locked ? user.departmentId : ''));
    setAssigneeIds(editing ? (editing.assignees || []).map((a) => a.userId) : []);
    setPriority(editing?.priority || 'MEDIUM');
    setDueDate(editing?.dueDate ? String(editing.dueDate).slice(0, 10) : '');
    setNotes(editing?.notes || '');
    setRequiresApproval(!!editing?.requiresApproval);
  }, [open, editing, locked, user?.departmentId]);

  useEffect(() => {
    if (!open || locked || editing) return;
    api.get('/departments', { params: { pageSize: 200 } })
      .then((r) => setDepartments(r.data.items || []))
      .catch(() => setDepartments([]));
  }, [open, locked, editing]);

  // both lists follow the department: only its own items, only its own people
  useEffect(() => {
    if (!open || !departmentId) { setPeople([]); setProcesses([]); return; }
    api.get('/tasks/workload', { params: { departmentId } })
      .then((r) => setPeople((r.data || []).sort((a, b) => (a.roleName === 'OPERATOR' ? 0 : 1) - (b.roleName === 'OPERATOR' ? 0 : 1))))
      .catch(() => setPeople([]));
    if (!editing) {
      api.get('/processes', { params: { departmentId, pageSize: 300, isActive: true } })
        .then((r) => setProcesses(r.data.items || []))
        .catch(() => setProcesses([]));
    }
  }, [open, departmentId, editing]);

  // items grouped under their numbered workflow stage, in stage order
  const stageGroups = useMemo(() => {
    const groups = {};
    for (const p of processes) (groups[p.stage || ''] ||= []).push(p);
    return Object.entries(groups)
      .sort(([a], [b]) => (stageNumber(a) ?? 99) - (stageNumber(b) ?? 99))
      .map(([stage, items]) => ({ stage, items: items.sort((x, y) => (x.displayOrder ?? 0) - (y.displayOrder ?? 0)) }));
  }, [processes]);

  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const flip = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  // live, non-rework task already on this project for a given item
  const taskByProcess = useMemo(() => {
    const m = {};
    for (const t of projectTasks || []) {
      if (t.processId && !t.parentOperationId && t.status !== 'CANCELLED') m[t.processId] = t;
    }
    return m;
  }, [projectTasks]);
  const operatorsOf = (t) => existingEdits[t.id] ?? t.assignees.map((a) => a.userId);
  // a department with a single operator needs no choosing
  const onlyOperator = people.filter((u) => u.roleName === 'OPERATOR');
  const defaultOperators = () => (onlyOperator.length === 1 ? [onlyOperator[0].id] : []);

  function tickItem(pid) {
    setSelection((sel) => {
      const next = { ...sel };
      if (pid in next) delete next[pid]; else next[pid] = defaultOperators();
      return next;
    });
  }
  // quick assign: give (or take back) one operator on every ticked new item
  function quickAssign(uid) {
    setSelection((sel) => {
      const keys = Object.keys(sel);
      const allHave = keys.every((k) => sel[k].includes(uid));
      return Object.fromEntries(keys.map((k) => [k, allHave ? sel[k].filter((x) => x !== uid) : [...new Set([...sel[k], uid])]]));
    });
  }
  function toggleExisting(task, uid) {
    setExistingEdits((m) => {
      const next = flip(operatorsOf(task), uid);
      const original = task.assignees.map((a) => a.userId);
      const same = next.length === original.length && next.every((x) => original.includes(x));
      const copy = { ...m };
      if (same) delete copy[task.id]; else copy[task.id] = next;
      return copy;
    });
  }
  // Edit / remove the department's own items right here. The 17 workflow
  // stages keep their names (stage numbers and department ownership hang off
  // them); groups the department made itself can be renamed or removed.
  const canEditItems = hasPermission(user, 'process.update');
  const canDeleteItems = hasPermission(user, 'process.delete');
  const [itemEdit, setItemEdit] = useState(null); // { kind: 'item'|'group', key, value }
  const [itemConfirm, setItemConfirm] = useState(null); // { kind, key, label }
  const [itemBusy, setItemBusy] = useState(false);
  const [itemErr, setItemErr] = useState(null);
  const isCustomGroup = (stage) => !!stage && !WORKFLOW_STAGES.includes(stage);
  const sameTarget = (a, kind, key) => a && a.kind === kind && a.key === key;

  function openEdit(kind, key, value) { setItemConfirm(null); setItemErr(null); setItemEdit({ kind, key, value }); }
  function openConfirm(kind, key, label) { setItemEdit(null); setItemErr(null); setItemConfirm({ kind, key, label }); }

  async function saveItemEdit() {
    const value = itemEdit.value.trim();
    if (value.length < 2) { setItemErr('Name is too short'); return; }
    setItemBusy(true);
    setItemErr(null);
    try {
      if (itemEdit.kind === 'item') {
        const r = await api.put(`/processes/${itemEdit.key}`, { name: value });
        setProcesses((list) => list.map((x) => (x.id === itemEdit.key ? { ...x, name: r.data.name } : x)));
      } else {
        const inGroup = processes.filter((x) => (x.stage || '') === itemEdit.key);
        for (const x of inGroup) await api.put(`/processes/${x.id}`, { stage: value });
        setProcesses((list) => list.map((x) => ((x.stage || '') === itemEdit.key ? { ...x, stage: value } : x)));
      }
      toast.success('Renamed');
      setItemEdit(null);
    } catch (e2) {
      setItemErr(e2.response?.data?.message || 'Could not rename');
    } finally {
      setItemBusy(false);
    }
  }

  async function confirmItemDelete() {
    setItemBusy(true);
    setItemErr(null);
    try {
      const ids = itemConfirm.kind === 'item'
        ? [itemConfirm.key]
        : processes.filter((x) => (x.stage || '') === itemConfirm.key).map((x) => x.id);
      for (const id of ids) await api.delete(`/processes/${id}`);
      setProcesses((list) => list.filter((x) => !ids.includes(x.id)));
      setSelection((sel) => Object.fromEntries(Object.entries(sel).filter(([k]) => !ids.includes(Number(k)))));
      toast.success(`${itemConfirm.label} removed from the list`);
      setItemConfirm(null);
    } catch (e2) {
      setItemErr(e2.response?.data?.message || 'Could not remove');
    } finally {
      setItemBusy(false);
    }
  }

  const onEditKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveItemEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setItemEdit(null); }
  };

  const toolBtn = 'p-1.5 rounded-md text-slate-400 hover:bg-slate-100 disabled:opacity-40';
  const itemTools = (kind, key, name, label) => (
    <span className="flex shrink-0 items-center">
      {canEditItems && (
        <button type="button" className={`${toolBtn} hover:text-brand-600`} aria-label={`Rename ${name}`} title="Rename" onClick={() => openEdit(kind, key, name)}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {canDeleteItems && (
        <button type="button" className={`${toolBtn} hover:text-danger-600`} aria-label={`Remove ${name}`} title="Remove from list" onClick={() => openConfirm(kind, key, label)}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );

  // inline rename field or remove confirmation, when one is open for this target
  const inlinePanel = (kind, key, extraNote) => {
    if (sameTarget(itemEdit, kind, key)) {
      return (
        <div className="space-y-1.5 bg-amber-50/60 px-3 py-2">
          <div className="flex gap-2">
            <input
              className={styles.input} autoFocus aria-label="New name"
              value={itemEdit.value} onChange={(e) => setItemEdit((x) => ({ ...x, value: e.target.value }))} onKeyDown={onEditKey}
            />
            <button type="button" className={`${styles.primaryBtn} shrink-0`} onClick={saveItemEdit} disabled={itemBusy}>
              {itemBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </button>
            <button type="button" className={`${styles.secondaryBtn} shrink-0`} onClick={() => setItemEdit(null)} disabled={itemBusy}>Cancel</button>
          </div>
          {itemErr && <div role="alert" className="text-xs text-danger-600">{itemErr}</div>}
        </div>
      );
    }
    if (sameTarget(itemConfirm, kind, key)) {
      return (
        <div className="space-y-1.5 bg-danger-50/60 px-3 py-2">
          <div className="text-sm text-slate-700">
            Remove <span className="font-medium">{itemConfirm.label}</span> from your department's list?
            <span className="block text-xs text-slate-500">
              {extraNote || 'It stops appearing here for new projects.'} Tasks already using it keep their name and history.
            </span>
          </div>
          <div className="flex gap-2">
            <button type="button" className={`${styles.primaryBtn} !bg-danger-600 hover:!bg-danger-700`} onClick={confirmItemDelete} disabled={itemBusy}>
              {itemBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Remove'}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => setItemConfirm(null)} disabled={itemBusy}>Cancel</button>
          </div>
          {itemErr && <div role="alert" className="text-xs text-danger-600">{itemErr}</div>}
        </div>
      );
    }
    return null;
  };

  const tickedCount = Object.keys(selection).length;
  const editedCount = Object.keys(existingEdits).length;

  const operatorChips = (value, onToggle, disabled = false) => (
    <div className="flex flex-wrap gap-1.5">
      {people.map((u) => {
        const on = value.includes(u.id);
        return (
          <button
            key={u.id} type="button" disabled={disabled} aria-pressed={on}
            onClick={() => onToggle(u.id)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${on
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300'}`}
          >
            {on ? '\u2713 ' : ''}{u.name}
          </button>
        );
      })}
    </div>
  );

  // New items straight into the department's Process Master — under an
  // existing stage group, or as a brand-new group with its first item.
  const canAddItems = hasPermission(user, 'process.create');
  const [addingTo, setAddingTo] = useState(null); // stage name | NEW_GROUP | null
  const [newItemName, setNewItemName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState(null);

  function startAdding(target) {
    setAddingTo(target); setNewItemName(''); setNewGroupName(''); setAddErr(null);
  }

  async function addItem() {
    const stage = addingTo === NEW_GROUP ? newGroupName.trim() : addingTo;
    const name = newItemName.trim();
    if (addingTo === NEW_GROUP && stage.length < 2) { setAddErr('Enter a group name'); return; }
    if (name.length < 2) { setAddErr('Enter an item name'); return; }
    setAddBusy(true);
    setAddErr(null);
    try {
      const r = await api.post('/processes', { name, stage: stage || null, departmentId: Number(departmentId) });
      setProcesses((list) => [...list, r.data]);
      setSelection((sel) => ({ ...sel, [r.data.id]: defaultOperators() })); // added to be used — tick it
      toast.success(`"${r.data.name}" added to ${stage || 'the list'}`);
      setAddingTo(null);
    } catch (e2) {
      setAddErr(e2.response?.data?.message || 'Could not add the item');
    } finally {
      setAddBusy(false);
    }
  }

  // Enter inside these inputs must add the item, not submit the task form
  const onAddKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAddingTo(null); }
  };

  const addRow = (
    <div className="space-y-2 bg-brand-50/40 px-3 py-2.5">
      {addingTo === NEW_GROUP && (
        <input
          className={styles.input} placeholder="Group name, e.g. Heat Treatment" autoFocus
          value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} onKeyDown={onAddKey}
          aria-label="New group name"
        />
      )}
      <div className="flex gap-2">
        <input
          className={styles.input} placeholder={addingTo === NEW_GROUP ? 'First item, e.g. Annealing' : 'Item name, e.g. Waterjet Cutting'}
          autoFocus={addingTo !== NEW_GROUP}
          value={newItemName} onChange={(e) => setNewItemName(e.target.value)} onKeyDown={onAddKey}
          aria-label="New item name"
        />
        <button type="button" className={`${styles.primaryBtn} shrink-0`} onClick={addItem} disabled={addBusy}>
          {addBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
        </button>
        <button type="button" className={`${styles.secondaryBtn} shrink-0`} onClick={() => setAddingTo(null)} disabled={addBusy}>Cancel</button>
      </div>
      {addErr && <div role="alert" className="text-xs text-danger-600">{addErr}</div>}
    </div>
  );

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!departmentId) { setErr('Department is required'); return; }
    if (!editing && !tickedCount && !editedCount) { setErr('Tick an item, or change who an item on the project is assigned to'); return; }
    if (!editing && Object.values(existingEdits).some((ids) => !ids.length)) {
      setErr('An item already on the project needs at least one operator'); return;
    }
    setSaving(true);
    try {
      const common = {
        priority,
        dueDate: dueDate || null,
        notes: notes || null,
        requiresApproval,
      };
      if (editing) {
        await api.put(`/tasks/${editing.id}`, common);
        // assignment has its own endpoint so it lands in the task's history
        const before = (editing.assignees || []).map((a) => a.userId).sort().join(',');
        if (assigneeIds.length && before !== [...assigneeIds].sort().join(',')) {
          await api.post(`/tasks/${editing.id}/assign`, { assigneeIds });
        }
      } else {
        if (tickedCount) {
          await api.post('/tasks/bulk', {
            ...common, jobcardId, departmentId: Number(departmentId),
            items: Object.entries(selection).map(([pid, ids]) => ({ processId: Number(pid), assigneeIds: ids })),
          });
        }
        // reassignments go one by one through /assign so each keeps its history
        for (const [taskId, ids] of Object.entries(existingEdits)) {
          await api.post(`/tasks/${taskId}/assign`, { assigneeIds: ids });
        }
      }
      const parts = [];
      if (tickedCount) parts.push(`${tickedCount} added`);
      if (editedCount) parts.push(`${editedCount} reassigned`);
      toast.success(editing ? 'Task updated' : `Tasks ${parts.join(', ')}`);
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2.response?.data?.message || 'Could not save the task');
    } finally {
      setSaving(false);
    }
  }

  const saveLabel = [tickedCount && `${tickedCount} new`, editedCount && `${editedCount} reassigned`].filter(Boolean).join(', ');
  const deptName = editing?.department?.name || (locked ? user?.departmentName : departments.find((d) => d.id === Number(departmentId))?.name);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Task Progress' : 'Assign Task Progress'}
      description={editing ? editing.displayTitle : "Every item in your department's list for this project. Tick new ones and pick who does each; change operators on ones already here."}
      size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="task-progress-form" className={styles.primaryBtn} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {editing ? 'Save changes' : saveLabel ? `Save (${saveLabel})` : 'Save'}
          </button>
        </div>
      )}
    >
      <form id="task-progress-form" onSubmit={submit} className="space-y-4">
        {err && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{err}</span>
          </div>
        )}

        <FormField id="tp-dept" label="Department" required>
          {locked || editing ? (
            <input id="tp-dept" className={styles.input} value={deptName || 'Your department'} disabled />
          ) : (
            <select
              id="tp-dept" className={styles.input} value={departmentId}
              onChange={(e) => { setDepartmentId(e.target.value ? Number(e.target.value) : ''); setSelection({}); setExistingEdits({}); }}
            >
              <option value="">Select department</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </FormField>

        {!editing && (
          <FormField id="tp-items" label="Task Progress Items" required hint={departmentId ? `All of ${deptName || 'this department'}'s items. Tap a name under an item to give it to that operator.` : 'Pick a department first.'}>
            {tickedCount > 1 && people.length > 0 && (
              <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="mb-1.5 text-[11px] font-medium text-slate-500">Give all {tickedCount} ticked items to:</div>
                {operatorChips(
                  people.filter((u) => Object.values(selection).every((ids) => ids.includes(u.id))).map((u) => u.id),
                  quickAssign,
                )}
              </div>
            )}
            <div className="max-h-[26rem] overflow-y-auto rounded-lg border border-slate-200">
              {!departmentId && <div className="px-3 py-4 text-sm text-slate-400">Select a department to list its items.</div>}
              {departmentId && !processes.length && (
                <div className="px-3 py-4 text-sm text-slate-400">No Task Progress items are set up for this department in the Process Master.</div>
              )}
              {stageGroups.map((g) => (
                <div key={g.stage || 'other'} className="border-b border-slate-100 last:border-b-0">
                  <div className="flex items-center justify-between bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <span className="py-0.5">{stageLabel(g.stage)}</span>
                    {isCustomGroup(g.stage) && itemTools('group', g.stage, g.stage, `the "${g.stage}" group and its ${g.items.length} item${g.items.length > 1 ? 's' : ''}`)}
                  </div>
                  {inlinePanel('group', g.stage || '', 'The whole group stops appearing here for new projects.')}
                  {g.items.map((p) => {
                    const panel = inlinePanel('item', p.id);
                    if (panel) return <div key={p.id}>{panel}</div>;
                    const existing = taskByProcess[p.id];
                    if (existing) {
                      const closedTask = ['COMPLETED', 'SUBMITTED', 'REJECTED'].includes(existing.status);
                      const changed = existing.id in existingEdits;
                      return (
                        <div key={p.id} className={`px-3 py-2.5 ${changed ? 'bg-amber-50/70' : ''}`}>
                          <div className="flex items-center gap-2.5 text-sm">
                            <CheckSquare className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="flex-1 min-w-0 text-slate-700">{p.name}</span>
                            <span className="text-[11px] text-slate-400 shrink-0">on project · {existing.status.replace(/_/g, ' ').toLowerCase()}</span>
                            {itemTools('item', p.id, p.name, `"${p.name}"`)}
                          </div>
                          <div className="mt-2 pl-6">
                            {operatorChips(operatorsOf(existing), (uid) => toggleExisting(existing, uid), closedTask)}
                            {closedTask && <div className="mt-1 text-[11px] text-slate-400">Already {existing.status.toLowerCase()} — can't reassign.</div>}
                          </div>
                        </div>
                      );
                    }
                    const on = p.id in selection;
                    return (
                      <div key={p.id} className={`px-3 py-2.5 ${on ? 'bg-brand-50/40' : ''}`}>
                        <div className="flex items-center gap-2">
                          <label className="flex flex-1 min-w-0 cursor-pointer items-center gap-2.5 text-sm">
                            <input
                              type="checkbox" className="h-4 w-4 shrink-0 accent-brand-600"
                              checked={on} onChange={() => tickItem(p.id)}
                            />
                            <span className="flex-1 min-w-0 text-slate-700">{p.name}</span>
                            {on && !selection[p.id].length && <span className="text-[11px] text-amber-600 shrink-0">pick an operator</span>}
                          </label>
                          {itemTools('item', p.id, p.name, `"${p.name}"`)}
                        </div>
                        {on && (
                          <div className="mt-2 pl-6">
                            {operatorChips(selection[p.id], (uid) => setSelection((sel) => ({ ...sel, [p.id]: flip(sel[p.id], uid) })))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {canAddItems && (addingTo === g.stage ? addRow : (
                    <button
                      type="button" onClick={() => startAdding(g.stage)}
                      className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-brand-600 hover:bg-brand-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add item to {g.stage || 'this group'}
                    </button>
                  ))}
                </div>
              ))}
              {canAddItems && departmentId && (addingTo === NEW_GROUP ? (
                <div className="border-t border-slate-200">
                  <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">New group</div>
                  {addRow}
                </div>
              ) : (
                <button
                  type="button" onClick={() => startAdding(NEW_GROUP)}
                  className="flex w-full items-center gap-1.5 border-t border-slate-200 px-3 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  <Plus className="w-4 h-4" /> New group
                </button>
              ))}
            </div>
          </FormField>
        )}

        {editing && (
        <FormField id="tp-ops" label="Assign Operators" hint="The item appears only for the people you tick. Each ticks their own checkbox.">
          <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {!departmentId && <div className="px-3 py-4 text-sm text-slate-400">Select a department to list its people.</div>}
            {departmentId && !people.length && <div className="px-3 py-4 text-sm text-slate-400">No active users in this department.</div>}
            {people.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox" className="h-4 w-4 shrink-0 accent-brand-600"
                  checked={assigneeIds.includes(p.id)} onChange={() => toggle(assigneeIds, setAssigneeIds, p.id)}
                />
                <span className="flex-1 min-w-0 truncate text-slate-700">
                  {p.name}
                  {p.roleName && <span className="ml-1.5 text-[11px] text-slate-400">({roleLabel(p.roleName, deptName)})</span>}
                </span>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {p.activeTasks + p.pendingTasks} open{p.overdueTasks ? ` · ${p.overdueTasks} overdue` : ''}
                </span>
              </label>
            ))}
          </div>
        </FormField>
        )}

        {!editing && <div className="text-xs font-medium uppercase tracking-wide text-slate-400">For newly added items</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="tp-priority" label="Priority">
            <select id="tp-priority" className={styles.input} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </FormField>
          <FormField id="tp-due" label="Due Date">
            <input id="tp-due" type="date" className={styles.input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
        </div>

        <FormField id="tp-notes" label="Instructions">
          <textarea
            id="tp-notes" className={styles.textarea} value={notes}
            onChange={(e) => setNotes(e.target.value)} placeholder="Anything the operator needs to know"
          />
        </FormField>

        <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600"
            checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)}
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

// One Task Progress row. `asOperator` is the viewer's own slice of the task —
// the checkbox and the Pending/Completed wording are about *their* part.
function TaskRow({ t, busy, onTick, canManage, canDelete, onEdit, onDelete }) {
  const mine = t.myAssignment;
  const myDone = mine?.status === 'COMPLETED';
  const closed = t.status === 'COMPLETED';
  const checkboxId = `tp-check-${t.id}`;
  const othersPending = mine ? t.assigneeTotal - t.assigneeDoneCount - (myDone ? 0 : 1) : 0;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-label="Saving" />
          ) : t.canTick ? (
            <input
              id={checkboxId} type="checkbox"
              className="h-5 w-5 cursor-pointer accent-success-600"
              checked={myDone} onChange={(e) => onTick(t, e.target.checked)}
            />
          ) : closed ? (
            <CheckSquare className="h-5 w-5 text-success-600" aria-label="Completed" />
          ) : (
            <Square className="h-5 w-5 text-slate-200" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <label htmlFor={t.canTick ? checkboxId : undefined} className={`block text-sm font-medium ${t.canTick ? 'cursor-pointer' : ''} ${myDone || closed ? 'text-success-700' : 'text-slate-800'}`}>
            {t.displayTitle}
          </label>
          <div className="mt-0.5 text-xs text-slate-400">
            {t.process?.stage ? `${stageLabel(t.process.stage)} · ` : ''}{t.department?.name || 'No department'}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {mine ? (
              <Badge status={myDone ? 'COMPLETED' : t.overdue ? 'OVERDUE' : 'PENDING'}>
                {myDone ? 'Completed' : t.overdue ? 'Overdue' : 'Pending'}
              </Badge>
            ) : (
              <Badge status={t.overdue ? 'OVERDUE' : t.status}>{t.overdue ? 'OVERDUE' : t.status.replace(/_/g, ' ')}</Badge>
            )}
            <Badge status={t.priority}>{t.priority}</Badge>
            {t.dueDate && !closed && (
              <span className={`text-[11px] ${t.overdue ? 'text-danger-600 font-medium' : 'text-slate-400'}`}>Due {date(t.dueDate)}</span>
            )}
            {t.requiresApproval && (
              <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-2 py-0.5">
                {t.status === 'SUBMITTED' ? 'Awaiting review' : 'Needs review'}
              </span>
            )}
          </div>

          {mine && myDone && (
            <div className="mt-1 text-[11px] text-slate-500">
              Completed {datetime(mine.completedAt)}
              {othersPending > 0 && ` · waiting for ${othersPending} other operator${othersPending > 1 ? 's' : ''}`}
            </div>
          )}
          {!mine && closed && t.endAt && <div className="mt-1 text-[11px] text-slate-500">Completed {datetime(t.endAt)}</div>}

          {!!t.assigneeTotal && (!mine || t.assigneeTotal > 1) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-300 shrink-0" aria-hidden="true" />
              {t.assignees.map((a) => (
                <span
                  key={a.id}
                  title={a.status === 'COMPLETED' ? `Completed ${datetime(a.completedAt)}` : 'Pending'}
                  className={`text-[11px] rounded-full border px-2 py-0.5 ${a.status === 'COMPLETED'
                    ? 'bg-success-50 border-success-100 text-success-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                >
                  {a.status === 'COMPLETED' ? '✓ ' : ''}{a.user.name}
                </span>
              ))}
              {t.assigneeTotal > 1 && <span className="text-[11px] text-slate-400">{t.assigneeDoneCount}/{t.assigneeTotal} done</span>}
            </div>
          )}
          {!t.assigneeTotal && canManage && <div className="mt-1.5 text-[11px] text-amber-600">Not assigned to anyone yet</div>}

          {t.notes && <div className="mt-1.5 text-xs text-slate-500">{t.notes}</div>}
        </div>

        {canManage && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button" aria-label={`Edit ${t.displayTitle}`} title="Edit / reassign"
              className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-slate-100 disabled:opacity-30"
              onClick={() => onEdit(t)} disabled={['COMPLETED', 'CANCELLED', 'REJECTED'].includes(t.status)}
            >
              <Pencil className="w-4 h-4" />
            </button>
            {canDelete && (
              <button
                type="button" aria-label={`Delete ${t.displayTitle}`} title="Delete"
                className="p-2 rounded-lg text-slate-400 hover:text-danger-600 hover:bg-danger-50"
                onClick={() => onDelete(t)}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </li>
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

  const live = useMemo(() => tasks.filter((t) => t.status !== 'CANCELLED'), [tasks]);
  // completed / total over what this viewer can see — for an operator that is
  // exactly their own assigned items
  const done = live.filter((t) => (t.myAssignment ? t.myAssignment.status === 'COMPLETED' : t.status === 'COMPLETED')).length;
  const pct = live.length ? Math.round((done / live.length) * 100) : 0;

  // managers and the Project Engineer read it department by department
  const byDepartment = useMemo(() => {
    const groups = {};
    for (const t of live) {
      const key = t.department?.name || 'No department';
      (groups[key] ||= []).push(t);
    }
    for (const list of Object.values(groups)) {
      list.sort((a, b) => (stageNumber(a.process?.stage) ?? 99) - (stageNumber(b.process?.stage) ?? 99) || a.id - b.id);
    }
    return Object.entries(groups);
  }, [live]);
  // cancelled items stay in history but out of the working list
  const cancelledCount = tasks.length - live.length;
  const isOperatorView = live.length > 0 && live.every((t) => t.myAssignment);


  // the operator's checkbox — flips immediately, rolls back if the save fails
  async function tick(task, nextDone) {
    const before = tasks;
    setBusyId(task.id);
    setTasks((list) => list.map((t) => (t.id === task.id
      ? { ...t, myAssignment: { ...t.myAssignment, status: nextDone ? 'COMPLETED' : 'PENDING', completedAt: nextDone ? new Date().toISOString() : null } }
      : t)));
    try {
      const r = await api.patch(`/tasks/${task.id}/my-completion`, { done: nextDone });
      setTasks((list) => list.map((t) => (t.id === task.id ? r.data : t)));
      toast.success(nextDone ? 'Marked completed' : 'Marked pending');
      onChanged?.();
    } catch (e) {
      setTasks(before);
      toast.error(e.response?.data?.message || 'Could not save — please try again');
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

  const rowProps = (t) => ({
    t, busy: busyId === t.id, onTick: tick, canManage, canDelete,
    onEdit: (x) => { setEditing(x); setFormOpen(true); },
    onDelete: setDeleting,
  });

  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-brand-600" aria-hidden="true" />
          <div className="font-semibold text-sm text-slate-800">Task Progress</div>
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

      {!loading && !error && live.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">
            <span>{done} of {live.length} done{isOperatorView ? ' (your items)' : ''}</span>
            <span className="text-brand-700 text-sm font-bold tabular-nums normal-case">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-success-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading tasks…
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="py-6 text-center text-sm text-danger-600">
          {error}{' '}
          <button type="button" className="underline" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && !live.length && (
        <EmptyState
          icon={ListChecks}
          title="No Task Progress yet"
          description={canManage
            ? "Add items from your department's list and assign the operators who will do them."
            : 'Tasks your Department Head assigns to you on this project will appear here.'}
          className="py-8"
        />
      )}

      {!loading && !error && cancelledCount > 0 && canManage && (
        <div className="mb-2 text-[11px] text-slate-400">{cancelledCount} cancelled item{cancelledCount > 1 ? 's' : ''} hidden</div>
      )}

      {!loading && !error && !!live.length && (isOperatorView ? (
        <ul className="divide-y divide-slate-100">
          {[...live]
            .sort((a, b) => (stageNumber(a.process?.stage) ?? 99) - (stageNumber(b.process?.stage) ?? 99) || a.id - b.id)
            .map((t) => <TaskRow key={t.id} {...rowProps(t)} />)}
        </ul>
      ) : (
        <div className="space-y-4">
          {byDepartment.map(([dept, list]) => {
            const liveInDept = list.filter((t) => t.status !== 'CANCELLED');
            const doneInDept = liveInDept.filter((t) => t.status === 'COMPLETED').length;
            return (
              <section key={dept}>
                {byDepartment.length > 1 && (
                  <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{dept}</h4>
                    <span className="text-[11px] text-slate-400">{doneInDept}/{liveInDept.length} done</span>
                  </div>
                )}
                <ul className="divide-y divide-slate-100">
                  {list.map((t) => <TaskRow key={t.id} {...rowProps(t)} />)}
                </ul>
              </section>
            );
          })}
        </div>
      ))}

      <TaskForm
        open={formOpen}
        editing={editing}
        jobcardId={Number(jobcardId)}
        projectTasks={live}
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
