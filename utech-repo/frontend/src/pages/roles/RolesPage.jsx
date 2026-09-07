import { useEffect, useState } from 'react';
import { Shield, Plus, Pencil, Trash2, Loader2, Lock, Users, KeyRound } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { required, validateAll } from '../../lib/validation';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

function slugCode(name) {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export default function RolesPage() {
  const user = useAuth((s) => s.user);
  const canDelete = hasPermission(user, 'role.delete');
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [r, p] = await Promise.all([api.get('/roles'), api.get('/roles/permissions/all')]);
    setRoles(r.data);
    setPermissions(p.data);
  }
  useEffect(() => { load(); }, []);

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
      hierarchyLevel: (v) => {
        if (v === null || v === '' || v === undefined) return 'Hierarchy level is required (0 = highest rank)';
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
      const payload = { ...editing, parentRoleId: editing.parentRoleId ? Number(editing.parentRoleId) : null };
      if (editing.id) await api.put(`/roles/${editing.id}`, payload);
      else await api.post('/roles', payload);
      toast.success('Saved successfully');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  }

  function togglePerm(key) {
    const set = new Set(editing.permissions);
    if (set.has(key)) set.delete(key); else set.add(key);
    setEditing({ ...editing, permissions: [...set] });
  }

  async function remove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.delete(`/roles/${deleting.id}`);
      toast.success('Deleted');
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete role');
    } finally {
      setDeletingBusy(false);
      setDeleting(null);
    }
  }

  const parentOptions = roles
    .filter((r) => r.id !== editing?.id)
    .map((r) => ({ value: r.id, label: r.name, subtitle: r.code || undefined }));

  const inputCls = (key) => `${styles.input} ${errors[key] ? styles.inputError : ''}`;

  const blankRole = () => ({
    name: '', code: '', description: '', hierarchyLevel: null, parentRoleId: '',
    requiresDepartment: false, scopeToDepartment: false, isActive: true, permissions: [],
  });

  const openNew = () => {
    setErrors({});
    setEditing(blankRole());
  };

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        action={
          <button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> New role</button>
        }
      />

      {roles.length === 0 ? (
        <div className="card-flat">
          <EmptyState
            icon={Shield}
            title="No roles yet"
            description="Create roles to control what each user can see and do."
            action={{ label: 'New role', onClick: openNew, icon: Plus }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((r) => (
            <div key={r.id} className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                    <Shield className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-500">{r.code || '—'}{r.parentRole ? ` · reports under ${r.parentRole.name}` : ''}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {r.isSystem && <Badge status="ON_HOLD">System</Badge>}
                  {!r.isActive && <Badge status="INACTIVE">Inactive</Badge>}
                </div>
              </div>
              <div className="text-xs text-slate-500 mb-2">{r.description || '—'}</div>
              <div className="flex items-center gap-4 text-xs text-slate-500 mb-4">
                <span className="flex items-center gap-1"><Lock className="w-3 h-3" aria-hidden="true" /> {(r.permissions || []).length} permissions</span>
                <span className="flex items-center gap-1"><Users className="w-3 h-3" aria-hidden="true" /> {r.userCount} users</span>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => { setErrors({}); setEditing({ ...r, parentRoleId: r.parentRoleId || '' }); }}><Pencil className="w-3.5 h-3.5" /> Edit</button>
                {canDelete && !r.isSystem && (
                  <button className="btn-danger !px-2.5 !py-1.5 text-xs" onClick={() => setDeleting(r)}>
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit role' : 'New role'}
          description="Define the role's rank, department rules and its permission grants"
          size="xl"
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
            <FormSection icon={Shield} title="Role Details">
              <div className={styles.formGrid}>
                <FormField id="role-name" label="Name" required error={errors.name}>
                  <input
                    id="role-name"
                    className={inputCls('name')}
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? 'role-name-error' : undefined}
                    value={editing.name}
                    disabled={editing.isSystem}
                    onChange={(e) => {
                      setField('name', e.target.value);
                      if (!editing.id) setField('code', slugCode(e.target.value));
                    }}
                  />
                </FormField>
                <FormField id="role-code" label="Code" required={false} error={errors.code} hint="Uppercase identifier, e.g. DEPT_HEAD">
                  <input
                    id="role-code"
                    className={inputCls('code')}
                    value={editing.code || ''}
                    disabled={editing.isSystem}
                    onChange={(e) => setField('code', slugCode(e.target.value))}
                  />
                </FormField>
                <FormField id="role-description" label="Description" className="sm:col-span-2">
                  <input id="role-description" className={styles.input} value={editing.description || ''} onChange={(e) => setField('description', e.target.value)} />
                </FormField>
                <FormField id="role-level" label="Hierarchy level" required error={errors.hierarchyLevel} hint="0 = highest rank">
                  <input
                    id="role-level"
                    type="number"
                    className={inputCls('hierarchyLevel')}
                    aria-invalid={!!errors.hierarchyLevel}
                    aria-describedby={errors.hierarchyLevel ? 'role-level-error' : undefined}
                    placeholder="0 = highest rank"
                    value={editing.hierarchyLevel ?? ''}
                    onChange={(e) => setField('hierarchyLevel', e.target.value === '' ? null : Number(e.target.value))}
                  />
                </FormField>
                <FormField id="role-parent" label="Parent role" hint="Who this role reports under">
                  <SearchableSelect
                    id="role-parent"
                    value={editing.parentRoleId || ''}
                    onChange={(v) => setField('parentRoleId', v)}
                    options={parentOptions}
                    placeholder="— none —"
                  />
                </FormField>
                <div className="sm:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={editing.isActive !== false}
                      onChange={(e) => setField('isActive', e.target.checked)}
                    />
                    Active
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={!!editing.requiresDepartment}
                      onChange={(e) => setField('requiresDepartment', e.target.checked)}
                    />
                    Requires department
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={!!editing.scopeToDepartment}
                      onChange={(e) => setField('scopeToDepartment', e.target.checked)}
                    />
                    Scope to own department
                  </label>
                </div>
              </div>
            </FormSection>

            <FormSection
              icon={KeyRound}
              title="Permissions"
              description={`${editing.permissions.length} granted — click a chip to toggle`}
            >
              <div className="space-y-4">
                {Object.entries(permissions).map(([mod, perms]) => {
                  const granted = perms.filter((p) => editing.permissions.includes(p.key)).length;
                  return (
                    <div key={mod} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                      <div className="font-semibold text-sm mb-3 capitalize text-slate-800 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-brand-500" aria-hidden="true" /> {mod}
                        <span className="ml-auto text-xs font-normal text-slate-400 tabular-nums">{granted}/{perms.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {perms.map((p) => (
                          <label key={p.key} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${editing.permissions.includes(p.key) ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                            <input
                              type="checkbox"
                              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                              checked={editing.permissions.includes(p.key)}
                              onChange={() => togglePerm(p.key)}
                            />
                            {p.action}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </FormSection>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete role?"
        message={`${deleting?.name} will be permanently deleted. Users holding this role will lose its permissions.`}
        confirmLabel="Delete role"
        variant="destructive"
        loading={deletingBusy}
      />
    </div>
  );
}
