import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, X, Plus, Trash2, Loader2, Package } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, validateAll } from '../../lib/validation';
import toast from 'react-hot-toast';

const emptyForm = { code: '', name: '', finishedItemId: '', notes: '' };

export default function BomForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState(emptyForm);

  async function loadAllItems() {
    const { data } = await api.get('/items', { params: { pageSize: 1000 } });
    setAllItems(data.items || []);
  }

  async function loadBom() {
    if (!id) return;
    const { data } = await api.get(`/boms/${id}`);
    setFormData({
      code: data.code,
      name: data.name,
      finishedItemId: data.finishedItemId || '',
      notes: data.notes || '',
    });
    setItems(data.items || []);
  }

  useEffect(() => { loadAllItems(); if (id) loadBom(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const itemOptions = allItems.map((i) => ({ value: i.id, label: `${i.code} — ${i.name}`, subtitle: i.uomCode || undefined }));

  function setField(key, value) {
    setFormData((f) => ({ ...f, [key]: value }));
    setErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  function addItem() {
    setItems([...items, { itemId: '', qty: '', uomCode: '', notes: '' }]);
  }

  function updateItem(index, field, value) {
    const updated = [...items];
    updated[index][field] = value;
    setItems(updated);
  }

  function removeItem(index) {
    setItems(items.filter((_, i) => i !== index));
  }

  // per-row errors: `item_${idx}` / `qty_${idx}`
  function rowError(key) {
    return errors[key] || null;
  }

  function clearRowError(key) {
    setErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const schema = {
      code: (v) => required(v, 'Code'),
      name: (v) => required(v, 'Name'),
    };
    items.forEach((item, idx) => {
      schema[`item_${idx}`] = () => required(item.itemId, 'Component item');
      schema[`qty_${idx}`] = () => positiveNumber(item.qty, 'Quantity');
    });
    const { errors: nextErrors, ok } = validateAll(formData, schema);
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...formData,
        finishedItemId: formData.finishedItemId ? parseInt(formData.finishedItemId) : null,
        items: items.map((i) => ({
          ...i,
          itemId: parseInt(i.itemId),
          qty: parseFloat(i.qty),
        })),
      };
      if (isEdit) {
        await api.put(`/boms/${id}`, payload);
      } else {
        await api.post('/boms', payload);
      }
      toast.success(isEdit ? 'BOM updated' : 'BOM created');
      navigate('/boms');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error saving BOM');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit BOM' : 'New BOM'}
        subtitle="Component recipe for a finished item"
        action={
          <button onClick={() => navigate('/boms')} className={styles.secondaryBtn}>
            <X className="h-4 w-4" aria-hidden="true" /> Cancel
          </button>
        }
      />
      <form onSubmit={handleSubmit} className="max-w-5xl space-y-5" noValidate>
        <FormSection icon={Package} title="BOM Details" description="The finished item this recipe produces">
          <div className={styles.formGrid}>
            <FormField id="bom-code" label="Code" required error={errors.code}>
              <input
                id="bom-code"
                className={`${styles.input} ${errors.code ? styles.inputError : ''}`}
                aria-invalid={!!errors.code}
                aria-describedby={errors.code ? 'bom-code-error' : undefined}
                value={formData.code}
                onChange={(e) => setField('code', e.target.value)}
              />
            </FormField>
            <FormField id="bom-name" label="Name" required error={errors.name}>
              <input
                id="bom-name"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'bom-name-error' : undefined}
                value={formData.name}
                onChange={(e) => setField('name', e.target.value)}
              />
            </FormField>
            <FormField id="bom-finished-item" label="Finished Item" hint="Item produced by this BOM" className="sm:col-span-2">
              <SearchableSelect
                id="bom-finished-item"
                value={formData.finishedItemId}
                onChange={(v) => setField('finishedItemId', v)}
                options={itemOptions}
                placeholder="Select finished item…"
              />
            </FormField>
            <FormField id="bom-notes" label="Notes" className="sm:col-span-2">
              <textarea
                id="bom-notes"
                className={styles.textarea}
                rows={2}
                value={formData.notes}
                onChange={(e) => setField('notes', e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={Plus}
          title="Components"
          description="Raw materials and quantities consumed per unit"
          actions={
            <button type="button" onClick={addItem} className={styles.secondaryBtn}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add Component
            </button>
          }
        >
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">No components added yet — click “Add Component” to build the recipe.</p>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium text-slate-400 sm:grid">
                <div className="col-span-5">Item</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">UoM</div>
                <div className="col-span-2">Notes</div>
                <div className="col-span-1" />
              </div>
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-start">
                  <div className="sm:col-span-5">
                    <SearchableSelect
                      id={`bom-item-${idx}`}
                      value={item.itemId}
                      onChange={(v) => { updateItem(idx, 'itemId', v); clearRowError(`item_${idx}`); }}
                      options={itemOptions}
                      placeholder="Select item…"
                      error={rowError(`item_${idx}`)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      aria-label={`Quantity for component ${idx + 1}`}
                      className={`${styles.input} tabular-nums ${rowError(`qty_${idx}`) ? styles.inputError : ''}`}
                      type="number"
                      step="0.001"
                      placeholder="Qty"
                      value={item.qty}
                      onChange={(e) => { updateItem(idx, 'qty', e.target.value); clearRowError(`qty_${idx}`); }}
                    />
                    {rowError(`qty_${idx}`) && <p className={styles.errorText}>{rowError(`qty_${idx}`)}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      aria-label={`UoM for component ${idx + 1}`}
                      className={styles.input}
                      placeholder="UoM"
                      value={item.uomCode}
                      onChange={(e) => updateItem(idx, 'uomCode', e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      aria-label={`Notes for component ${idx + 1}`}
                      className={styles.input}
                      placeholder="Notes"
                      value={item.notes}
                      onChange={(e) => updateItem(idx, 'notes', e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <button type="button" onClick={() => removeItem(idx)} className="btn-icon text-danger-600 hover:bg-danger-50" aria-label={`Remove component ${idx + 1}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.actionsBar}>
            <button type="button" onClick={() => navigate('/boms')} className={styles.secondaryBtn}>Cancel</button>
            <button type="submit" disabled={saving} className={styles.primaryBtn}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save BOM'}
            </button>
          </div>
        </FormSection>
      </form>
    </div>
  );
}
