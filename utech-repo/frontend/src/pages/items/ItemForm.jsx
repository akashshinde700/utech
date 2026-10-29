import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Package, Tag, Save } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import MetalCalculatorPage from '../calculator/MetalCalculatorPage';
import { categoryIdForShape } from '../../lib/itemCategory';
import { styles } from '../../lib/formStyles';
import { gstRate, hsn, positiveNumber, required, validateAll } from '../../lib/validation';
import toast from 'react-hot-toast';
import Decimal from 'decimal.js';


const empty = {
  name: '', description: '', type: 'RAW_MATERIAL', size: '', shape: null, hsnCode: '', projectNumber: '', projectId: '',
  purchaseRate: '', ratePerKg: '', saleRate: '', gstRate: 18, metal: '',
  openingStock: 0, minStock: 0,
  uomId: '', categoryId: '',
};

const FIELD_IDS = {
  name: 'item-name', description: 'item-description', type: 'item-type', size: 'item-size', hsnCode: 'item-hsn',
  projectNumber: 'item-project', projectId: 'item-project-link', uomId: 'item-uom', categoryId: 'item-category',
  purchaseRate: 'item-purchase-rate', ratePerKg: 'item-rate-per-kg', saleRate: 'item-sale-rate', gstRate: 'item-gst-rate', metal: 'item-metal',
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
  purchaseRate: (v) => nonNegative(v, 'Purchase rate'),
  saleRate: (v) => optionalPositive(v, 'Sale rate'),
  ratePerKg: (v) => nonNegative(v, 'Rate per kg') || (v !== '' && v != null && new Decimal(v).decimalPlaces() > 2 ? 'Use at most two decimal places' : null),
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
  const [showSizeCalculator, setShowSizeCalculator] = useState(false);
  // true when the calculator filled the category, so the field can say where it
  // came from instead of appearing to have been set by magic
  const [categoryFromShape, setCategoryFromShape] = useState(false);
  const [autoPrice, setAutoPrice] = useState(false);
  const [calculatorSeed, setCalculatorSeed] = useState(null);
  const appliedPreview = useRef(null);
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
    if (['size', 'name', 'metal'].includes(k)) setWeight(null);
    // typing a size by hand drops the calculated shape with it: the numbers are
    // then stock-sheet wording, not the calculator's field order
    if (k === 'size') setForm((f) => (f.shape ? { ...f, shape: null } : f));
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
    if (showSizeCalculator) {
      toast.error('Calculate or close the material calculator before saving.');
      return;
    }
    const { errors: errs, ok } = validateAll(form, schema);
    if (!ok) {
      setErrors(errs);
      toast.error('Please fix the highlighted fields');
      document.getElementById(FIELD_IDS[Object.keys(errs)[0]])?.focus();
      return;
    }
    if (autoPrice && form.ratePerKg !== '' && form.ratePerKg != null && weight?.weightKg == null) {
      toast.error('Wait for a valid weight before saving the automatic purchase rate, or enter the rate manually.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      ['purchaseRate', 'ratePerKg', 'saleRate', 'gstRate', 'openingStock', 'minStock'].forEach((k) => {
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
  // The weight comes from the metal calculator on the server: one engine for
  // the calculator page and for every item, so they can never disagree.
  const [metals, setMetals] = useState([]);
  const [weight, setWeight] = useState(null);
  useEffect(() => {
    api.get('/metal-calculator/catalog')
      .then((r) => setMetals(r.data.metals || []))
      .catch(() => setMetals([]));
  }, []);
  useEffect(() => {
    const preview = appliedPreview.current;
    appliedPreview.current = null;
    if (preview && preview.size === form.size && preview.metal === form.metal && preview.name === form.name) {
      setWeight(preview.data);
      return undefined;
    }
    setWeight(null);
    if (!form.size) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      api.post('/items/weight-preview', { size: form.size, name: form.name, metal: form.metal || null, shape: form.shape || null })
        .then((r) => !cancelled && setWeight(r.data))
        .catch(() => !cancelled && setWeight(null));
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.size, form.name, form.metal, form.shape]);

  const computedRate = weight?.weightKg != null && form.ratePerKg !== '' && form.ratePerKg != null && Number.isFinite(Number(form.ratePerKg)) && Number(form.ratePerKg) >= 0 && !schema.ratePerKg(form.ratePerKg)
    ? new Decimal(weight.weightKg).times(form.ratePerKg).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
    : null;

  useEffect(() => {
    if (autoPrice && computedRate != null) {
      const price = computedRate.toFixed(2);
      setForm((f) => f.purchaseRate === price ? f : { ...f, purchaseRate: price });
      setErrors((e) => e.purchaseRate ? { ...e, purchaseRate: undefined } : e);
    }
  }, [autoPrice, computedRate]);

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
            <FormField id="item-size" label="Material Size" hint="As written on the stock sheet / drawing, e.g. OD 60 X 5 mtr.">
              <input id="item-size" className={errCls('size')} value={form.size || ''} onChange={(e) => set('size', e.target.value)} />
              <button type="button" className="mt-2 text-sm font-semibold text-brand-700 hover:underline" aria-expanded={showSizeCalculator} onClick={() => { if (!showSizeCalculator) setCalculatorSeed(weight); setShowSizeCalculator((v) => !v); }}>
                {showSizeCalculator ? 'Close calculator' : 'Calculate material size'}
              </button>
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
            <FormField id="item-category" label="Category" hint={categoryFromShape ? 'Set from the material shape you calculated — change it if that is wrong' : undefined}>
              <SearchableSelect
                id="item-category"
                value={form.categoryId}
                onChange={(v) => { setCategoryFromShape(false); set('categoryId', v); }}
                options={categoryOptions}
                placeholder="Select category…"
                emptyText="No matching categories"
              />
            </FormField>
          </div>
          {showSizeCalculator && <div className="mt-4"><MetalCalculatorPage embedded initialMetal={form.metal} initialSize={form.size || ''} initialShape={form.shape || ''} initialParsed={calculatorSeed} initialRatePerKg={form.ratePerKg} onApply={(size, metal, ratePerKg, preview, shapeId) => {
            appliedPreview.current = { size, metal, name: form.name, data: preview };
            setForm((f) => {
              const rate = ratePerKg ?? f.ratePerKg;
              const validRate = rate !== '' && rate != null && !schema.ratePerKg(rate);
              const purchaseRate = validRate && preview.weightKg != null
                ? new Decimal(preview.weightKg).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
                : f.purchaseRate;
              // The shape already says what kind of material this is, and this
              // plant's categories are those kinds. Fill it only when empty --
              // a category someone chose is theirs -- and only with one that
              // exists here.
              const suggested = f.categoryId ? null : categoryIdForShape(preview.shape, lookups.categories);
              if (suggested) setCategoryFromShape(true);
              return { ...f, size, shape: shapeId || null, metal, ratePerKg: rate, purchaseRate, categoryId: suggested || f.categoryId };
            });
            setErrors((e) => ({ ...e, size: undefined, metal: undefined, ratePerKg: undefined, purchaseRate: undefined }));
            setWeight(preview);
            setAutoPrice(true);
            setShowSizeCalculator(false);
          }} /></div>}
        </FormSection>

        <FormSection icon={Tag} title="Pricing & Stock" description="Default rates pulled into documents, plus stock thresholds">
          {/* weight comes from the size with the plant's own formulas; rate per
              kg then gives the purchase rate — one tap, never silently */}
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
            {weight?.weightKg != null ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-slate-700">
                  Weight <span className="font-semibold tabular-nums">{weight.weightKg} kg</span>
                  <span className="ml-1 text-xs text-slate-400">
                    ({form.metal} · read as {weight.shape}{weight.note ? `, ${weight.note}` : ''})
                  </span>
                </span>
                {computedRate != null && (
                  <>
                    <span className="text-slate-700" title="Calculated from the saved weight rounded to 3 decimals and rate per kg">
                      × ₹{form.ratePerKg}/kg = <span className="font-semibold tabular-nums">₹{computedRate.toFixed(2)}</span>
                    </span>
                    <span className="text-xs text-slate-500">Uses weight rounded to 3 decimals; calculator total may differ slightly.</span>
                    {!autoPrice && <button type="button" className={`${styles.secondaryBtn} !h-8 !px-3 text-xs`} onClick={() => { setAutoPrice(true); set('purchaseRate', computedRate.toFixed(2)); }}>Use as purchase rate</button>}
                    {autoPrice && <span className="text-xs font-medium text-brand-700">Purchase rate updates automatically</span>}
                  </>
                )}
              </div>
            ) : (
              <span className="text-slate-500">
                {!form.size ? 'Enter a material size above to calculate the weight.'
                  : weight?.reason === 'metal-missing' ? 'Pick the metal below — density is what turns the size into a weight.'
                    : weight?.reason === 'size-unreadable' ? 'This size could not be read. Use the material size calculator or enter a supported stock-sheet size.'
                      : 'Weight cannot be calculated for this size yet.'}
              </span>
            )}
          </div>
          <div className={styles.formGrid3}>
            {/* While the calculator is open it owns the metal and the rate —
                it needs both to compute, and it writes them back on Calculate.
                Showing a second pair here put two controls for one value on the
                same screen, and they disagreed: the calculator read "Steel"
                while this field still said "not set". */}
            {!showSizeCalculator && (
              <FormField id="item-metal" label="Metal" hint="Density for the weight — same catalogue as the Metal Calculator">
                <select id="item-metal" className={errCls('metal')} value={form.metal || ''} onChange={(e) => set('metal', e.target.value)}>
                  <option value="">— not set —</option>
                  {metals.map((m) => <option key={m.name} value={m.name}>{m.name} ({m.density} g/cm³)</option>)}
                </select>
              </FormField>
            )}
            {!showSizeCalculator && (
              <FormField id="item-rate-per-kg" label="Rate per kg" hint="₹ — used with the weight above" error={errors.ratePerKg}>
                <input id="item-rate-per-kg" type="number" step="0.01" min="0" className={errCls('ratePerKg')} value={form.ratePerKg ?? ''} onChange={(e) => set('ratePerKg', e.target.value)} onBlur={() => blur('ratePerKg')} aria-invalid={!!errors.ratePerKg} />
              </FormField>
            )}
            {showSizeCalculator && (
              <div className="sm:col-span-2 self-center rounded-lg border border-dashed border-brand-200 bg-brand-50/60 px-3 py-2.5 text-sm text-slate-600">
                Metal and rate per kg are set in the material size calculator above.
              </div>
            )}
            <FormField id="item-purchase-rate" label="Purchase Rate" hint={autoPrice ? "₹ per piece — calculated from weight × rate/kg; edit to override" : "₹ per unit — enter manually or use the calculated rate above"} error={errors.purchaseRate}>
              <input id="item-purchase-rate" type="number" step="0.01" min="0" className={errCls('purchaseRate')} value={form.purchaseRate ?? ''} onChange={(e) => { setAutoPrice(false); set('purchaseRate', e.target.value); }} onBlur={() => blur('purchaseRate')} aria-invalid={!!errors.purchaseRate} />
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

          {showSizeCalculator && <p className="mt-3 text-xs text-slate-500">Calculate or close the material calculator before saving.</p>}
          <div className={styles.actionsBar}>
            <button type="button" className={styles.ghostBtn} onClick={() => navigate('/items')}>Cancel</button>
            <button type="submit" className={styles.primaryBtn} disabled={saving || showSizeCalculator}>
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </FormSection>
      </form>
    </div>
  );
}
