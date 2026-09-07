import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Truck, Package, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, validateAll } from '../../lib/validation';
import { todayLocal } from '../../lib/format';
import toast from 'react-hot-toast';

const emptyLine = () => ({ itemId: '', qty: 1, uomCode: '', notes: '' });

function focusFirstError(errors) {
  const key = Object.keys(errors)[0];
  if (!key) return;
  const el = document.getElementById(key);
  if (el) {
    el.focus?.();
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
}

export default function DispatchForm() {
  const navigate = useNavigate();
  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    date: todayLocal(),
    partyId: '', vehicleNo: '', driverName: '', driverPhone: '', ewayBillNo: '', notes: '',
    lines: [emptyLine()],
  });

  useEffect(() => {
    api.get('/parties', { params: { pageSize: 100 } }).then((r) => setParties(r.data.items));
    api.get('/items', { params: { pageSize: 200 } }).then((r) => setItems(r.data.items));
  }, []);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  function setLine(i, patch) {
    setForm((f) => {
      const ls = [...f.lines];
      ls[i] = { ...ls[i], ...patch };
      return { ...f, lines: ls };
    });
    setErrors((e) => {
      const ik = `line-${i}-itemId`, qk = `line-${i}-qty`;
      if (!e[ik] && !e[qk]) return e;
      const next = { ...e };
      delete next[ik]; delete next[qk];
      return next;
    });
  }

  function validate() {
    const { errors: all } = validateAll(form, {
      partyId: (v) => required(v, 'Customer'),
      date: (v) => required(v, 'Date'),
    });
    form.lines.forEach((l, i) => {
      const itemMsg = required(l.itemId, 'Item');
      if (itemMsg) all[`line-${i}-itemId`] = itemMsg;
      const qtyMsg = positiveNumber(l.qty, 'Qty');
      if (qtyMsg) all[`line-${i}-qty`] = qtyMsg;
    });
    return all;
  }

  async function save(e) {
    e.preventDefault();
    const all = validate();
    if (Object.keys(all).length) {
      setErrors(all);
      toast.error('Please fix the highlighted fields');
      focusFirstError(all);
      return;
    }
    setSaving(true);
    try {
      await api.post('/dispatch', {
        ...form, partyId: Number(form.partyId),
        lines: form.lines.map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty), uomCode: l.uomCode || null, notes: l.notes || null })),
      });
      toast.success('Dispatch challan saved');
      navigate('/dispatch');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save dispatch');
    } finally {
      setSaving(false);
    }
  }

  const itemOptions = items.map((it) => ({
    value: it.id,
    label: `${it.code} — ${it.name}`,
    subtitle: it.uom?.code ? `${Number(it.currentStock)} ${it.uom.code} in stock` : `${Number(it.currentStock)} in stock`,
  }));

  return (
    <div>
      <PageHeader title="New dispatch challan" subtitle="Goods being shipped — auto stock OUT" />
      <form onSubmit={save} className="max-w-5xl space-y-5">
        <FormSection icon={Truck} title="Dispatch Details" description="Who the goods ship to and who carries them">
          <div className={styles.formGrid4}>
            <FormField id="date" label="Date" required error={errors.date || null} htmlFor="date">
              <input
                id="date" type="date" className={styles.input} value={form.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </FormField>
            <FormField id="partyId" label="Customer" required error={errors.partyId || null} htmlFor="partyId" className="sm:col-span-2 lg:col-span-3">
              <SearchableSelect
                id="partyId"
                value={form.partyId}
                onChange={(v) => set('partyId', v)}
                options={parties.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}`, subtitle: p.phone || undefined }))}
                placeholder="Select customer…"
                error={errors.partyId || null}
                emptyText="No parties match"
              />
            </FormField>
            <FormField id="vehicleNo" label="Vehicle No" htmlFor="vehicleNo">
              <input id="vehicleNo" className={styles.input} value={form.vehicleNo} onChange={(e) => set('vehicleNo', e.target.value)} />
            </FormField>
            <FormField id="driverName" label="Driver Name" htmlFor="driverName">
              <input id="driverName" className={styles.input} value={form.driverName} onChange={(e) => set('driverName', e.target.value)} />
            </FormField>
            <FormField id="driverPhone" label="Driver Phone" hint="10-digit mobile" htmlFor="driverPhone">
              <input id="driverPhone" inputMode="tel" className={styles.input} value={form.driverPhone} onChange={(e) => set('driverPhone', e.target.value)} />
            </FormField>
            <FormField id="ewayBillNo" label="E-way Bill No" htmlFor="ewayBillNo">
              <input id="ewayBillNo" className={styles.input} value={form.ewayBillNo} onChange={(e) => set('ewayBillNo', e.target.value)} />
            </FormField>
            <FormField id="notes" label="Notes" htmlFor="notes" className="sm:col-span-2 lg:col-span-4">
              <textarea id="notes" rows={2} className={styles.textarea} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={Package} title="Items" description="Picking an item fills its stock level and unit">
          {form.lines.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No lines yet"
              description="Add a line for each item on this challan."
              action={{ label: 'Add line', onClick: () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] })), icon: Plus }}
            />
          ) : (
            <div className="rounded-lg border border-slate-200">
              <div className="hidden grid-cols-12 gap-2 border-b border-slate-100 bg-slate-50/50 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid">
                <div className="col-span-5">Item</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">UoM</div>
                <div className="col-span-2">Notes</div>
                <div className="w-10"><span className="sr-only">Remove</span></div>
              </div>
              {form.lines.map((l, i) => {
                const itemErr = errors[`line-${i}-itemId`] || null;
                const qtyErr = errors[`line-${i}-qty`] || null;
                return (
                  <div key={i} className="grid grid-cols-1 gap-2 border-b border-slate-100 px-2 py-2 last:border-b-0 sm:grid-cols-12 sm:items-start">
                    <div className="sm:col-span-5">
                      <SearchableSelect
                        id={`line-${i}-item`}
                        value={l.itemId}
                        onChange={(v) => {
                          const it = items.find((x) => String(x.id) === String(v));
                          setLine(i, { itemId: v, uomCode: it?.uom?.code || l.uomCode });
                        }}
                        options={itemOptions}
                        placeholder="Select item…"
                        error={itemErr}
                        emptyText="No items match"
                      />
                      {itemErr && <p id={`line-${i}-item-error`} role="alert" className={styles.errorText}>{itemErr}</p>}
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        id={`line-${i}-qty`} type="number" step="0.001" placeholder="Qty"
                        className={`${styles.input} text-right ${qtyErr ? styles.inputError : ''}`}
                        aria-invalid={!!qtyErr}
                        aria-describedby={qtyErr ? `line-${i}-qty-error` : undefined}
                        value={l.qty}
                        onChange={(e) => setLine(i, { qty: e.target.value })}
                      />
                      {qtyErr && <p id={`line-${i}-qty-error`} role="alert" className={styles.errorText}>{qtyErr}</p>}
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        aria-label={`Line ${i + 1} unit of measure`} placeholder="UoM"
                        className={styles.input} value={l.uomCode || ''}
                        onChange={(e) => setLine(i, { uomCode: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        aria-label={`Line ${i + 1} notes`} placeholder="Notes"
                        className={styles.input} value={l.notes || ''}
                        onChange={(e) => setLine(i, { notes: e.target.value })}
                      />
                    </div>
                    <div className="sm:w-10">
                      <button
                        type="button"
                        aria-label={`Remove line ${i + 1}`}
                        className={`${styles.ghostBtn} !px-2 text-danger-500 hover:bg-danger-50 hover:text-danger-600`}
                        onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, ix) => ix !== i) }))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 rounded-b-lg border-t border-dashed border-slate-300 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-brand-600"
                onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}
              >
                <Plus className="h-4 w-4" /> Add line
              </button>
            </div>
          )}
        </FormSection>

        <div className={styles.actionsBar}>
          <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/dispatch')}>Cancel</button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
