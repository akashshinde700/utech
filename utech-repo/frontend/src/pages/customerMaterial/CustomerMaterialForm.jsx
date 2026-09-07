import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, PackagePlus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, validateAll } from '../../lib/validation';
import { todayLocal } from '../../lib/format';
import toast from 'react-hot-toast';

export default function CustomerMaterialForm() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [jobcards, setJobcards] = useState([]);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    customerId: '', jobcardId: '', itemId: '',
    materialDescription: '', heatNumber: '', lotNumber: '',
    qty: '', weight: '', uomCode: '', location: '',
    receivedDate: todayLocal(), notes: '',
  });

  useEffect(() => {
    // party.type filtering is exact-match server-side, so BOTH-type parties
    // would be silently dropped by ?type=CUSTOMER — fetch active parties
    // unfiltered and filter client-side instead.
    api.get('/parties', { params: { pageSize: 500 } }).then((r) =>
      setCustomers(r.data.items.filter((p) => p.type === 'CUSTOMER' || p.type === 'BOTH'))
    );
    api.get('/jobcards', { params: { pageSize: 200 } }).then((r) => setJobcards(r.data.items)).catch(() => {});
    api.get('/items', { params: { pageSize: 300 } }).then((r) => setItems(r.data.items));
  }, []);

  const customerOptions = customers.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));
  const jobcardOptions = jobcards.map((j) => ({ value: j.id, label: j.number }));
  const itemOptions = items.map((it) => ({ value: it.id, label: `${it.code} — ${it.name}` }));

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  function blurField(key) {
    let msg = null;
    if (key === 'qty') msg = positiveNumber(form.qty, 'Quantity');
    else if (key === 'weight') {
      const s = String(form.weight ?? '').trim();
      if (s !== '' && (!Number.isFinite(Number(s)) || Number(s) <= 0)) msg = 'Weight must be a number greater than 0';
    }
    if (msg) setErrors((errs) => ({ ...errs, [key]: msg }));
  }

  async function save(e) {
    e.preventDefault();
    const { errors: nextErrors, ok } = validateAll(form, {
      customerId: (v) => required(v, 'Customer'),
      receivedDate: (v) => required(v, 'Received date'),
      materialDescription: (v) => required(v, 'Material description'),
      qty: (v) => positiveNumber(v, 'Quantity'),
      weight: (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return null;
        if (!Number.isFinite(Number(s)) || Number(s) <= 0) return 'Weight must be a number greater than 0';
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
        ...form,
        customerId: Number(form.customerId),
        jobcardId: form.jobcardId ? Number(form.jobcardId) : null,
        itemId: form.itemId ? Number(form.itemId) : null,
        qty: Number(form.qty),
        weight: form.weight ? Number(form.weight) : null,
      };
      const { data } = await api.post('/customer-material', payload);
      toast.success('Inward recorded');
      navigate(`/customer-material/${data.id}`);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to record inward');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = (key) => `${styles.input} ${errors[key] ? styles.inputError : ''}`;

  return (
    <div>
      <PageHeader title="New Customer Material Inward" subtitle="Customer-owned material — tracked completely separately from company stock" />
      <form onSubmit={save} className="max-w-4xl space-y-5" noValidate>
        <FormSection icon={PackagePlus} title="Inward Details" description="Who sent the material, what it is and how much arrived">
          <div className={styles.formGrid}>
            <FormField id="cm-customer" label="Customer" required error={errors.customerId}>
              <SearchableSelect
                id="cm-customer"
                value={form.customerId}
                onChange={(v) => setField('customerId', v)}
                options={customerOptions}
                placeholder="Select customer…"
                error={errors.customerId}
              />
            </FormField>
            <FormField id="cm-date" label="Received Date" required error={errors.receivedDate}>
              <input
                id="cm-date"
                type="date"
                className={inputCls('receivedDate')}
                aria-invalid={!!errors.receivedDate}
                aria-describedby={errors.receivedDate ? 'cm-date-error' : undefined}
                value={form.receivedDate}
                onChange={(e) => setField('receivedDate', e.target.value)}
              />
            </FormField>

            <FormField id="cm-jobcard" label="Job Card" hint="Optional — link this lot to a jobcard">
              <SearchableSelect
                id="cm-jobcard"
                value={form.jobcardId}
                onChange={(v) => setField('jobcardId', v)}
                options={jobcardOptions}
                placeholder="— none —"
              />
            </FormField>
            <FormField id="cm-item" label="Catalog Item" hint="Optional — pick only if the material is in the item catalog">
              <SearchableSelect
                id="cm-item"
                value={form.itemId}
                onChange={(v) => setField('itemId', v)}
                options={itemOptions}
                placeholder="— not in catalog —"
              />
            </FormField>

            <FormField id="cm-desc" label="Material Description" required error={errors.materialDescription} className="sm:col-span-2">
              <input
                id="cm-desc"
                className={inputCls('materialDescription')}
                aria-invalid={!!errors.materialDescription}
                aria-describedby={errors.materialDescription ? 'cm-desc-error' : undefined}
                placeholder="e.g. Customer supplied steel bar"
                value={form.materialDescription}
                onChange={(e) => setField('materialDescription', e.target.value)}
              />
            </FormField>

            <FormField id="cm-heat" label="Heat Number">
              <input id="cm-heat" className={styles.input} value={form.heatNumber} onChange={(e) => setField('heatNumber', e.target.value)} />
            </FormField>
            <FormField id="cm-lot" label="Lot Number">
              <input id="cm-lot" className={styles.input} value={form.lotNumber} onChange={(e) => setField('lotNumber', e.target.value)} />
            </FormField>

            <FormField id="cm-qty" label="Quantity" required error={errors.qty}>
              <input
                id="cm-qty"
                type="number"
                step="0.001"
                className={`${inputCls('qty')} tabular-nums`}
                aria-invalid={!!errors.qty}
                aria-describedby={errors.qty ? 'cm-qty-error' : undefined}
                value={form.qty}
                onChange={(e) => setField('qty', e.target.value)}
                onBlur={() => blurField('qty')}
              />
            </FormField>
            <FormField id="cm-uom" label="UoM" hint="e.g. KG / PCS / MTR">
              <input id="cm-uom" className={styles.input} placeholder="KG / PCS / MTR" value={form.uomCode} onChange={(e) => setField('uomCode', e.target.value)} />
            </FormField>

            <FormField id="cm-weight" label="Weight" error={errors.weight}>
              <input
                id="cm-weight"
                type="number"
                step="0.001"
                className={`${inputCls('weight')} tabular-nums`}
                value={form.weight}
                onChange={(e) => setField('weight', e.target.value)}
                onBlur={() => blurField('weight')}
              />
            </FormField>
            <FormField id="cm-location" label="Location" hint="Where the lot is stored">
              <input id="cm-location" className={styles.input} placeholder="e.g. Store-A" value={form.location} onChange={(e) => setField('location', e.target.value)} />
            </FormField>

            <FormField id="cm-notes" label="Notes" className="sm:col-span-2">
              <textarea id="cm-notes" className={styles.textarea} rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
            </FormField>
          </div>

          <div className={styles.actionsBar}>
            <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/customer-material')}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </FormSection>
      </form>
    </div>
  );
}
