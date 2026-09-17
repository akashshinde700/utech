import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Badge from '../../components/ui/Badge';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, validateAll } from '../../lib/validation';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

const empty = {
  code: '', name: '', stage: '', description: '', stdTimeMin: '', ratePerHour: '',
  departmentId: '', parentProcessId: '', dependsOnProcessId: '', displayOrder: 0, isActive: true,
};

export default function ProcessPage() {
  const user = useAuth((s) => s.user);
  // a scoped user (Department Head/Supervisor/Team Leader) can only ever add
  // to their own department — locked, not shown as a picker
  const scopedDeptId = user?.scopeToDepartment ? user.departmentId : null;

  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
  const [departments, setDepartments] = useState([]);
  const [allProcesses, setAllProcesses] = useState([]); // for parent/depends-on pickers
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/processes', { params: { page, pageSize: 30, sortBy: 'displayOrder', sortDir: 'asc' } });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load processes');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get('/departments', { params: { pageSize: 100 } }).then((r) => setDepartments(r.data.items || r.data));
    api.get('/processes', { params: { pageSize: 500, topLevelOnly: 0 } }).then((r) => setAllProcesses(r.data.items));
  }, []);

  const deptOptions = [
    { value: '', label: 'Global — any department' },
    ...departments.map((d) => ({ value: d.id, label: d.name })),
  ];
  const processOptions = (excludeId) => allProcesses
    .filter((p) => p.id !== excludeId)
    .map((p) => ({ value: p.id, label: `${p.name}${p.stage ? ` (${p.stage})` : ''}` }));

  function openNew() {
    setErrors({});
    setEditing({ ...empty, departmentId: scopedDeptId || '' });
  }

  function setField(key, value) {
    setEditing((e) => ({ ...e, [key]: value }));
    setErrors((errs) => (errs[key] ? { ...errs, [key]: undefined } : errs));
  }

  function blurOptionalNumber(key) {
    const s = String(editing[key] ?? '').trim();
    if (s === '') return;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) {
      setErrors((errs) => ({ ...errs, [key]: `${key === 'stdTimeMin' ? 'Std time' : 'Rate per hour'} must be a number greater than 0` }));
    }
  }

  async function save() {
    const { errors: nextErrors, ok } = validateAll(editing, {
      name: (v) => required(v, 'Name'),
      stdTimeMin: (v) => { const s = String(v ?? '').trim(); return s === '' ? null : positiveNumber(s, 'Std time'); },
      ratePerHour: (v) => { const s = String(v ?? '').trim(); return s === '' ? null : positiveNumber(s, 'Rate per hour'); },
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...editing };
      ['stdTimeMin', 'ratePerHour'].forEach((k) => { payload[k] = payload[k] === '' || payload[k] == null ? null : Number(payload[k]); });
      ['departmentId', 'parentProcessId', 'dependsOnProcessId'].forEach((k) => { payload[k] = payload[k] === '' ? null : Number(payload[k]); });
      payload.displayOrder = payload.displayOrder === '' || payload.displayOrder == null ? 0 : Number(payload.displayOrder);
      if (!payload.code) delete payload.code;
      if (editing.id) await api.put(`/processes/${editing.id}`, payload);
      else await api.post('/processes', payload);
      toast.success('Saved');
      setEditing(null);
      load();
      api.get('/processes', { params: { pageSize: 500 } }).then((r) => setAllProcesses(r.data.items));
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save process');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.delete(`/processes/${deleting.id}`);
      toast.success('Deactivated');
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to deactivate process');
    } finally {
      setDeletingBusy(false);
      setDeleting(null);
    }
  }

  const deptName = (id) => departments.find((d) => d.id === id)?.name;

  return (
    <div>
      <PageHeader title="Process Master" subtitle="Department → Process → Sub-Process — the task-creation workflow master"
        action={<button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> New process</button>} />

      <DataTable
        rows={data.items}
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No processes yet"
        emptyDescription="Define manufacturing stages/operations (e.g. Cutting, OD Turning) so tasks can be created against them."
        emptyAction={{ label: 'New process', onClick: openNew, icon: Plus }}
        columns={[
          { key: 'name', title: 'Process', render: (r) => (
            <div>
              <div className="font-medium">{r.parentProcess ? <span className="text-slate-400">↳ </span> : null}{r.name}</div>
              {r.stage && <div className="text-xs text-slate-400">{r.stage}</div>}
            </div>
          ) },
          { key: 'department', title: 'Department', render: (r) => r.department ? <Badge status="ACTIVE">{r.department.name}</Badge> : <span className="text-xs text-slate-400">Global</span> },
          { key: 'subProcesses', title: 'Sub-Processes', align: 'right', render: (r) => r._count?.subProcesses || 0 },
          { key: 'isActive', title: 'Status', render: (r) => <Badge status={r.isActive ? 'ACTIVE' : 'INACTIVE'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: '__act', title: '', width: 120, render: (r) => (
            <div className="flex gap-1 justify-end">
              <button className="btn-secondary !px-2 !py-1" aria-label={`Edit process ${r.name}`} onClick={() => { setErrors({}); setEditing({ ...empty, ...r, departmentId: r.departmentId ?? '', parentProcessId: r.parentProcessId ?? '', dependsOnProcessId: r.dependsOnProcessId ?? '' }); }}><Pencil className="w-3.5 h-3.5" /></button>
              <button className="btn-danger !px-2 !py-1" aria-label={`Deactivate process ${r.name}`} onClick={() => setDeleting(r)}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          )},
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit process' : 'New process'}
          description="A manufacturing stage/operation — optionally a Sub-Process of another"
          size="lg"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className={styles.formGrid}>
            <FormField id="process-name" label="Process Name" required error={errors.name} className="sm:col-span-2">
              <input id="process-name" className={`${styles.input} ${errors.name ? styles.inputError : ''}`} value={editing.name} onChange={(e) => setField('name', e.target.value)} aria-invalid={!!errors.name} />
            </FormField>
            <FormField id="process-code" label="Process Code" hint={editing.id ? 'Code cannot be changed' : 'Auto-generated if left blank'}>
              <input id="process-code" className={styles.input} value={editing.code || ''} onChange={(e) => setField('code', e.target.value)} disabled={!!editing.id} />
            </FormField>
            <FormField id="process-stage" label="Stage" hint="Groups processes on the workflow view (e.g. Machining)">
              <input id="process-stage" className={styles.input} value={editing.stage || ''} onChange={(e) => setField('stage', e.target.value)} />
            </FormField>
            <FormField id="process-dept" label="Department" hint={scopedDeptId ? `Locked to ${deptName(scopedDeptId) || 'your department'}` : 'Blank = Global (any department can use it)'}>
              <SearchableSelect
                id="process-dept"
                value={editing.departmentId}
                onChange={(v) => setField('departmentId', v)}
                options={deptOptions}
                allowClear={false}
                disabled={!!scopedDeptId}
              />
            </FormField>
            <FormField id="process-parent" label="Parent Process" hint="Set to make this a Sub-Process">
              <SearchableSelect
                id="process-parent"
                value={editing.parentProcessId}
                onChange={(v) => setField('parentProcessId', v)}
                options={processOptions(editing.id)}
                placeholder="— top level —"
              />
            </FormField>
            <FormField id="process-depends" label="Depends On" hint="Optional — informational only, never blocks a start">
              <SearchableSelect
                id="process-depends"
                value={editing.dependsOnProcessId}
                onChange={(v) => setField('dependsOnProcessId', v)}
                options={processOptions(editing.id)}
                placeholder="— none —"
              />
            </FormField>
            <FormField id="process-order" label="Display Order">
              <input id="process-order" type="number" className={styles.input} value={editing.displayOrder} onChange={(e) => setField('displayOrder', e.target.value)} />
            </FormField>
            <FormField id="process-description" label="Description" className="sm:col-span-2">
              <textarea id="process-description" className={styles.textarea} rows={2} value={editing.description || ''} onChange={(e) => setField('description', e.target.value)} />
            </FormField>
            <FormField id="process-std-time" label="Std Time (min)" hint="Optional — minutes per unit" error={errors.stdTimeMin}>
              <input id="process-std-time" type="number" step="0.01" className={`${styles.input} tabular-nums ${errors.stdTimeMin ? styles.inputError : ''}`} value={editing.stdTimeMin ?? ''} onChange={(e) => setField('stdTimeMin', e.target.value)} onBlur={() => blurOptionalNumber('stdTimeMin')} aria-invalid={!!errors.stdTimeMin} />
            </FormField>
            <FormField id="process-rate" label="Rate/hour" hint="Optional — machine/hour rate" error={errors.ratePerHour}>
              <input id="process-rate" type="number" step="0.01" className={`${styles.input} tabular-nums ${errors.ratePerHour ? styles.inputError : ''}`} value={editing.ratePerHour ?? ''} onChange={(e) => setField('ratePerHour', e.target.value)} onBlur={() => blurOptionalNumber('ratePerHour')} aria-invalid={!!errors.ratePerHour} />
            </FormField>
            {editing.id && (
              <FormField id="process-active" label="Status">
                <select id="process-active" className={styles.input} value={editing.isActive ? '1' : '0'} onChange={(e) => setField('isActive', e.target.value === '1')}>
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </FormField>
            )}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Deactivate process?"
        message={`${deleting?.name} will be marked inactive and no longer selectable for new tasks — past tasks keep showing it.`}
        confirmLabel="Deactivate"
        variant="destructive"
        loading={deletingBusy}
      />
    </div>
  );
}
