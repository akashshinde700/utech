import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
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
import { required, positiveNumber, validateAll } from '../../lib/validation';
import { inr, date } from '../../lib/format';
import toast from 'react-hot-toast';

const empty = { code: '', name: '', partyId: '', budget: '', startDate: '', endDate: '', status: 'PLANNED' };
const STATUSES = ['PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
  const [parties, setParties] = useState([]);
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
      const r = await api.get('/projects', { params: { page } });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/parties', { params: { pageSize: 100 } }).then((r) => setParties(r.data.items)); }, []);

  const partyOptions = parties.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));

  function openNew() {
    setErrors({});
    setEditing({ ...empty });
  }

  function openEdit(r) {
    setErrors({});
    setEditing({
      ...r, partyId: r.partyId || '', budget: r.budget || '',
      startDate: r.startDate ? r.startDate.slice(0, 10) : '',
      endDate: r.endDate ? r.endDate.slice(0, 10) : '',
    });
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
      name: (v) => required(v, 'Project name'),
      budget: (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return null;
        return positiveNumber(s, 'Budget');
      },
      endDate: (v, all) => {
        if (v && all.startDate && v < all.startDate) return 'End date cannot be before start date';
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
      const payload = { ...editing };
      if (!payload.code) delete payload.code;
      payload.partyId = payload.partyId ? Number(payload.partyId) : null;
      payload.budget = payload.budget ? Number(payload.budget) : null;
      payload.startDate = payload.startDate || null;
      payload.endDate = payload.endDate || null;
      if (editing.id) {
        const { id, ...rest } = payload;
        await api.put(`/projects/${id}`, rest);
      } else {
        await api.post('/projects', payload);
      }
      toast.success('Saved successfully');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save project');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.delete(`/projects/${deleting.id}`);
      toast.success('Deleted successfully');
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete project');
    } finally {
      setDeletingBusy(false);
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader title="Projects" subtitle="Project-based manufacturing"
        action={<button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> New project</button>} />

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        onRowClick={(r) => navigate(`/projects/${r.id}`)}
        rows={data.items}
        emptyTitle="No projects yet"
        emptyDescription="Group jobcards and budgets under a project for contract manufacturing."
        emptyAction={{ label: 'New project', onClick: openNew, icon: Plus }}
        columns={[
          { key: 'code', title: 'Code', width: 100 },
          { key: 'name', title: 'Name' },
          { key: 'budget', title: 'Budget', align: 'right', render: (r) => <span className="tabular-nums font-mono">{r.budget ? inr(r.budget) : '—'}</span> },
          { key: 'startDate', title: 'Start', render: (r) => date(r.startDate) },
          { key: 'endDate', title: 'End', render: (r) => date(r.endDate) },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status}>{r.status}</Badge> },
          { key: '__act', title: '', width: 100, render: (r) => (
            <div className="flex gap-1 justify-end">
              <button className="btn-secondary !px-2 !py-1" aria-label={`Edit project ${r.name}`} onClick={(e) => {
                e.stopPropagation();
                openEdit(r);
              }}><Pencil className="w-3.5 h-3.5" /></button>
              <button className="btn-danger !px-2 !py-1" aria-label={`Delete project ${r.name}`} onClick={(e) => { e.stopPropagation(); setDeleting(r); }}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ) },
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit project' : 'New project'}
          description="A customer engagement that groups production work"
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
            <FormField id="project-code" label="Code" hint="Auto-generated if left blank">
              <input id="project-code" className={styles.input} value={editing.code} onChange={(e) => setField('code', e.target.value)} />
            </FormField>
            <FormField id="project-status" label="Status">
              <select id="project-status" className={styles.input} value={editing.status} onChange={(e) => setField('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </FormField>
            <FormField id="project-name" label="Name" required error={errors.name} className="sm:col-span-2">
              <input
                id="project-name"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'project-name-error' : undefined}
                value={editing.name}
                onChange={(e) => setField('name', e.target.value)}
              />
            </FormField>
            <FormField id="project-party" label="Customer" className="sm:col-span-2">
              <SearchableSelect
                id="project-party"
                value={editing.partyId}
                onChange={(v) => setField('partyId', v)}
                options={partyOptions}
                placeholder="— none —"
              />
            </FormField>
            <FormField id="project-budget" label="Budget" error={errors.budget}>
              <input
                id="project-budget"
                type="number"
                step="0.01"
                className={`${styles.input} tabular-nums ${errors.budget ? styles.inputError : ''}`}
                aria-invalid={!!errors.budget}
                value={editing.budget}
                onChange={(e) => setField('budget', e.target.value)}
              />
            </FormField>
            <FormField id="project-start" label="Start">
              <input id="project-start" type="date" className={styles.input} value={editing.startDate} onChange={(e) => setField('startDate', e.target.value)} />
            </FormField>
            <FormField id="project-end" label="End" error={errors.endDate}>
              <input
                id="project-end"
                type="date"
                className={`${styles.input} ${errors.endDate ? styles.inputError : ''}`}
                aria-invalid={!!errors.endDate}
                value={editing.endDate}
                onChange={(e) => setField('endDate', e.target.value)}
              />
            </FormField>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete project?"
        message={`${deleting?.name} will be permanently deleted along with its tasks.`}
        confirmLabel="Delete project"
        variant="destructive"
        loading={deletingBusy}
      />
    </div>
  );
}
