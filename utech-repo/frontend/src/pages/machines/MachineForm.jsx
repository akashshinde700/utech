import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Loader2, Cog } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import { styles } from '../../lib/formStyles';
import { required, validateAll } from '../../lib/validation';
import toast from 'react-hot-toast';

const emptyForm = {
  code: '',
  name: '',
  type: '',
  capacity: '',
  status: 'ACTIVE',
  notes: '',
};

const STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED'];

export default function MachineForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState(emptyForm);

  async function loadMachine() {
    if (!id) return;
    const { data: response } = await api.get(`/machines/${id}`);
    setFormData({
      code: response.code,
      name: response.name,
      type: response.type || '',
      capacity: response.capacity || '',
      status: response.status,
      notes: response.notes || '',
    });
  }

  useEffect(() => { if (id) loadMachine(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(key, value) {
    setFormData((f) => ({ ...f, [key]: value }));
    setErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  function blurField(key) {
    let msg = null;
    if (key === 'code') msg = required(formData.code, 'Code');
    else if (key === 'name') msg = required(formData.name, 'Name');
    if (msg) setErrors((errs) => ({ ...errs, [key]: msg }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const { errors: nextErrors, ok } = validateAll(formData, {
      code: (v) => required(v, 'Code'),
      name: (v) => required(v, 'Name'),
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/machines/${id}`, formData);
      } else {
        await api.post('/machines', formData);
      }
      toast.success(isEdit ? 'Machine updated' : 'Machine created');
      navigate('/machines');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error saving machine');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Machine' : 'New Machine'}
        subtitle="Production equipment master"
        action={
          <button onClick={() => navigate('/machines')} className={styles.secondaryBtn}>
            Cancel
          </button>
        }
      />
      <form onSubmit={handleSubmit} className="max-w-4xl space-y-5" noValidate>
        <FormSection icon={Cog} title="Machine Details" description="Identity, capacity and current lifecycle status">
          <div className={styles.formGrid}>
            <FormField id="machine-code" label="Code" required error={errors.code} hint="Short unique identifier, e.g. CNC-01">
              <input
                id="machine-code"
                className={`${styles.input} ${errors.code ? styles.inputError : ''}`}
                aria-invalid={!!errors.code}
                aria-describedby={errors.code ? 'machine-code-error' : undefined}
                value={formData.code}
                onChange={(e) => setField('code', e.target.value)}
                onBlur={() => blurField('code')}
              />
            </FormField>
            <FormField id="machine-name" label="Name" required error={errors.name}>
              <input
                id="machine-name"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'machine-name-error' : undefined}
                value={formData.name}
                onChange={(e) => setField('name', e.target.value)}
                onBlur={() => blurField('name')}
              />
            </FormField>
            <FormField id="machine-type" label="Type" hint="e.g. CNC, Lathe, Welding">
              <input id="machine-type" className={styles.input} value={formData.type} onChange={(e) => setField('type', e.target.value)} />
            </FormField>
            <FormField id="machine-capacity" label="Capacity" hint="Free-text, e.g. 1000 pcs/day">
              <input id="machine-capacity" className={styles.input} value={formData.capacity} onChange={(e) => setField('capacity', e.target.value)} />
            </FormField>
            <FormField id="machine-status" label="Status" required>
              <select id="machine-status" className={styles.input} value={formData.status} onChange={(e) => setField('status', e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s === 'ACTIVE' ? 'Active' : s === 'MAINTENANCE' ? 'Maintenance' : 'Retired'}</option>
                ))}
              </select>
            </FormField>
            <FormField id="machine-notes" label="Notes" className="sm:col-span-2">
              <textarea
                id="machine-notes"
                className={styles.textarea}
                rows={2}
                value={formData.notes}
                onChange={(e) => setField('notes', e.target.value)}
              />
            </FormField>
          </div>

          <div className={styles.actionsBar}>
            <button type="button" onClick={() => navigate('/machines')} className={styles.secondaryBtn}>Cancel</button>
            <button type="submit" disabled={saving} className={styles.primaryBtn}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </FormSection>
      </form>
    </div>
  );
}
