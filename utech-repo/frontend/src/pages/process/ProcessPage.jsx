import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FormField from '../../components/ui/FormField';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, validateAll } from '../../lib/validation';
import toast from 'react-hot-toast';

const empty = { code: '', name: '', description: '', stdTimeMin: '', ratePerHour: '', isActive: true };

export default function ProcessPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
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
      const r = await api.get('/processes', { params: { page } });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load processes');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // optional numeric fields: empty stays null in the payload, filled values
  // must be positive numbers
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
      code: (v) => required(v, 'Code'),
      name: (v) => required(v, 'Name'),
      stdTimeMin: (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return null;
        return positiveNumber(s, 'Std time');
      },
      ratePerHour: (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return null;
        return positiveNumber(s, 'Rate per hour');
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
      ['stdTimeMin', 'ratePerHour'].forEach((k) => {
        payload[k] = payload[k] === '' || payload[k] == null ? null : Number(payload[k]);
      });
      if (editing.id) await api.put(`/processes/${editing.id}`, payload);
      else await api.post('/processes', payload);
      toast.success('Saved');
      setEditing(null);
      load();
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

  return (
    <div>
      <PageHeader title="Process Master" subtitle="Manufacturing operations master"
        action={<button className="btn-primary" onClick={openNew}><Plus className="w-4 h-4" /> New process</button>} />

      <DataTable
        rows={data.items}
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No processes yet"
        emptyDescription="Define manufacturing operations (e.g. Cutting, Welding, Assembly) to sequence jobcards."
        emptyAction={{ label: 'New process', onClick: openNew, icon: Plus }}
        columns={[
          { key: 'code', title: 'Code', width: 100 },
          { key: 'name', title: 'Name' },
          { key: 'description', title: 'Description' },
          { key: 'stdTimeMin', title: 'Std Time (min)', align: 'right', render: (r) => <span className="tabular-nums">{r.stdTimeMin ? Number(r.stdTimeMin).toFixed(2) : '—'}</span> },
          { key: 'ratePerHour', title: 'Rate/hr', align: 'right', render: (r) => <span className="tabular-nums">{r.ratePerHour ? Number(r.ratePerHour).toFixed(2) : '—'}</span> },
          { key: '__act', title: '', width: 120, render: (r) => (
            <div className="flex gap-1 justify-end">
              <button className="btn-secondary !px-2 !py-1" aria-label={`Edit process ${r.name}`} onClick={() => { setErrors({}); setEditing({ ...r }); }}><Pencil className="w-3.5 h-3.5" /></button>
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
          description="A manufacturing operation with its standard time and rate"
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
          <div className={styles.formGrid}>
            <FormField id="process-code" label="Code" required error={errors.code} hint={editing.id ? 'Code cannot be changed' : undefined}>
              <input
                id="process-code"
                className={`${styles.input} ${errors.code ? styles.inputError : ''}`}
                aria-invalid={!!errors.code}
                aria-describedby={errors.code ? 'process-code-error' : undefined}
                value={editing.code}
                onChange={(e) => setField('code', e.target.value)}
                disabled={!!editing.id}
              />
            </FormField>
            <FormField id="process-name" label="Name" required error={errors.name}>
              <input
                id="process-name"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'process-name-error' : undefined}
                value={editing.name}
                onChange={(e) => setField('name', e.target.value)}
              />
            </FormField>
            <FormField id="process-description" label="Description" className="sm:col-span-2">
              <textarea
                id="process-description"
                className={styles.textarea}
                rows={2}
                value={editing.description || ''}
                onChange={(e) => setField('description', e.target.value)}
              />
            </FormField>
            <FormField id="process-std-time" label="Std Time (min)" hint="Optional — minutes per unit" error={errors.stdTimeMin}>
              <input
                id="process-std-time"
                type="number"
                step="0.01"
                className={`${styles.input} tabular-nums ${errors.stdTimeMin ? styles.inputError : ''}`}
                aria-invalid={!!errors.stdTimeMin}
                value={editing.stdTimeMin ?? ''}
                onChange={(e) => setField('stdTimeMin', e.target.value)}
                onBlur={() => blurOptionalNumber('stdTimeMin')}
              />
            </FormField>
            <FormField id="process-rate" label="Rate/hour" hint="Optional — machine/hour rate" error={errors.ratePerHour}>
              <input
                id="process-rate"
                type="number"
                step="0.01"
                className={`${styles.input} tabular-nums ${errors.ratePerHour ? styles.inputError : ''}`}
                aria-invalid={!!errors.ratePerHour}
                value={editing.ratePerHour ?? ''}
                onChange={(e) => setField('ratePerHour', e.target.value)}
                onBlur={() => blurOptionalNumber('ratePerHour')}
              />
            </FormField>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Deactivate process?"
        message={`${deleting?.name} will be marked inactive and no longer selectable.`}
        confirmLabel="Deactivate"
        variant="destructive"
        loading={deletingBusy}
      />
    </div>
  );
}
