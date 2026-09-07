import { useEffect, useState } from 'react';
import { Search, Plus, Layers, Trash2, Pencil, Loader2 } from 'lucide-react';
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

const empty = { departmentId: '', name: '', code: '', description: '', isActive: true };

export default function DepartmentSubCategoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [data, setData] = useState({ items: [], pagination: null });
  const [departments, setDepartments] = useState([]);
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
      const { data } = await api.get('/department-subcategories', {
        params: { page, q: search, departmentId: departmentFilter || undefined },
      });
      setData(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load department roles');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, departmentFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/departments', { params: { pageSize: 200 } }).then((r) => setDepartments(r.data.items)); }, []);

  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name, subtitle: d.code || undefined }));

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
      departmentId: (v) => required(v, 'Department'),
      name: (v) => required(v, 'Name'),
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...editing, departmentId: Number(editing.departmentId) };
      if (editing.id) await api.put(`/department-subcategories/${editing.id}`, payload);
      else await api.post('/department-subcategories', payload);
      toast.success('Saved successfully');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save department role');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.delete(`/department-subcategories/${deleting.id}`);
      toast.success('Deleted successfully');
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete department role');
    } finally {
      setDeletingBusy(false);
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Department Roles"
        subtitle="Job designations within a department (e.g. Fabrication → Welding Operator, Fabrication Head)"
        action={<button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> New department role</button>}
      />

      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9 max-w-xs"
            placeholder="Search name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))}
          />
        </div>
        <div className="w-56">
          <SearchableSelect
            id="filter-department"
            value={departmentFilter}
            onChange={(v) => { setDepartmentFilter(v); setPage(1); }}
            options={departmentOptions}
            placeholder="All departments"
            allowClear
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <Layers className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} department roles
        </div>
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        filtered={!!departmentFilter}
        emptyTitle="No department roles yet"
        emptyDescription="Create designations per department — users pick one when assigned a department."
        emptyAction={{ label: 'New department role', onClick: openNew, icon: Plus }}
        columns={[
          { key: 'department', title: 'Department', render: (r) => r.department?.name || '—' },
          { key: 'name', title: 'Name' },
          { key: 'code', title: 'Code', width: 120 },
          { key: 'userCount', title: 'Users', width: 90, align: 'right', render: (r) => <span className="tabular-nums">{r.userCount ?? 0}</span> },
          { key: 'isActive', title: 'Status', render: (r) => <Badge status={r.isActive ? 'ACTIVE' : 'INACTIVE'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: '__act', title: '', width: 120, render: (r) => (
            <div className="flex gap-1 justify-end">
              <button className="btn-secondary !px-2 !py-1" aria-label={`Edit department role ${r.name}`} onClick={() => { setErrors({}); setEditing({ ...r, departmentId: r.department?.id || '' }); }}><Pencil className="w-3.5 h-3.5" /></button>
              <button className="btn-danger !px-2 !py-1" aria-label={`Delete department role ${r.name}`} onClick={() => setDeleting(r)}><Trash2 className="w-3.5 h-3.5" /></button>
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
          title={editing.id ? 'Edit department role' : 'New department role'}
          description="A designation within a department"
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
            <FormField id="subcat-department" label="Department" required error={errors.departmentId}>
              <SearchableSelect
                id="subcat-department"
                value={editing.departmentId}
                onChange={(v) => setField('departmentId', v)}
                options={departmentOptions}
                placeholder="Select department…"
                error={errors.departmentId}
              />
            </FormField>
            <FormField id="subcat-name" label="Name" required error={errors.name}>
              <input
                id="subcat-name"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'subcat-name-error' : undefined}
                value={editing.name}
                onChange={(e) => setField('name', e.target.value)}
              />
            </FormField>
            <FormField id="subcat-code" label="Code">
              <input id="subcat-code" className={styles.input} value={editing.code || ''} onChange={(e) => setField('code', e.target.value)} />
            </FormField>
            <FormField id="subcat-description" label="Description">
              <input id="subcat-description" className={styles.input} value={editing.description || ''} onChange={(e) => setField('description', e.target.value)} />
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
        title="Delete department role?"
        message={`${deleting?.name} will be permanently deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deletingBusy}
      />
    </div>
  );
}
