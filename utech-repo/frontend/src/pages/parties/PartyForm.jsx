import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { User, MapPin, CreditCard, StickyNote, Save } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import { styles } from '../../lib/formStyles';
import { email, gstin, normalizePhone, phone10, pincode, required, validateAll } from '../../lib/validation';
import toast from 'react-hot-toast';

const empty = {
  name: '', type: 'CUSTOMER', contactPerson: '', email: '', phone: '', altPhone: '',
  gstin: '', pan: '',
  addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', country: 'India',
  creditLimit: '', creditDays: '', openingBalance: '', notes: '',
};

// field id map — lets a failed submit focus the first offending control
const FIELD_IDS = {
  name: 'party-name', type: 'party-type', contactPerson: 'party-contact', email: 'party-email',
  phone: 'party-phone', altPhone: 'party-alt-phone', gstin: 'party-gstin', pan: 'party-pan',
  addressLine1: 'party-addr1', addressLine2: 'party-addr2', city: 'party-city', state: 'party-state',
  pincode: 'party-pincode', country: 'party-country', creditLimit: 'party-credit-limit',
  creditDays: 'party-credit-days', openingBalance: 'party-opening-balance', notes: 'party-notes',
};

// PAN is not in lib/validation — local format validator, empty allowed.
// Format: [A-Z]{5}[0-9]{4}[A-Z]{1} (e.g. ABCDE1234F).
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
function pan(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return null;
  if (!PAN_RE.test(s)) return 'Enter a valid PAN (e.g. ABCDE1234F)';
  return null;
}

const schema = {
  name: (v) => required(v, 'Party name'),
  type: (v) => required(v, 'Type'),
  email: (v) => email(v),
  phone: (v) => phone10(v),
  altPhone: (v) => phone10(v),
  gstin: (v) => gstin(v),
  pan: (v) => pan(v),
  pincode: (v) => pincode(v),
};

