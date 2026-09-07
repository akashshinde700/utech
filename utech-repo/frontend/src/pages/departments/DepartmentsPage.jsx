import { useEffect, useState } from 'react';
import { Search, Plus, Building2, Trash2, Pencil, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { required, validateAll } from '../../lib/validation';
import toast from 'react-hot-toast';

const empty = { name: '', code: '', description: '', departmentHeadUserId: '', isActive: true };

export default function DepartmentsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ items: [], pagination: null });
  const [candidateHeads, setCandidateHeads] = useState([]);
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
      const { data } = await api.get('/departments', { params: { page, q: search } });
      setData(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load departments');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get('/users', { params: { pageSize: 200 } }).then((r) => {
      const deptHeads = r.data.items.filter((u) => u.role?.name === 'Department Head');
      setCandidateHeads(deptHeads.length ? deptHeads : r.data.items);
    });
  }, []);

  const headOptions = candidateHeads.map((u) => ({ value: u.id, label: u.name, subtitle: u.role?.name || undefined }));

  function openNew() {
    setErrors({});
    setEditing({ ...empty });
  }

  function setField(key, value) {
    setEditing((e) => ({ ...e, [key]: value }));
    setErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  async function save() {
    const { errors: nextErrors, ok } = validateAll(editing, {
      name: (v) => required(v, 'Name'),
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...editing, departmentHeadUserId: editing.departmentHeadUserId ? Number(editing.departmentHeadUserId) : null };
      if (editing.id) await api.put(`/departments/${editing.id}`, payload);
      else await api.post('/departments', payload);
      toast.success('Saved successfully');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.delete(`/departments/${deleting.id}`);
      toast.success('Deactivated successfully');
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to deactivate department');
    } finally {
      setDeletingBusy(false);
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle="Manage shop-floor departments (Fabrication, Machining, Quality, ...)"
        action={<button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> New department</button>}
      />

      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9 max-w-xs"
            placeholder="Search name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))}
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <Building2 className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} departments
        </div>
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No departments yet"
        emptyDescription="Create your first shop-floor department to organize users and jobcards."
        emptyAction={{ label: 'New department', onClick: openNew, icon: Plus }}
        columns={[
          { key: 'name', title: 'Name' },
          { key: 'code', title: 'Code', width: 120 },
          { key: 'departmentHead', title: 'Department Head', render: (r) => r.departmentHead?.name || '—' },
          { key: 'operatorCount', title: 'Total Operators', width: 130, align: 'right', render: (r) => <span className="tabular-nums">{r.operatorCount ?? 0}</span> },
          { key: 'isActive', title: 'Status', render: (r) => <Badge status={r.isActive ? 'ACTIVE' : 'INACTIVE'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: '__act', title: '', width: 120, render: (r) => (
            <div className="flex gap-1 justify-end">
              <button className="btn-secondary !px-2 !py-1" aria-label={`Edit department ${r.name}`} onClick={() => { setErrors({}); setEditing({ ...r, departmentHeadUserId: r.departmentHead?.id || '' }); }}><Pencil className="w-3.5 h-3.5" /></button>
              <button className="btn-danger !px-2 !py-1" aria-label={`Deactivate department ${r.name}`} onClick={() => setDeleting(r)}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ) },
        ]}
        rows={data.items}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit department' : 'New department'}
          description="Departments group users, jobcards and production"
          size="md"
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
          <div className="space-y-4">
            <FormField id="dept-name" label="Name" required error={errors.name}>
              <input
                id="dept-name"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'dept-name-error' : undefined}
                value={editing.name}
                onChange={(e) => setField('name', e.target.value)}
              />
            </FormField>
            <FormField id="dept-code" label="Code" hint="Short identifier, auto-suggested on create">
              <input id="dept-code" className={styles.input} value={editing.code} onChange={(e) => setField('code', e.target.value.toUpperCase())} />
            </FormField>
            <FormField id="dept-head" label="Department Head">
              <SearchableSelect
                id="dept-head"
                value={editing.departmentHeadUserId}
                onChange={(v) => setField('departmentHeadUserId', v)}
                options={headOptions}
                placeholder="Select department head…"
              />
            </FormField>
            <FormField id="dept-description" label="Description">
              <input id="dept-description" className={styles.input} value={editing.description || ''} onChange={(e) => setField('description', e.target.value)} />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={editing.isActive !== false}
                onChange={(e) => setField('isActive', e.target.checked)}
              />
              Active
            </label>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Deactivate department?"
        message={`${deleting?.name} will be marked inactive. Users and jobcards referencing it are kept.`}
        confirmLabel="Deactivate"
        variant="destructive"
        loading={deletingBusy}
      />
    </div>
  );
}
