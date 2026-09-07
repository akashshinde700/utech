import { useEffect, useState } from 'react';
import { Search, PlusCircle, UserPlus, Trash2, Pencil, Loader2, User, ShieldCheck } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { required, email, phone10, passwordStrong, validateAll } from '../../lib/validation';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

const empty = { name: '', email: '', password: '', phone: '', roleId: '', departmentId: '', departmentSubCategoryId: '', reportingToId: '', isActive: true };
const emptyRole = { name: '', code: '', hierarchyLevel: '', parentRoleId: '', description: '', requiresDepartment: false, scopeToDepartment: false, isActive: true };
const emptyDept = { name: '', code: '', description: '', departmentHeadUserId: '', isActive: true };
const emptySubCat = { departmentId: '', name: '', code: '', description: '', isActive: true };

function slugCode(name) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export default function UsersPage() {
  const user = useAuth((s) => s.user);
  const canDelete = hasPermission(user, 'user.delete');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [subCategoryFilter, setSubCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [data, setData] = useState({ items: [], pagination: null });
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [allSubCategories, setAllSubCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [reportingCandidates, setReportingCandidates] = useState([]);
  const [candidateHeads, setCandidateHeads] = useState([]);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [roleQuickAdd, setRoleQuickAdd] = useState(null);
  const [deptQuickAdd, setDeptQuickAdd] = useState(null);
  const [subCatQuickAdd, setSubCatQuickAdd] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function loadRoles() {
    const r = await api.get('/roles');
    setRoles(r.data);
    return r.data;
  }
  async function loadDepartments() {
    const r = await api.get('/departments', { params: { pageSize: 200 } });
    setDepartments(r.data.items);
    return r.data.items;
  }
  async function loadSubCategoriesFor(departmentId) {
    if (!departmentId) { setSubCategories([]); return []; }
    const r = await api.get('/department-subcategories', { params: { departmentId, isActive: 'true', pageSize: 200 } });
    setSubCategories(r.data.items);
    return r.data.items;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/users', {
        params: {
          page, q: search,
          roleId: roleFilter || undefined,
          departmentId: departmentFilter || undefined,
          departmentSubCategoryId: subCategoryFilter || undefined,
          isActive: statusFilter || undefined,
        },
      });
      setData(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, roleFilter, departmentFilter, subCategoryFilter, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadRoles(); loadDepartments();
    api.get('/department-subcategories', { params: { pageSize: 200 } }).then((r) => setAllSubCategories(r.data.items));
    api.get('/users', { params: { pageSize: 200 } }).then((r) => {
      const deptHeads = r.data.items.filter((u) => u.role?.name === 'Department Head');
      setCandidateHeads(deptHeads.length ? deptHeads : r.data.items);
    });
  }, []);

  const selectedRole = roles.find((r) => String(r.id) === String(editing?.roleId));
  const showDepartment = !!selectedRole?.requiresDepartment;

  useEffect(() => {
    if (!editing?.roleId) { setReportingCandidates([]); return; }
    api.get('/users/reporting-candidates', { params: { roleId: editing.roleId } }).then((r) => setReportingCandidates(r.data));
  }, [editing?.roleId]);

  useEffect(() => {
    loadSubCategoriesFor(editing?.departmentId || null);
  }, [editing?.departmentId]);

  // option lists for the searchable selects
  const roleFilterOptions = roles.map((r) => ({ value: r.id, label: r.name, subtitle: r.code || undefined }));
  const departmentFilterOptions = departments.map((d) => ({ value: d.id, label: d.name, subtitle: d.code || undefined }));
  const subCategoryFilterOptions = allSubCategories.map((sc) => ({ value: sc.id, label: sc.name, subtitle: sc.department?.name || undefined }));
  const roleOptions = roles.filter((r) => r.isActive !== false).map((r) => ({ value: r.id, label: r.name, subtitle: r.code || undefined }));
  const departmentOptions = departments.map((d) => ({ value: d.id, label: d.name }));
  const subCategoryOptions = subCategories.map((sc) => ({ value: sc.id, label: sc.name }));
  const reportingOptions = reportingCandidates.map((u) => ({ value: u.id, label: u.name, subtitle: u.role?.name || undefined }));
  const headOptions = candidateHeads.map((u) => ({ value: u.id, label: u.name, subtitle: u.role?.name || undefined }));

  function openUserModal(row) {
    setErrors({});
    setEditing(row);
  }

  // generic field setter for whichever modal object is being edited; clears
  // that field's validation error as the user fixes it
  function setField(setter) {
    return (key, value, extraPatch) => {
      setter((prev) => ({ ...prev, ...extraPatch, [key]: value }));
      setErrors((errs) => {
        if (!(key in errs)) return errs;
        const next = { ...errs };
        delete next[key];
        return next;
      });
    };
  }
  const setUserField = setField(setEditing);
  const setRoleField = setField(setRoleQuickAdd);
  const setDeptField = setField(setDeptQuickAdd);
  const setSubCatField = setField(setSubCatQuickAdd);

  async function save() {
    const { errors: nextErrors, ok } = validateAll(editing, {
      name: (v) => required(v, 'Name'),
      email: (v) => (editing.id ? email(v) : required(v, 'Email') || email(v)),
      phone: (v) => phone10(v),
      password: (v) => (editing.id ? passwordStrong(v) : required(v, 'Password') || passwordStrong(v)),
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...editing };
      if (payload.roleId === '' || payload.roleId === null) delete payload.roleId;
      else payload.roleId = Number(payload.roleId);
      if (payload.departmentId === '' || payload.departmentId === null) payload.departmentId = null;
      else payload.departmentId = Number(payload.departmentId);
      if (payload.departmentSubCategoryId === '' || payload.departmentSubCategoryId === null) payload.departmentSubCategoryId = null;
      else payload.departmentSubCategoryId = Number(payload.departmentSubCategoryId);
      if (payload.reportingToId === '' || payload.reportingToId === null) payload.reportingToId = null;
      else payload.reportingToId = Number(payload.reportingToId);
      if (editing.id) {
        const { id, ...rest } = payload;
        if (!rest.password) delete rest.password;
        await api.put(`/users/${id}`, rest);
      } else {
        await api.post('/users', payload);
      }
      toast.success('Saved successfully');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      const { data } = await api.delete(`/users/${deleting.id}`);
      toast.success(data.deleted ? 'User permanently deleted' : 'User deactivated');
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete user');
    } finally {
      setDeletingBusy(false);
      setDeleting(null);
    }
  }

  async function saveRoleQuickAdd() {
    const { errors: nextErrors, ok } = validateAll(roleQuickAdd, {
      name: (v) => required(v, 'Role name'),
      code: (v) => required(v, 'Role code'),
      hierarchyLevel: (v) => {
        if (v === '' || v == null) return 'Hierarchy level is required (0 = highest rank)';
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return 'Enter a valid level (0 = highest rank)';
        return null;
      },
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...roleQuickAdd,
        hierarchyLevel: roleQuickAdd.hierarchyLevel === '' ? null : Number(roleQuickAdd.hierarchyLevel),
        parentRoleId: roleQuickAdd.parentRoleId ? Number(roleQuickAdd.parentRoleId) : null,
      };
      const { data: newRole } = await api.post('/roles', payload);
      await loadRoles();
      toast.success('Role created');
      setRoleQuickAdd(null);
      setEditing((e) => ({ ...e, roleId: newRole.id, departmentId: '', reportingToId: '' }));
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to create role');
    } finally {
      setSaving(false);
    }
  }

  async function saveDeptQuickAdd() {
    const { errors: nextErrors, ok } = validateAll(deptQuickAdd, {
      name: (v) => required(v, 'Name'),
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...deptQuickAdd, departmentHeadUserId: deptQuickAdd.departmentHeadUserId ? Number(deptQuickAdd.departmentHeadUserId) : null };
      const { data: newDept } = await api.post('/departments', payload);
      await loadDepartments();
      toast.success('Department created');
      setDeptQuickAdd(null);
      setEditing((e) => ({ ...e, departmentId: newDept.id, departmentSubCategoryId: '' }));
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to create department');
    } finally {
      setSaving(false);
    }
  }

  async function saveSubCatQuickAdd() {
    const { errors: nextErrors, ok } = validateAll(subCatQuickAdd, {
      name: (v) => required(v, 'Role / designation name'),
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...subCatQuickAdd, departmentId: Number(subCatQuickAdd.departmentId) };
      const { data: newSubCat } = await api.post('/department-subcategories', payload);
      await loadSubCategoriesFor(payload.departmentId);
      api.get('/department-subcategories', { params: { pageSize: 200 } }).then((r) => setAllSubCategories(r.data.items));
      toast.success('Department role created');
      setSubCatQuickAdd(null);
      setEditing((e) => ({ ...e, departmentSubCategoryId: newSubCat.id }));
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to create department role');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = (key) => `${styles.input} ${errors[key] ? styles.inputError : ''}`;

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage system users"
        action={
          <button className="btn-primary" onClick={() => openUserModal({ ...empty })}><UserPlus className="w-4 h-4" /> New user</button>
        }
      />

      <div className="flex flex-wrap gap-3 mb-4 bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm items-center">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            className="input pl-9 max-w-xs"
            placeholder="Search name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (page === 1 ? load() : setPage(1))}
          />
        </div>
        <div className="w-44">
          <SearchableSelect
            id="filter-role"
            value={roleFilter}
            onChange={(v) => { setRoleFilter(v); setPage(1); }}
            options={roleFilterOptions}
            placeholder="All roles"
            allowClear
          />
        </div>
        <div className="w-44">
          <SearchableSelect
            id="filter-department"
            value={departmentFilter}
            onChange={(v) => { setDepartmentFilter(v); setPage(1); }}
            options={departmentFilterOptions}
            placeholder="All departments"
            allowClear
          />
        </div>
        <div className="w-52">
          <SearchableSelect
            id="filter-subcategory"
            value={subCategoryFilter}
            onChange={(v) => { setSubCategoryFilter(v); setPage(1); }}
            options={subCategoryFilterOptions}
            placeholder="All department roles"
            allowClear
          />
        </div>
        <select className="input max-w-[8rem]" aria-label="Filter by status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
          <UserPlus className="w-3.5 h-3.5" />
          {data.pagination?.total ?? 0} users
        </div>
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        filtered={!!(roleFilter || departmentFilter || subCategoryFilter || statusFilter)}
        emptyTitle="No users found"
        emptyDescription="Invite your first team member and assign them a role."
        emptyAction={{ label: 'New user', onClick: () => openUserModal({ ...empty }), icon: UserPlus }}
        columns={[
          { key: 'name', title: 'Name' },
          { key: 'email', title: 'Email' },
          { key: 'role', title: 'Role', render: (r) => r.role?.name || '—' },
          { key: 'department', title: 'Department', render: (r) => r.department?.name || '—' },
          { key: 'departmentSubCategory', title: 'Department Role', render: (r) => r.departmentSubCategory?.name || '—' },
          { key: 'reportingTo', title: 'Reporting To', render: (r) => r.reportingTo?.name || '—' },
          { key: 'isActive', title: 'Status', render: (r) =>
            <Badge status={r.isActive ? 'ACTIVE' : 'INACTIVE'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: '__act', title: '', width: 120, render: (r) => (
            <div className="flex gap-1 justify-end">
              <button className="btn-secondary !px-2 !py-1" aria-label={`Edit user ${r.name || r.email}`} onClick={() => openUserModal({
                ...r, password: '', roleId: r.role?.id || '', departmentId: r.department?.id || '',
                departmentSubCategoryId: r.departmentSubCategory?.id || '', reportingToId: r.reportingTo?.id || '',
              })}><Pencil className="w-3.5 h-3.5" /></button>
              {canDelete && <button className="btn-danger !px-2 !py-1" aria-label={`Delete user ${r.name || r.email}`} onClick={() => setDeleting(r)}><Trash2 className="w-3.5 h-3.5" /></button>}
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
          title={editing.id ? 'Edit user' : 'New user'}
          description={editing.id ? editing.email : 'Team member who can log in and work the floor'}
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
          <div className="space-y-5">
            <FormSection icon={User} title="Basic Details">
              <div className={styles.formGrid}>
                <FormField id="user-name" label="Name" required error={errors.name}>
                  <input id="user-name" className={inputCls('name')} aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? 'user-name-error' : undefined}
                    value={editing.name} onChange={(e) => setUserField('name', e.target.value)} />
                </FormField>
                <FormField id="user-email" label="Email" required={!editing.id} error={errors.email} hint={editing.id ? 'Email cannot be changed' : 'Used to log in'}>
                  <input id="user-email" type="email" className={inputCls('email')} aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? 'user-email-error' : undefined}
                    value={editing.email} disabled={!!editing.id}
                    onChange={(e) => setUserField('email', e.target.value)} />
                </FormField>
                <FormField id="user-phone" label="Phone" error={errors.phone} hint="10-digit mobile">
                  <input id="user-phone" type="tel" className={inputCls('phone')} aria-invalid={!!errors.phone}
                    aria-describedby={errors.phone ? 'user-phone-error' : undefined}
                    value={editing.phone || ''} onChange={(e) => setUserField('phone', e.target.value)} />
                </FormField>
                <FormField id="user-password" label={editing.id ? 'New password (leave blank to keep)' : 'Password'} required={!editing.id} error={errors.password}
                  hint={editing.id ? undefined : 'Min 8 characters with at least one letter and one number'}>
                  <input id="user-password" type="password" className={inputCls('password')} aria-invalid={!!errors.password}
                    aria-describedby={errors.password ? 'user-password-error' : undefined}
                    value={editing.password || ''} autoComplete="new-password"
                    onChange={(e) => setUserField('password', e.target.value)} />
                </FormField>
              </div>
            </FormSection>

            <FormSection
              icon={ShieldCheck}
              title="Role & Reporting"
              description="What this user can do and who they report to"
              actions={
                <>
                  <button type="button" className={`${styles.ghostBtn} !h-8 !px-2.5 text-xs`} onClick={() => { setErrors({}); setRoleQuickAdd({ ...emptyRole }); }}>
                    <PlusCircle className="h-3.5 w-3.5" /> Add role
                  </button>
                  {showDepartment && (
                    <button type="button" className={`${styles.ghostBtn} !h-8 !px-2.5 text-xs`} onClick={() => { setErrors({}); setDeptQuickAdd({ ...emptyDept }); }}>
                      <PlusCircle className="h-3.5 w-3.5" /> Add department
                    </button>
                  )}
                  {showDepartment && editing.departmentId && (
                    <button type="button" className={`${styles.ghostBtn} !h-8 !px-2.5 text-xs`} onClick={() => { setErrors({}); setSubCatQuickAdd({ ...emptySubCat, departmentId: editing.departmentId }); }}>
                      <PlusCircle className="h-3.5 w-3.5" /> Add department role
                    </button>
                  )}
                </>
              }
            >
              <div className={styles.formGrid}>
                <FormField id="user-role" label="Role" className="sm:col-span-2" hint="Roles with “Requires department” reveal the department fields">
                  <SearchableSelect
                    id="user-role"
                    value={editing.roleId || ''}
                    onChange={(v) => setUserField('roleId', v, { departmentId: '', departmentSubCategoryId: '', reportingToId: '' })}
                    options={roleOptions}
                    placeholder="— none —"
                  />
                </FormField>
                {showDepartment && (
                  <FormField id="user-department" label="Department" className="sm:col-span-2">
                    <SearchableSelect
                      id="user-department"
                      value={editing.departmentId || ''}
                      onChange={(v) => setUserField('departmentId', v, { departmentSubCategoryId: '' })}
                      options={departmentOptions}
                      placeholder="— select department —"
                    />
                  </FormField>
                )}
                {showDepartment && editing.departmentId && (
                  <FormField id="user-subcategory" label="Department Role" hint="Designation within the department" className="sm:col-span-2">
                    {subCategories.length === 0 ? (
                      <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                        No department roles defined for this department yet — use “Add department role” above.
                      </div>
                    ) : (
                      <SearchableSelect
                        id="user-subcategory"
                        value={editing.departmentSubCategoryId || ''}
                        onChange={(v) => setUserField('departmentSubCategoryId', v)}
                        options={subCategoryOptions}
                        placeholder="— select department role —"
                      />
                    )}
                  </FormField>
                )}
                {editing.roleId && (
                  <FormField id="user-reporting" label="Reporting To" className="sm:col-span-2">
                    <SearchableSelect
                      id="user-reporting"
                      value={editing.reportingToId || ''}
                      onChange={(v) => setUserField('reportingToId', v)}
                      options={reportingOptions}
                      placeholder="— none —"
                    />
                  </FormField>
                )}
              </div>
            </FormSection>
          </div>
        </Modal>
      )}

      {roleQuickAdd && (
        <Modal
          open
          onClose={() => setRoleQuickAdd(null)}
          title="Add new role"
          description="Quick-create a role, then continue editing the user"
          size="md"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setRoleQuickAdd(null)} disabled={saving}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={saveRoleQuickAdd} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? 'Saving…' : 'Create role'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField id="qr-name" label="Role name" required error={errors.name}>
              <input id="qr-name" className={inputCls('name')} aria-invalid={!!errors.name}
                value={roleQuickAdd.name}
                onChange={(e) => setRoleField('name', e.target.value, { code: slugCode(e.target.value) })} />
            </FormField>
            <FormField id="qr-code" label="Role code" required error={errors.code}>
              <input id="qr-code" className={inputCls('code')} aria-invalid={!!errors.code}
                value={roleQuickAdd.code}
                onChange={(e) => setRoleField('code', slugCode(e.target.value))} />
            </FormField>
            <FormField id="qr-level" label="Hierarchy level" required error={errors.hierarchyLevel} hint="0 = highest rank">
              <input id="qr-level" type="number" className={inputCls('hierarchyLevel')} aria-invalid={!!errors.hierarchyLevel}
                placeholder="0 = highest rank" value={roleQuickAdd.hierarchyLevel}
                onChange={(e) => setRoleField('hierarchyLevel', e.target.value)} />
            </FormField>
            <FormField id="qr-parent" label="Parent role">
              <SearchableSelect
                id="qr-parent"
                value={roleQuickAdd.parentRoleId}
                onChange={(v) => setRoleField('parentRoleId', v)}
                options={roles.map((r) => ({ value: r.id, label: r.name }))}
                placeholder="— none —"
              />
            </FormField>
            <FormField id="qr-description" label="Description">
              <input id="qr-description" className={styles.input} value={roleQuickAdd.description} onChange={(e) => setRoleField('description', e.target.value)} />
            </FormField>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={roleQuickAdd.requiresDepartment}
                  onChange={(e) => setRoleField('requiresDepartment', e.target.checked)} />
                Requires department
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={roleQuickAdd.isActive}
                  onChange={(e) => setRoleField('isActive', e.target.checked)} />
                Active
              </label>
            </div>
          </div>
        </Modal>
      )}

      {deptQuickAdd && (
        <Modal
          open
          onClose={() => setDeptQuickAdd(null)}
          title="Add department"
          description="Quick-create a department, then continue editing the user"
          size="md"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setDeptQuickAdd(null)} disabled={saving}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={saveDeptQuickAdd} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? 'Saving…' : 'Create department'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField id="qd-name" label="Name" required error={errors.name}>
              <input id="qd-name" className={inputCls('name')} aria-invalid={!!errors.name}
                value={deptQuickAdd.name}
                onChange={(e) => setDeptField('name', e.target.value, { code: slugCode(e.target.value) })} />
            </FormField>
            <FormField id="qd-code" label="Code">
              <input id="qd-code" className={styles.input} value={deptQuickAdd.code}
                onChange={(e) => setDeptField('code', slugCode(e.target.value))} />
            </FormField>
            <FormField id="qd-head" label="Department Head">
              <SearchableSelect
                id="qd-head"
                value={deptQuickAdd.departmentHeadUserId}
                onChange={(v) => setDeptField('departmentHeadUserId', v)}
                options={headOptions}
                placeholder="— none —"
              />
            </FormField>
            <FormField id="qd-description" label="Description">
              <input id="qd-description" className={styles.input} value={deptQuickAdd.description} onChange={(e) => setDeptField('description', e.target.value)} />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={deptQuickAdd.isActive}
                onChange={(e) => setDeptField('isActive', e.target.checked)} />
              Active
            </label>
          </div>
        </Modal>
      )}

      {subCatQuickAdd && (
        <Modal
          open
          onClose={() => setSubCatQuickAdd(null)}
          title="Add Department Role"
          description="A designation within the selected department"
          size="md"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setSubCatQuickAdd(null)} disabled={saving}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={saveSubCatQuickAdd} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? 'Saving…' : 'Create department role'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField id="qs-department" label="Department">
              <SearchableSelect
                id="qs-department"
                value={subCatQuickAdd.departmentId}
                onChange={() => {}}
                options={departments.filter((d) => String(d.id) === String(subCatQuickAdd.departmentId)).map((d) => ({ value: d.id, label: d.name }))}
                disabled
                allowClear={false}
              />
            </FormField>
            <FormField id="qs-name" label="Role / Designation Name" required error={errors.name}>
              <input id="qs-name" className={inputCls('name')} aria-invalid={!!errors.name}
                value={subCatQuickAdd.name}
                onChange={(e) => setSubCatField('name', e.target.value, { code: slugCode(e.target.value) })} />
            </FormField>
            <FormField id="qs-code" label="Code">
              <input id="qs-code" className={styles.input} value={subCatQuickAdd.code}
                onChange={(e) => setSubCatField('code', slugCode(e.target.value))} />
            </FormField>
            <FormField id="qs-description" label="Description">
              <input id="qs-description" className={styles.input} value={subCatQuickAdd.description} onChange={(e) => setSubCatField('description', e.target.value)} />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={subCatQuickAdd.isActive}
                onChange={(e) => setSubCatField('isActive', e.target.checked)} />
              Active
            </label>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={deleting?.isActive ? 'Deactivate user?' : 'Delete user?'}
        message={
          deleting?.isActive
            ? `${deleting?.name || deleting?.email} will be deactivated. Delete again after that to remove the account for good.`
            : `${deleting?.name || deleting?.email} will be permanently deleted. This cannot be undone.`
        }
        confirmLabel={deleting?.isActive ? 'Deactivate' : 'Delete permanently'}
        variant="destructive"
        loading={deletingBusy}
      />
    </div>
  );
}
