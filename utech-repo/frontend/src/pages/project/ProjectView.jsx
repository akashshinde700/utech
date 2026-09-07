import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Trash2, Briefcase, Loader2, Package } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { required, validateAll } from '../../lib/validation';
import { inr, date } from '../../lib/format';
import toast from 'react-hot-toast';

const itemValue = (it) => Number(it.currentStock || 0) * Number(it.purchaseRate || 0);

const newTask = () => ({ name: '', status: 'TODO', startDate: '', dueDate: '' });
const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'];

export default function ProjectView() {
  const { id } = useParams();
  const [proj, setProj] = useState(null);
  const [adding, setAdding] = useState(null);
  const [addErrors, setAddErrors] = useState({});
  const [addingBusy, setAddingBusy] = useState(false);
  const [deletingTask, setDeletingTask] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const [allItems, setAllItems] = useState([]);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemId, setAddItemId] = useState('');
  const [addItemBusy, setAddItemBusy] = useState(false);
  const [unlinkItem, setUnlinkItem] = useState(null);
  const [unlinkBusy, setUnlinkBusy] = useState(false);

  async function load() { const r = await api.get(`/projects/${id}`); setProj(r.data); }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function openAddItem() {
    setAddItemId('');
    setAddItemOpen(true);
    if (allItems.length === 0) {
      api.get('/items', { params: { pageSize: 300 } })
        .then((r) => setAllItems(r.data.items || []))
        .catch(() => toast.error('Failed to load items'));
    }
  }

  const linkedIds = useMemo(() => new Set((proj?.items || []).map((i) => i.id)), [proj]);
  const addItemOptions = useMemo(
    () => allItems
      .filter((it) => !linkedIds.has(it.id) && !it.project)
      .map((it) => ({ value: it.id, label: `${it.code} — ${it.name}`, subtitle: `Stock: ${Number(it.currentStock)}` })),
    [allItems, linkedIds]
  );

  async function addItem() {
    if (!addItemId) { toast.error('Select an item'); return; }
    setAddItemBusy(true);
    try {
      await api.post(`/projects/${id}/items`, { itemId: Number(addItemId) });
      toast.success('Item linked to project');
      setAddItemOpen(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to link item');
    } finally {
      setAddItemBusy(false);
    }
  }

  async function doUnlinkItem() {
    if (!unlinkItem) return;
    setUnlinkBusy(true);
    try {
      await api.delete(`/projects/${id}/items/${unlinkItem.id}`);
      toast.success('Item removed from project');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove item');
    } finally {
      setUnlinkBusy(false);
      setUnlinkItem(null);
    }
  }

  function openAddTask() {
    setAddErrors({});
    setAdding(newTask());
  }

  function setField(key, value) {
    setAdding((t) => ({ ...t, [key]: value }));
    setAddErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  async function addTask() {
    const { errors: nextErrors, ok } = validateAll(adding, {
      name: (v) => required(v, 'Task name'),
    });
    if (!ok) {
      setAddErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setAddingBusy(true);
    try {
      const payload = { ...adding, startDate: adding.startDate || null, dueDate: adding.dueDate || null };
      await api.post(`/projects/${id}/tasks`, payload);
      toast.success('Task added successfully');
      setAdding(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to add task');
    } finally {
      setAddingBusy(false);
    }
  }

  async function delTask() {
    if (!deletingTask) return;
    setDeletingBusy(true);
    try {
      await api.delete(`/projects/${id}/tasks/${deletingTask.id}`);
      toast.success('Deleted successfully');
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete task');
    } finally {
      setDeletingBusy(false);
      setDeletingTask(null);
    }
  }

  async function setStatus(taskId, status) {
    await api.put(`/projects/${id}/tasks/${taskId}`, { status });
    load();
  }

  if (!proj) return <div className="text-sm text-slate-500">Loading…</div>;

  const doneCount = proj.tasks.filter((t) => t.status === 'DONE').length;
  const progress = Math.round((doneCount / Math.max(1, proj.tasks.length)) * 100);
  const projItems = proj.items || [];
  const materialsValue = projItems.reduce((s, it) => s + itemValue(it), 0);

  return (
    <div>
      <PageHeader title={`${proj.name}`} subtitle={`${proj.code} • ${proj.status}`}
        action={<button className="btn-primary" onClick={openAddTask}><Plus className="w-4 h-4" /> Add task</button>} />

      <div className="card p-5 max-w-6xl mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
          <div><div className="text-xs text-slate-500">Budget</div><div className="font-semibold tabular-nums font-mono">{proj.budget ? inr(proj.budget) : '—'}</div></div>
          <div><div className="text-xs text-slate-500">Tasks Done</div><div className="font-semibold tabular-nums">{doneCount} / {proj.tasks.length}</div></div>
          <div><div className="text-xs text-slate-500">Items</div><div className="font-semibold tabular-nums">{projItems.length}</div></div>
          <div><div className="text-xs text-slate-500">Materials Value</div><div className="font-semibold tabular-nums font-mono">{inr(materialsValue)}</div></div>
          <div><div className="text-xs text-slate-500">Start</div>{date(proj.startDate)}</div>
          <div><div className="text-xs text-slate-500">End</div>{date(proj.endDate)}</div>
        </div>
        {proj.budget && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-500 mb-1">Task Progress</div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-brand-600 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
            <div className="text-xs text-slate-500 mt-1">{progress}% complete</div>
          </div>
        )}
      </div>

      <div className="card p-5 max-w-6xl mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-sm flex items-center gap-2">
            <Package className="w-4 h-4 text-brand-600" aria-hidden="true" /> Project Items ({projItems.length})
          </div>
          <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={openAddItem}>
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>
        {projItems.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No items linked"
            description="Link the raw material and parts used on this project — their stock and value roll up here."
            action={{ label: 'Add item', onClick: openAddItem, icon: Plus }}
          />
        ) : (
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead><tr>
                <th className="table-th rounded-tl-lg">Code</th>
                <th className="table-th">Name</th>
                <th className="table-th">Type</th>
                <th className="table-th text-right">Current Stock</th>
                <th className="table-th text-right">Value</th>
                <th className="table-th rounded-tr-lg"></th>
              </tr></thead>
              <tbody>
                {projItems.map((it) => (
                  <tr key={it.id}>
                    <td className="table-td font-mono text-xs">{it.code}</td>
                    <td className="table-td font-medium">{it.name}</td>
                    <td className="table-td text-xs">{(it.type || '').replace(/_/g, ' ')}</td>
                    <td className="table-td text-right tabular-nums">
                      {Number(it.currentStock)}{it.uom?.code ? ` ${it.uom.code}` : ''}
                      {Number(it.currentStock) < Number(it.minStock) && (
                        <span className="ml-1 text-[10px] text-danger-600 font-semibold">LOW</span>
                      )}
                    </td>
                    <td className="table-td text-right tabular-nums font-mono">{inr(itemValue(it))}</td>
                    <td className="table-td text-right">
                      <button className="btn-danger !px-2 !py-1" aria-label={`Remove ${it.name} from project`} onClick={() => setUnlinkItem(it)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td className="table-td font-semibold" colSpan={4}>Total materials value</td>
                  <td className="table-td text-right font-semibold font-mono tabular-nums">{inr(materialsValue)}</td>
                  <td className="table-td"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5 max-w-6xl">
        <div className="font-semibold text-sm mb-3 flex items-center gap-2"><Briefcase className="w-4 h-4 text-brand-600" aria-hidden="true" /> Tasks ({proj.tasks.length})</div>
        {proj.tasks.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No tasks yet"
            description="Break the project down into trackable tasks with due dates."
            action={{ label: 'Add task', onClick: openAddTask, icon: Plus }}
          />
        ) : (
          <table className="min-w-full">
            <thead><tr>
              <th className="table-th rounded-tl-lg">Task</th>
              <th className="table-th">Start</th>
              <th className="table-th">Due</th>
              <th className="table-th">Status</th>
              <th className="table-th rounded-tr-lg"></th>
            </tr></thead>
            <tbody>
              {proj.tasks.map((t) => (
                <tr key={t.id}>
                  <td className="table-td font-medium">{t.name}</td>
                  <td className="table-td">{date(t.startDate)}</td>
                  <td className="table-td">{date(t.dueDate)}</td>
                  <td className="table-td">
                    <select className={`${styles.input} !h-9 !w-auto text-sm`} aria-label={`Status for task ${t.name}`} value={t.status} onChange={(e) => setStatus(t.id, e.target.value)}>
                      {TASK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                  </td>
                  <td className="table-td"><button className="btn-danger !px-2 !py-1" aria-label={`Delete task ${t.name}`} onClick={() => setDeletingTask(t)}><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <Modal
          open
          onClose={() => setAdding(null)}
          title="New task"
          description="A trackable unit of work within this project"
          size="md"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setAdding(null)} disabled={addingBusy}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={addTask} disabled={addingBusy}>
                {addingBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {addingBusy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField id="task-name" label="Name" required error={addErrors.name}>
              <input
                id="task-name"
                className={`${styles.input} ${addErrors.name ? styles.inputError : ''}`}
                aria-invalid={!!addErrors.name}
                aria-describedby={addErrors.name ? 'task-name-error' : undefined}
                value={adding.name}
                onChange={(e) => setField('name', e.target.value)}
              />
            </FormField>
            <div className={styles.formGrid}>
              <FormField id="task-start" label="Start">
                <input id="task-start" type="date" className={styles.input} value={adding.startDate} onChange={(e) => setField('startDate', e.target.value)} />
              </FormField>
              <FormField id="task-due" label="Due">
                <input id="task-due" type="date" className={styles.input} value={adding.dueDate} onChange={(e) => setField('dueDate', e.target.value)} />
              </FormField>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deletingTask}
        onClose={() => setDeletingTask(null)}
        onConfirm={delTask}
        title="Delete task?"
        message={`${deletingTask?.name} will be permanently removed from this project.`}
        confirmLabel="Delete task"
        variant="destructive"
        loading={deletingBusy}
      />

      {addItemOpen && (
        <Modal
          open
          onClose={() => setAddItemOpen(false)}
          title="Add item to project"
          description="Links an existing catalog item to this project"
          size="md"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setAddItemOpen(false)} disabled={addItemBusy}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={addItem} disabled={addItemBusy}>
                {addItemBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {addItemBusy ? 'Linking…' : 'Add item'}
              </button>
            </>
          }
        >
          <FormField id="add-item" label="Item" hint="Only items not already linked to a project are listed">
            <SearchableSelect
              id="add-item"
              value={addItemId}
              onChange={setAddItemId}
              options={addItemOptions}
              placeholder="Select item…"
              emptyText="No unlinked items"
            />
          </FormField>
        </Modal>
      )}

      <ConfirmDialog
        open={!!unlinkItem}
        onClose={() => setUnlinkItem(null)}
        onConfirm={doUnlinkItem}
        title="Remove item from project?"
        message={`${unlinkItem?.name} stays in the catalog — only its link to this project is removed.`}
        confirmLabel="Remove item"
        variant="destructive"
        loading={unlinkBusy}
      />
    </div>
  );
}
