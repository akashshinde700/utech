import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft, Save, Loader2, Factory, Package } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { positiveNumber, required, validateAll } from '../../lib/validation';
import { todayLocal } from '../../lib/format';
import toast from 'react-hot-toast';

const newLine = () => ({ itemId: '', description: '', qtySent: 1, rate: '', notes: '' });

// untouched rows are skipped by validation but still go out in the payload
// exactly like before — a fully blank row never errors
const lineInPlay = (l) =>
  !!(l.itemId || (l.description || '').trim() || String(l.rate ?? '').trim() !== '' || (l.notes || '').trim());

export default function JobworkForm() {
  const navigate = useNavigate();
  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [customerLots, setCustomerLots] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    date: todayLocal(),
    partyId: '', notes: '',
    materialOwnerType: 'COMPANY', customerMaterialLotId: '', expectedReturnDate: '',
    lines: [newLine()],
  });
  const isCustomerOwned = form.materialOwnerType === 'CUSTOMER';

  useEffect(() => {
    // party.type is exact-match server-side (VENDOR misses BOTH-type parties) —
    // a pre-existing gap, not fixed here, just not repeated for the lot fetch below.
    api.get('/parties', { params: { type: 'VENDOR', pageSize: 100 } }).then((r) => setParties(r.data.items));
    api.get('/items', { params: { pageSize: 200 } }).then((r) => setItems(r.data.items));
  }, []);

  useEffect(() => {
    if (!isCustomerOwned) return;
    api.get('/customer-material', { params: { activeOnly: 1, pageSize: 200 } }).then((r) => setCustomerLots(r.data.items));
  }, [isCustomerOwned]);

  const vendorOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
    [parties]
  );
  const lotOptions = useMemo(
    () => customerLots.map((l) => ({
      value: l.id,
      label: `${l.inwardNumber} — ${l.materialDescription}`,
      subtitle: `Available: ${Number(l.availableQty)}`,
    })),
    [customerLots]
  );
  const itemOptions = useMemo(
    () => items.map((it) => ({ value: it.id, label: `${it.code} — ${it.name}` })),
    [items]
  );

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function setOwnerType(v) {
    setForm((f) => ({ ...f, materialOwnerType: v, customerMaterialLotId: '' }));
    setErrors({});
  }

  function setLine(i, key, value) {
    setForm((f) => {
      const lines = [...f.lines];
      lines[i] = { ...lines[i], [key]: value };
      return { ...f, lines };
    });
    setErrors((e) => {
      const lineErrs = e.lines?.[i];
      if (!lineErrs || !(key in lineErrs)) return e;
      const nextLine = { ...lineErrs };
      delete nextLine[key];
      const nextLines = { ...e.lines };
      if (Object.keys(nextLine).length) nextLines[i] = nextLine;
      else delete nextLines[i];
      return { ...e, lines: nextLines };
    });
  }

  function focusFirstError(errs) {
    const firstKey = Object.keys(errs)[0];
    if (!firstKey) return;
    if (firstKey === 'lines') {
      const li = Object.keys(errs.lines)[0];
      const le = errs.lines[li];
      const key = Object.keys(le)[0];
      document.getElementById(`jw-line-${li}-${key}`)?.focus();
      return;
    }
    document.getElementById(`jw-${firstKey}`)?.focus();
  }

  async function save(e) {
    e.preventDefault();
    const { errors: fieldErrors, ok } = validateAll(form, {
      date: (v) => required(v, 'Date'),
      partyId: (v) => required(v, 'Vendor'),
      customerMaterialLotId: (v, all) => (all.materialOwnerType === 'CUSTOMER' ? required(v, 'Customer material lot') : null),
    });
    const nextErrors = { ...fieldErrors };

    const lineErrs = {};
    form.lines.forEach((l, i) => {
      if (!lineInPlay(l)) return;
      const le = {};
      if (isCustomerOwned) {
        if (!(l.description || '').trim()) le.description = required(l.description, 'Description');
      } else if (!l.itemId) {
        le.itemId = required(l.itemId, 'Item');
      }
      const qtyErr = positiveNumber(l.qtySent, 'Qty');
      if (qtyErr) le.qtySent = qtyErr;
      const rate = String(l.rate ?? '').trim();
      if (rate !== '') {
        const rateErr = positiveNumber(rate, 'Rate');
        if (rateErr) le.rate = rateErr;
      }
      if (Object.keys(le).length) lineErrs[i] = le;
    });
    if (Object.keys(lineErrs).length) nextErrors.lines = lineErrs;

    if (!ok || Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      focusFirstError(nextErrors);
      return;
    }
    setErrors({});

    setSaving(true);
    try {
      const payload = {
        ...form, partyId: Number(form.partyId),
        customerMaterialLotId: isCustomerOwned && form.customerMaterialLotId ? Number(form.customerMaterialLotId) : null,
        expectedReturnDate: form.expectedReturnDate || null,
        lines: form.lines.map((l) => ({
          itemId: isCustomerOwned ? null : (l.itemId ? Number(l.itemId) : null),
          description: isCustomerOwned ? (l.description || null) : null,
          qtySent: Number(l.qtySent),
          rate: l.rate ? Number(l.rate) : null,
          notes: l.notes || null,
        })),
      };
      await api.post('/jobwork', payload);
      toast.success('Saved'); navigate('/jobwork');
    } catch {} finally {
      setSaving(false);
    }
  }

  const lineError = (i, key) => errors.lines?.[i]?.[key] || null;

  return (
    <div>
      <PageHeader
        title="New jobwork challan"
        subtitle={isCustomerOwned ? 'Customer material sent to vendor — customer stock is adjusted, company stock untouched' : 'Material sent out — auto stock OUT'}
      />
      <form onSubmit={save} noValidate className="max-w-5xl space-y-5">
        <FormSection
          icon={Factory}
          title="Challan Details"
          description={isCustomerOwned ? 'Customer-owned material going out for processing' : 'Company material going out to the vendor'}
        >
          <div className="flex flex-wrap gap-1.5 mb-4">
            {[{ v: 'COMPANY', l: 'Company Material' }, { v: 'CUSTOMER', l: 'Customer Material' }].map((o) => (
              <button
                key={o.v} type="button"
                onClick={() => setOwnerType(o.v)}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${form.materialOwnerType === o.v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
              >
                {o.l}
              </button>
            ))}
          </div>
          <div className={styles.formGrid3}>
            <FormField id="jw-date" label="Date" required error={errors.date}>
              <input
                id="jw-date"
                type="date"
                className={`${styles.input} ${errors.date ? styles.inputError : ''}`}
                aria-invalid={!!errors.date}
                aria-describedby={errors.date ? 'jw-date-error' : undefined}
                value={form.date}
                onChange={(e) => setField('date', e.target.value)}
              />
            </FormField>
            <FormField
              id="jw-partyId"
              label="Vendor"
              required
              error={errors.partyId}
              hint="Only parties saved as Vendor can be selected."
              className="sm:col-span-2"
            >
              <SearchableSelect
                id="jw-partyId"
                value={form.partyId}
                onChange={(v) => setField('partyId', v)}
                options={vendorOptions}
                placeholder="Select vendor…"
                error={errors.partyId}
              />
            </FormField>
            {isCustomerOwned && (
              <FormField
                id="jw-customerMaterialLotId"
                label="Customer Material Lot"
                required
                error={errors.customerMaterialLotId}
                className="sm:col-span-2"
              >
                <SearchableSelect
                  id="jw-customerMaterialLotId"
                  value={form.customerMaterialLotId}
                  onChange={(v) => setField('customerMaterialLotId', v)}
                  options={lotOptions}
                  placeholder="Select lot…"
                  error={errors.customerMaterialLotId}
                />
              </FormField>
            )}
            <FormField id="jw-expectedReturnDate" label="Expected Return" hint="When the vendor should send material back.">
              <input
                id="jw-expectedReturnDate"
                type="date"
                className={styles.input}
                value={form.expectedReturnDate}
                onChange={(e) => setField('expectedReturnDate', e.target.value)}
              />
            </FormField>
            <FormField id="jw-notes" label="Notes" className="sm:col-span-2 lg:col-span-3">
              <textarea
                id="jw-notes"
                rows={2}
                className={styles.textarea}
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={Package}
          title={isCustomerOwned ? 'Material Sent' : 'Items'}
          description={isCustomerOwned ? 'Describe each customer-owned piece going out' : 'Catalog items going out — stock is deducted automatically'}
          actions={
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setForm({ ...form, lines: [...form.lines, newLine()] })}
            >
              <Plus className="w-4 h-4" /> Add line
            </button>
          }
        >
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead><tr><th className="table-th rounded-tl-lg min-w-[14rem]">{isCustomerOwned ? 'Description' : 'Item'}</th><th className="table-th min-w-[6rem]">Qty</th><th className="table-th min-w-[7rem]">Rate</th><th className="table-th min-w-[9rem]">Notes</th><th className="table-th w-10 rounded-tr-lg"></th></tr></thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                    <td className="table-td">
                      {isCustomerOwned ? (
                        <>
                          <input
                            id={`jw-line-${i}-description`}
                            aria-label={`Line ${i + 1} description`}
                            className={`${styles.input} !h-9 !text-xs ${lineError(i, 'description') ? styles.inputError : ''}`}
                            aria-invalid={!!lineError(i, 'description')}
                            aria-describedby={lineError(i, 'description') ? `jw-line-${i}-description-error` : undefined}
                            placeholder="e.g. Steel bar - plating"
                            value={l.description}
                            onChange={(e) => setLine(i, 'description', e.target.value)}
                          />
                          {lineError(i, 'description') && (
                            <p id={`jw-line-${i}-description-error`} role="alert" className={styles.errorText}>{lineError(i, 'description')}</p>
                          )}
                        </>
                      ) : (
                        <>
                          <SearchableSelect
                            id={`jw-line-${i}-itemId`}
                            value={l.itemId}
                            onChange={(v) => setLine(i, 'itemId', v)}
                            options={itemOptions}
                            placeholder="— select item —"
                            error={lineError(i, 'itemId')}
                          />
                          {lineError(i, 'itemId') && (
                            <p role="alert" className={styles.errorText}>{lineError(i, 'itemId')}</p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="table-td">
                      <input
                        id={`jw-line-${i}-qtySent`}
                        aria-label={`Line ${i + 1} quantity`}
                        type="number"
                        step="0.001"
                        min="0"
                        className={`${styles.input} !h-9 !text-xs tabular-nums w-24 ${lineError(i, 'qtySent') ? styles.inputError : ''}`}
                        aria-invalid={!!lineError(i, 'qtySent')}
                        aria-describedby={lineError(i, 'qtySent') ? `jw-line-${i}-qtySent-error` : undefined}
                        value={l.qtySent}
                        onChange={(e) => setLine(i, 'qtySent', e.target.value)}
                      />
                      {lineError(i, 'qtySent') && (
                        <p id={`jw-line-${i}-qtySent-error`} role="alert" className={styles.errorText}>{lineError(i, 'qtySent')}</p>
                      )}
                    </td>
                    <td className="table-td">
                      <input
                        id={`jw-line-${i}-rate`}
                        aria-label={`Line ${i + 1} rate`}
                        type="number"
                        step="0.01"
                        min="0"
                        className={`${styles.input} !h-9 !text-xs tabular-nums w-28 ${lineError(i, 'rate') ? styles.inputError : ''}`}
                        aria-invalid={!!lineError(i, 'rate')}
                        aria-describedby={lineError(i, 'rate') ? `jw-line-${i}-rate-error` : undefined}
                        value={l.rate}
                        onChange={(e) => setLine(i, 'rate', e.target.value)}
                      />
                      {lineError(i, 'rate') && (
                        <p id={`jw-line-${i}-rate-error`} role="alert" className={styles.errorText}>{lineError(i, 'rate')}</p>
                      )}
                    </td>
                    <td className="table-td">
                      <input
                        aria-label={`Line ${i + 1} notes`}
                        className={`${styles.input} !h-9 !text-xs min-w-[9rem]`}
                        value={l.notes || ''}
                        onChange={(e) => setLine(i, 'notes', e.target.value)}
                      />
                    </td>
                    <td className="table-td">
                      <button
                        type="button"
                        className="btn-danger !px-2 !py-0.5"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() => setForm({ ...form, lines: form.lines.filter((_, ix) => ix !== i) })}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>

        <div className={styles.actionsBar}>
          <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/jobwork')}>
            <ArrowLeft className="w-4 h-4" /> Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
