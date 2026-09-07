import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Package, Tag, Save } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { gstRate, hsn, positiveNumber, required, validateAll } from '../../lib/validation';
import toast from 'react-hot-toast';

const empty = {
  name: '', description: '', type: 'RAW_MATERIAL', hsnCode: '', projectNumber: '', projectId: '',
  purchaseRate: '', saleRate: '', gstRate: 18,
  openingStock: 0, minStock: 0,
  uomId: '', categoryId: '',
};

const FIELD_IDS = {
  name: 'item-name', description: 'item-description', type: 'item-type', hsnCode: 'item-hsn',
  projectNumber: 'item-project', projectId: 'item-project-link', uomId: 'item-uom', categoryId: 'item-category',
  purchaseRate: 'item-purchase-rate', saleRate: 'item-sale-rate', gstRate: 'item-gst-rate',
  openingStock: 'item-opening-stock', minStock: 'item-min-stock',
};

// rates must be > 0 when provided; stock counters may legitimately be 0
const optionalPositive = (v, label) => (String(v ?? '').trim() === '' ? null : positiveNumber(v, label));
function nonNegative(v, label) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return `${label} must be 0 or more`;
  return null;
}

const schema = {
  name: (v) => required(v, 'Item name'),
  hsnCode: (v) => hsn(v),
  gstRate: (v) => gstRate(v),
  purchaseRate: (v) => optionalPositive(v, 'Purchase rate'),
  saleRate: (v) => optionalPositive(v, 'Sale rate'),
  openingStock: (v) => nonNegative(v, 'Opening stock'),
  minStock: (v) => nonNegative(v, 'Min stock'),
};

