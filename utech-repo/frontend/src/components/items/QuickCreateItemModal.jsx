import { useEffect, useState } from 'react';
import api from '../../lib/api';
import Modal from '../ui/Modal';
import FormField from '../ui/FormField';
import SearchableSelect from '../ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { gstRate, hsn, validateAll } from '../../lib/validation';

const ITEM_TYPES = [
  { value: 'RAW_MATERIAL', label: 'Raw Material' },
  { value: 'SEMI_FINISHED', label: 'Semi-finished' },
  { value: 'FINISHED', label: 'Finished' },
  { value: 'CONSUMABLE', label: 'Consumable' },
  { value: 'SERVICE', label: 'Service' },
];

const FORM_ID = 'quick-create-item-form';

const emptyForm = {
  name: '',
  description: '',
  type: 'RAW_MATERIAL',
  hsnCode: '',
  uomId: '',
  categoryId: '',
  purchaseRate: '',
  gstRate: '18',
};

function itemName(v) {
  const name = String(v ?? '').trim();
  if (!name) return 'Item name is required';
  if (name.length < 2) return 'Item name must be at least 2 characters';
  return null;
}

function optionalNonNegative(v, label) {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return `${label} must be 0 or more`;
  return null;
}

const FIELD_IDS = {
  name: 'quick-item-name',
  hsnCode: 'quick-item-hsn',
  purchaseRate: 'quick-item-purchase-rate',
  gstRate: 'quick-item-gst-rate',
};

const schema = {
  name: itemName,
  hsnCode: hsn,
  purchaseRate: (v) => optionalNonNegative(v, 'Purchase rate'),
  gstRate,
};

// Creates a real Item master record from inside a document form. The caller
// receives the created row and is responsible for selecting it on its line.
export default function QuickCreateItemModal({ open, onClose, onCreated, initialName = '' }) {
  const [form, setForm] = useState(emptyForm);
  const [lookups, setLookups] = useState({ uoms: [], categories: [] });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setForm({ ...emptyForm, name: initialName || '' });
    setErrors({});
    setServerError('');
    api.get('/items/lookups')
      .then((r) => {
        if (active) setLookups({ uoms: r.data?.uoms || [], categories: r.data?.categories || [] });
      })
      .catch(() => {
        if (active) setLookups({ uoms: [], categories: [] });
      });
    return () => { active = false; };
  }, [open, initialName]);

  const uomOptions = lookups.uoms.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }));
  const categoryOptions = lookups.categories.map((c) => ({ value: c.id, label: c.name }));

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
    if (serverError) setServerError('');
  }

  const err = (k) => (errors[k] ? styles.inputError : '');

  function requestClose() {
    if (!saving) onClose();
  }

  async function submit(e) {
    e.preventDefault();
    const { errors: found, ok } = validateAll(form, schema);
    if (!ok) {
      setErrors(found);
      const first = Object.keys(found)[0];
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }

    setSaving(true);
    setServerError('');
    let created;
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        type: form.type,
        hsnCode: form.hsnCode.trim() || null,
        uomId: form.uomId === '' ? null : Number(form.uomId),
        categoryId: form.categoryId === '' ? null : Number(form.categoryId),
        purchaseRate: String(form.purchaseRate).trim() === '' ? null : Number(form.purchaseRate),
        gstRate: String(form.gstRate).trim() === '' ? null : Number(form.gstRate),
        // Deliberately zero: the GRN posts the received quantity through the
        // stock ledger. Seeding an opening balance here would double-count it.
        openingStock: 0,
        minStock: 0,
      };
      ({ data: created } = await api.post('/items', payload));
    } catch (error) {
      setServerError(error.response?.data?.message || 'Could not create the item. Please try again.');
      setSaving(false);
      return;
    }
    setSaving(false);
    onCreated?.(created);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      closeOnOverlay={!saving}
      disableEscape={saving}
      size="lg"
      title="Create new item"
      description="This saves the item to the item master and selects it on the GRN."
      footer={(
        <>
          <button type="button" className={styles.secondaryBtn} onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form={FORM_ID} className={styles.primaryBtn} disabled={saving}>
            {saving ? 'Creating…' : 'Create item'}
          </button>
        </>
      )}
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-4">
        {serverError && (
          <p role="alert" className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {serverError}
          </p>
        )}
        <FormField id="quick-item-name" label="Item Name" required error={errors.name}>
          <input
            id="quick-item-name"
            className={`${styles.input} ${err('name')}`}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            aria-invalid={!!errors.name}
          />
        </FormField>
        <FormField id="quick-item-description" label="Description">
          <textarea
            id="quick-item-description"
            rows={2}
            className={styles.textarea}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </FormField>
        <div className={styles.formGrid}>
          <FormField id="quick-item-type" label="Type">
            <select
              id="quick-item-type"
              className={styles.input}
              value={form.type}
              onChange={(e) => set('type', e.target.value)}
            >
              {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </FormField>
          <FormField id="quick-item-hsn" label="HSN Code" hint="4, 6 or 8 digits" error={errors.hsnCode}>
            <input
              id="quick-item-hsn"
              className={`${styles.input} ${err('hsnCode')}`}
              value={form.hsnCode}
              onChange={(e) => set('hsnCode', e.target.value)}
              aria-invalid={!!errors.hsnCode}
            />
          </FormField>
          <FormField id="quick-item-uom" label="Unit of Measurement" hint="Optional">
            <SearchableSelect
              id="quick-item-uom"
              value={form.uomId}
              onChange={(v) => set('uomId', v)}
              options={uomOptions}
              placeholder="Select unit…"
              emptyText="No matching units"
            />
          </FormField>
          <FormField id="quick-item-category" label="Category" hint="Optional">
            <SearchableSelect
              id="quick-item-category"
              value={form.categoryId}
              onChange={(v) => set('categoryId', v)}
              options={categoryOptions}
              placeholder="Select category…"
              emptyText="No matching categories"
            />
          </FormField>
          <FormField id="quick-item-purchase-rate" label="Purchase Rate" hint="₹ per unit" error={errors.purchaseRate}>
            <input
              id="quick-item-purchase-rate"
              type="number"
              step="0.01"
              min="0"
              className={`${styles.input} ${err('purchaseRate')}`}
              value={form.purchaseRate}
              onChange={(e) => set('purchaseRate', e.target.value)}
              aria-invalid={!!errors.purchaseRate}
            />
          </FormField>
          <FormField id="quick-item-gst-rate" label="GST %" hint="0 – 28" error={errors.gstRate}>
            <input
              id="quick-item-gst-rate"
              type="number"
              step="0.01"
              min="0"
              max="28"
              className={`${styles.input} ${err('gstRate')}`}
              value={form.gstRate}
              onChange={(e) => set('gstRate', e.target.value)}
              aria-invalid={!!errors.gstRate}
            />
          </FormField>
        </div>
      </form>
    </Modal>
  );
}