export default function PartyForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (id) api.get(`/parties/${id}`).then((r) => setForm({ ...empty, ...r.data }));
  }, [id]);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    // clear the field's error as soon as its value changes
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  // validate a single field when the user tabs away from it (blur)
  function blur(k) {
    if (!schema[k]) return;
    const msg = schema[k](form[k], form);
    setErrors((e) => ({ ...e, [k]: msg || undefined }));
  }

  async function save(e) {
    e.preventDefault();
    const { errors: errs, ok } = validateAll(form, schema);
    if (!ok) {
      setErrors(errs);
      toast.error('Please fix the highlighted fields');
      const first = Object.keys(errs)[0];
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      ['creditLimit', 'creditDays', 'openingBalance'].forEach((k) => {
        payload[k] = payload[k] === '' || payload[k] == null ? null : Number(payload[k]);
      });
      // store bare 10-digit numbers when the input carried +91 / 0 prefixes
      payload.phone = normalizePhone(payload.phone);
      payload.altPhone = normalizePhone(payload.altPhone);
      if (id) await api.put(`/parties/${id}`, payload);
      else await api.post('/parties', payload);
      toast.success('Party saved');
      navigate('/parties');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save party');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title={id ? 'Edit party' : 'New party'} subtitle="Customers and vendors used across sales & purchase documents" />

      <form onSubmit={save} noValidate className="max-w-5xl space-y-5">
        <FormSection icon={User} title="Party Details" description="Legal name and primary contact for this party">
          <div className={styles.formGrid}>
            <FormField id="party-name" label="Party Name" required hint="As per GST records" error={errors.name} className="sm:col-span-2">
              <input
                id="party-name"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                onBlur={() => blur('name')}
                aria-invalid={!!errors.name}
              />
            </FormField>
            <FormField id="party-type" label="Type" required error={errors.type}>
              <select
                id="party-type"
                className={`${styles.input} ${errors.type ? styles.inputError : ''}`}
                value={form.type}
                onChange={(e) => set('type', e.target.value)}
                onBlur={() => blur('type')}
                aria-invalid={!!errors.type}
              >
                <option value="CUSTOMER">Customer</option>
                <option value="VENDOR">Vendor</option>
                <option value="BOTH">Both</option>
              </select>
            </FormField>
            <FormField id="party-contact" label="Contact Person" error={errors.contactPerson}>
              <input id="party-contact" className={styles.input} value={form.contactPerson || ''} onChange={(e) => set('contactPerson', e.target.value)} />
            </FormField>
            <FormField id="party-phone" label="Phone" hint="10-digit mobile" error={errors.phone}>
              <input
                id="party-phone"
                className={`${styles.input} ${errors.phone ? styles.inputError : ''}`}
                value={form.phone || ''}
                onChange={(e) => set('phone', e.target.value)}
                onBlur={() => blur('phone')}
                aria-invalid={!!errors.phone}
              />
            </FormField>
            <FormField id="party-alt-phone" label="Alt Phone" error={errors.altPhone}>
              <input
                id="party-alt-phone"
                className={`${styles.input} ${errors.altPhone ? styles.inputError : ''}`}
                value={form.altPhone || ''}
                onChange={(e) => set('altPhone', e.target.value)}
                onBlur={() => blur('altPhone')}
                aria-invalid={!!errors.altPhone}
              />
            </FormField>
            <FormField id="party-email" label="Email" error={errors.email}>
              <input
                id="party-email"
                type="email"
                className={`${styles.input} ${errors.email ? styles.inputError : ''}`}
                value={form.email || ''}
                onChange={(e) => set('email', e.target.value)}
                onBlur={() => blur('email')}
                aria-invalid={!!errors.email}
              />
            </FormField>
            <FormField id="party-gstin" label="GSTIN" hint="15-character GST identification number" error={errors.gstin}>
              <input
                id="party-gstin"
                className={`${styles.input} uppercase ${errors.gstin ? styles.inputError : ''}`}
                value={form.gstin || ''}
                onChange={(e) => set('gstin', e.target.value)}
                onBlur={() => blur('gstin')}
                aria-invalid={!!errors.gstin}
              />
            </FormField>
            <FormField id="party-pan" label="PAN" hint="5 letters, 4 digits, 1 letter" error={errors.pan}>
              <input
                id="party-pan"
                className={`${styles.input} uppercase ${errors.pan ? styles.inputError : ''}`}
                value={form.pan || ''}
                onChange={(e) => set('pan', e.target.value)}
                onBlur={() => blur('pan')}
                aria-invalid={!!errors.pan}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={MapPin} title="Address" description="Billing address shown on quotations and invoices">
          <div className={styles.formGrid}>
            <FormField id="party-addr1" label="Address Line 1" className="sm:col-span-2">
              <input id="party-addr1" className={styles.input} value={form.addressLine1 || ''} onChange={(e) => set('addressLine1', e.target.value)} />
            </FormField>
            <FormField id="party-addr2" label="Address Line 2" className="sm:col-span-2">
              <input id="party-addr2" className={styles.input} value={form.addressLine2 || ''} onChange={(e) => set('addressLine2', e.target.value)} />
            </FormField>
            <FormField id="party-city" label="City">
              <input id="party-city" className={styles.input} value={form.city || ''} onChange={(e) => set('city', e.target.value)} />
            </FormField>
            <FormField id="party-state" label="State">
              <input id="party-state" className={styles.input} value={form.state || ''} onChange={(e) => set('state', e.target.value)} />
            </FormField>
            <FormField id="party-pincode" label="Pincode" hint="6-digit PIN" error={errors.pincode}>
              <input
                id="party-pincode"
                className={`${styles.input} ${errors.pincode ? styles.inputError : ''}`}
                value={form.pincode || ''}
                onChange={(e) => set('pincode', e.target.value)}
                onBlur={() => blur('pincode')}
                aria-invalid={!!errors.pincode}
              />
            </FormField>
            <FormField id="party-country" label="Country">
              <input id="party-country" className={styles.input} value={form.country || 'India'} onChange={(e) => set('country', e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={CreditCard} title="Commercial" description="Credit terms and opening balance for the party ledger">
          <div className={styles.formGrid3}>
            <FormField id="party-credit-limit" label="Credit Limit" hint="Maximum outstanding allowed (₹)">
              <input id="party-credit-limit" type="number" step="0.01" min="0" className={styles.input} value={form.creditLimit ?? ''} onChange={(e) => set('creditLimit', e.target.value)} />
            </FormField>
            <FormField id="party-credit-days" label="Credit Days" hint="Payment due window">
              <input id="party-credit-days" type="number" min="0" className={styles.input} value={form.creditDays ?? ''} onChange={(e) => set('creditDays', e.target.value)} />
            </FormField>
            <FormField id="party-opening-balance" label="Opening Balance" hint="Carried-forward balance (₹)">
              <input id="party-opening-balance" type="number" step="0.01" className={styles.input} value={form.openingBalance ?? ''} onChange={(e) => set('openingBalance', e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={StickyNote} title="Notes" description="Internal remarks — never printed on documents">
          <div className={styles.formGrid}>
            <FormField id="party-notes" label="Notes" className="sm:col-span-2">
              <textarea id="party-notes" rows={3} className={styles.textarea} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
            </FormField>
          </div>
          <div className={styles.actionsBar}>
            <button type="button" className={styles.ghostBtn} onClick={() => navigate('/parties')}>Cancel</button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </FormSection>
      </form>
    </div>
  );
}