export default function ItemForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [lookups, setLookups] = useState({ uoms: [], categories: [] });
  const [projects, setProjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => { api.get('/items/lookups').then((r) => setLookups(r.data)); }, []);
  useEffect(() => {
    api.get('/projects', { params: { pageSize: 200 } })
      .then((r) => setProjects(r.data.items || []))
      .catch(() => setProjects([]));
  }, []);
  useEffect(() => {
    if (id) api.get(`/items/${id}`).then((r) => setForm({
      ...empty, ...r.data,
      uomId: r.data.uomId || '', categoryId: r.data.categoryId || '',
      projectId: r.data.projectId || '', projectNumber: r.data.projectNumber || '',
    }));
  }, [id]);

  const uomOptions = useMemo(
    () => lookups.uoms.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` })),
    [lookups.uoms]
  );
  const categoryOptions = useMemo(
    () => lookups.categories.map((c) => ({ value: c.id, label: c.name })),
    [lookups.categories]
  );
  const projectOptions = useMemo(
    () => projects.map((pr) => ({ value: pr.id, label: `${pr.code} — ${pr.name}` })),
    [projects]
  );

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
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
      document.getElementById(FIELD_IDS[Object.keys(errs)[0]])?.focus();
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      ['purchaseRate', 'saleRate', 'gstRate', 'openingStock', 'minStock'].forEach((k) => {
        payload[k] = payload[k] === '' || payload[k] == null ? null : Number(payload[k]);
      });
      ['uomId', 'categoryId', 'projectId'].forEach((k) => {
        payload[k] = payload[k] === '' ? null : Number(payload[k]);
      });
      payload.projectNumber = payload.projectNumber?.trim() || null;
      // openingStock is create-only; the API ignores it on edit
      if (id) delete payload.openingStock;
      if (id) await api.put(`/items/${id}`, payload);
      else await api.post('/items', payload);
      toast.success('Item saved');
      navigate('/items');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save item');
    } finally {
      setSaving(false);
    }
  }

  const err = (k) => errors[k] ? `${styles.inputError}` : '';
  const errCls = (k) => `${styles.input} ${err(k)}`;

  return (
    <div>
      <PageHeader title={id ? 'Edit item' : 'New item'} subtitle="Inventory master used by sales, purchase and stock documents" />

      <form onSubmit={save} noValidate className="max-w-5xl space-y-5">
        <FormSection icon={Package} title="Basic Information" description="How the item is identified across the system">
          <div className={styles.formGrid}>
            <FormField id="item-name" label="Item Name" required error={errors.name} className="sm:col-span-2">
              <input id="item-name" className={errCls('name')} value={form.name} onChange={(e) => set('name', e.target.value)} onBlur={() => blur('name')} aria-invalid={!!errors.name} />
            </FormField>
            <FormField id="item-description" label="Description" className="sm:col-span-2">
              <textarea id="item-description" rows={3} className={styles.textarea} value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
            </FormField>
            <FormField id="item-type" label="Type">
              <select id="item-type" className={styles.input} value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option value="RAW_MATERIAL">Raw Material</option>
                <option value="SEMI_FINISHED">Semi-finished</option>
                <option value="FINISHED">Finished</option>
                <option value="CONSUMABLE">Consumable</option>
                <option value="SERVICE">Service</option>
              </select>
            </FormField>
            <FormField id="item-hsn" label="HSN Code" hint="4, 6 or 8 digits" error={errors.hsnCode}>
              <input id="item-hsn" className={errCls('hsnCode')} value={form.hsnCode || ''} onChange={(e) => set('hsnCode', e.target.value)} onBlur={() => blur('hsnCode')} aria-invalid={!!errors.hsnCode} />
            </FormField>
            <FormField id="item-project-link" label="Project" hint="Links this item to a project — shown on the project's Items tab">
              <SearchableSelect
                id="item-project-link"
                value={form.projectId}
                onChange={(v) => set('projectId', v)}
                options={projectOptions}
                placeholder="— none —"
                emptyText="No matching projects"
              />
            </FormField>
            <FormField id="item-project" label="Project Number" hint="Optional free-text label (drawing / contract ref)">
              <input id="item-project" className={styles.input} value={form.projectNumber || ''} onChange={(e) => set('projectNumber', e.target.value)} />
            </FormField>
            <FormField id="item-uom" label="UoM" hint="Unit of measurement">
              <SearchableSelect
                id="item-uom"
                value={form.uomId}
                onChange={(v) => set('uomId', v)}
                options={uomOptions}
                placeholder="Select unit…"
                emptyText="No matching units"
              />
            </FormField>
            <FormField id="item-category" label="Category">
              <SearchableSelect
                id="item-category"
                value={form.categoryId}
                onChange={(v) => set('categoryId', v)}
                options={categoryOptions}
                placeholder="Select category…"
                emptyText="No matching categories"
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={Tag} title="Pricing & Stock" description="Default rates pulled into documents, plus stock thresholds">
          <div className={styles.formGrid3}>
            <FormField id="item-purchase-rate" label="Purchase Rate" hint="₹ per unit" error={errors.purchaseRate}>
              <input id="item-purchase-rate" type="number" step="0.01" min="0" className={errCls('purchaseRate')} value={form.purchaseRate ?? ''} onChange={(e) => set('purchaseRate', e.target.value)} onBlur={() => blur('purchaseRate')} aria-invalid={!!errors.purchaseRate} />
            </FormField>
            <FormField id="item-sale-rate" label="Sale Rate" hint="₹ per unit" error={errors.saleRate}>
              <input id="item-sale-rate" type="number" step="0.01" min="0" className={errCls('saleRate')} value={form.saleRate ?? ''} onChange={(e) => set('saleRate', e.target.value)} onBlur={() => blur('saleRate')} aria-invalid={!!errors.saleRate} />
            </FormField>
            <FormField id="item-gst-rate" label="GST %" hint="0 – 28" error={errors.gstRate}>
              <input id="item-gst-rate" type="number" step="0.01" min="0" max="28" className={errCls('gstRate')} value={form.gstRate} onChange={(e) => set('gstRate', e.target.value)} onBlur={() => blur('gstRate')} aria-invalid={!!errors.gstRate} />
            </FormField>
            <FormField id="item-opening-stock" label="Opening Stock" hint="Locked after the item is created" error={errors.openingStock}>
              <input id="item-opening-stock" type="number" step="0.001" min="0" className={errCls('openingStock')} value={form.openingStock} onChange={(e) => set('openingStock', e.target.value)} onBlur={() => blur('openingStock')} disabled={!!id} aria-invalid={!!errors.openingStock} />
            </FormField>
            <FormField id="item-min-stock" label="Min Stock" hint="Low-stock alert threshold" error={errors.minStock}>
              <input id="item-min-stock" type="number" step="0.001" min="0" className={errCls('minStock')} value={form.minStock} onChange={(e) => set('minStock', e.target.value)} onBlur={() => blur('minStock')} aria-invalid={!!errors.minStock} />
            </FormField>
          </div>

          <div className={styles.actionsBar}>
            <button type="button" className={styles.ghostBtn} onClick={() => navigate('/items')}>Cancel</button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </FormSection>
      </form>
    </div>
  );
}
