import { useEffect, useState } from 'react';
import { Plus, Clock, Loader2, Clock4 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import FormField from '../../components/ui/FormField';
import { styles } from '../../lib/formStyles';
import { required, validateAll } from '../../lib/validation';
import toast from 'react-hot-toast';

const empty = { code: '', name: '', startTime: '', endTime: '', isActive: true };

export default function ShiftsPage() {
  const [shifts, setShifts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const response = await api.get('/production/shifts');
      setShifts(response.data || []);
    } catch (err) {
      console.error('Error loading shifts:', err);
      setShifts([]);
    } finally {
      setLoading(false);
    }
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

  function blurField(key) {
    let msg = null;
    if (key === 'code') msg = required(editing.code, 'Code');
    else if (key === 'name') msg = required(editing.name, 'Name');
    else if (key === 'startTime') msg = required(editing.startTime, 'Start time');
    else if (key === 'endTime') msg = required(editing.endTime, 'End time');
    if (msg) setErrors((errs) => ({ ...errs, [key]: msg }));
  }

  async function save() {
    const { errors: nextErrors, ok } = validateAll(editing, {
      code: (v) => required(v, 'Code'),
      name: (v) => required(v, 'Name'),
      startTime: (v) => required(v, 'Start time'),
      endTime: (v) => required(v, 'End time'),
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...editing };
      if (editing.id) {
        await api.put(`/production/shifts/${editing.id}`, payload);
        toast.success('Updated');
      } else {
        await api.post('/production/shifts', payload);
        toast.success('Created');
      }
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error saving shift');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id, isActive) {
    try {
      await api.put(`/production/shifts/${id}`, { isActive });
      toast.success('Updated');
      load();
    } catch (err) {
      console.error(err);
      toast.error('Error updating');
    }
  }

  return (
    <div>
      <PageHeader
        title="Shift Management"
        subtitle="Configure production shifts"
        action={<button className="btn-primary" onClick={() => { setErrors({}); setEditing({ ...empty }); }}><Plus className="w-4 h-4" /> New Shift</button>}
      />

      {!loading && shifts.length === 0 ? (
        <div className="card-flat">
          <EmptyState
            icon={Clock}
            title="No shifts configured yet"
            description="Define shifts (e.g. Morning A / Evening B) so production batches can be planned against them."
            action={{ label: 'New Shift', onClick: () => { setErrors({}); setEditing({ ...empty }); }, icon: Plus }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shifts.map((shift) => (
            <div key={shift.id} className="card p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-semibold text-slate-800">{shift.code}</div>
                  <div className="text-sm text-slate-600">{shift.name}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleActive(shift.id, !shift.isActive)}
                  className={`px-2 py-1 text-xs rounded-full transition-colors ${shift.isActive ? 'bg-success-100 text-success-700 hover:bg-success-500/20' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                >
                  {shift.isActive ? 'Active' : 'Inactive'}
                </button>
              </div>
              <div className="text-sm text-slate-500 mb-3">
                <Clock4 className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                {shift.startTime} - {shift.endTime}
              </div>
              <button
                type="button"
                onClick={() => { setErrors({}); setEditing(shift); }}
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit Shift' : 'New Shift'}
          description="Shift window used when planning production batches"
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
            <FormField id="shift-code" label="Code" required error={errors.code}>
              <input
                id="shift-code"
                className={`${styles.input} ${errors.code ? styles.inputError : ''}`}
                aria-invalid={!!errors.code}
                aria-describedby={errors.code ? 'shift-code-error' : undefined}
                value={editing.code}
                onChange={(e) => setField('code', e.target.value)}
                onBlur={() => blurField('code')}
              />
            </FormField>
            <FormField id="shift-name" label="Name" required error={errors.name}>
              <input
                id="shift-name"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'shift-name-error' : undefined}
                value={editing.name}
                onChange={(e) => setField('name', e.target.value)}
                onBlur={() => blurField('name')}
              />
            </FormField>
            <FormField id="shift-start" label="Start Time" required error={errors.startTime}>
              <input
                id="shift-start"
                type="time"
                className={`${styles.input} ${errors.startTime ? styles.inputError : ''}`}
                aria-invalid={!!errors.startTime}
                value={editing.startTime}
                onChange={(e) => setField('startTime', e.target.value)}
                onBlur={() => blurField('startTime')}
              />
            </FormField>
            <FormField id="shift-end" label="End Time" required error={errors.endTime}>
              <input
                id="shift-end"
                type="time"
                className={`${styles.input} ${errors.endTime ? styles.inputError : ''}`}
                aria-invalid={!!errors.endTime}
                value={editing.endTime}
                onChange={(e) => setField('endTime', e.target.value)}
                onBlur={() => blurField('endTime')}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer sm:col-span-2">
              <input
                type="checkbox"
                id="shift-is-active"
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={editing.isActive}
                onChange={(e) => setField('isActive', e.target.checked)}
              />
              Active
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
