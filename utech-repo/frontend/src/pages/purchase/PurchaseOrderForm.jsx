import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft, Save, ShoppingCart, ListPlus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, gstRate, validateAll } from '../../lib/validation';
import { inr } from '../../lib/format';
import toast from 'react-hot-toast';

const newLine = () => ({ itemId: '', description: '', qty: 1, rate: 0, gstRate: 18 });

function focusFirstError(errors) {
  const key = Object.keys(errors)[0];
  if (!key) return;
  const el = document.getElementById(key);
  if (el) {
    el.focus?.();
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
}

export default function PurchaseOrderForm() {
  const navigate = useNavigate();
  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    expectedDate: '', partyId: '', notes: '',
    lines: [newLine()],
  });

  useEffect(() => {
    api.get('/parties', { params: { type: 'VENDOR', pageSize: 100 } }).then((r) => setParties(r.data.items));
    api.get('/items', { params: { pageSize: 200 } }).then((r) => setItems(r.data.items));
  }, []);

  const totals = useMemo(() => {
    let st = 0, gst = 0;
    for (const l of form.lines) {
      const a = Number(l.qty || 0) * Number(l.rate || 0);
      st += a;
      gst += a * Number(l.gstRate || 0) / 100;
    }
    return { subtotal: st, gst, total: st + gst };
  }, [form]);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  const show = (k) => (submitted && errors[k] ? errors[k] : null);

  function setLine(i, k, v) {
    setForm((f) => {
      const ls = [...f.lines]; ls[i] = { ...ls[i], [k]: v };
      if (k === 'itemId') {
        const it = items.find((x) => x.id === Number(v));
        if (it) {
          ls[i].description = it.name;
          ls[i].rate = Number(it.purchaseRate || it.saleRate || 0);
          ls[i].gstRate = Number(it.gstRate || 18);
        }
      }
      return { ...f, lines: ls };
    });
    setErrors((e) => {
      const qk = `line-${i}-qty`, gk = `line-${i}-gstRate`;
      if (!e[qk] && !e[gk]) return e;
      const next = { ...e };
      delete next[qk]; delete next[gk];
      return next;
    });
  }

  function removeLine(i) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, ix) => ix !== i) }));
  }

  function validate() {
    const headerErrors = validateAll(form, {
      partyId: (v) => required(v, 'Vendor'),
    });
    const all = { ...headerErrors.errors };
    if (!form.lines.some((l) => l.itemId)) {
      all.lines = 'Add at least one line with an item';
    }
    form.lines.forEach((l, i) => {
      if (!l.itemId) return; // empty lines are dropped on save, as before
      const qMsg = positiveNumber(l.qty, 'Qty');
      if (qMsg) all[`line-${i}-qty`] = qMsg;
      const gMsg = gstRate(l.gstRate);
      if (gMsg) all[`line-${i}-gstRate`] = gMsg;
    });
    return all;
  }

  async function save(e) {
    e.preventDefault();
    setSubmitted(true);
    const all = validate();
    if (Object.keys(all).length) {
      setErrors(all);
      toast.error('Please fix the highlighted fields');
      focusFirstError(all);
      return;
    }
    setSaving(true);
    try {
      await api.post('/purchase-orders', {
        date: form.date,
        expectedDate: form.expectedDate || null,
        partyId: Number(form.partyId),
        notes: form.notes || null,
        lines: form.lines.filter((l) => l.itemId).map((l) => ({
          itemId: Number(l.itemId),
          description: l.description || null,
          qty: Number(l.qty),
          rate: Number(l.rate),
          gstRate: Number(l.gstRate),
        })),
      });
      toast.success('Purchase order saved');
      navigate('/purchase-orders');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save purchase order');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="New Purchase Order" subtitle="Will go to PENDING_APPROVAL" />
      <form onSubmit={save} className="max-w-5xl space-y-5">
        <FormSection icon={ShoppingCart} title="PO Details" description="Vendor, dates and reference notes">
          <div className={styles.formGrid}>
            <FormField id="date" label="Date" required error={show('date')} htmlFor="date">
              <input id="date" type="date" className={styles.input} value={form.date} onChange={(e) => set('date', e.target.value)} />
            </FormField>
            <FormField id="expectedDate" label="Expected Delivery" error={show('expectedDate')} htmlFor="expectedDate">
              <input id="expectedDate" type="date" className={styles.input} value={form.expectedDate} onChange={(e) => set('expectedDate', e.target.value)} />
            </FormField>
            <FormField id="partyId" label="Vendor" required error={show('partyId')} htmlFor="partyId" className="sm:col-span-2">
              <SearchableSelect
                id="partyId"
                value={form.partyId}
                onChange={(v) => set('partyId', v)}
                options={parties.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}`, subtitle: p.phone || undefined }))}
                placeholder="Select vendor…"
                error={show('partyId')}
                emptyText="No vendors match"
              />
            </FormField>
            <FormField id="notes" label="Notes" error={show('notes')} htmlFor="notes" className="sm:col-span-2">
              <textarea id="notes" rows={2} className={styles.textarea} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={ListPlus} title="Item Lines" description="What you are ordering — picking an item fills rate and GST%">
          {form.lines.length === 0 ? (
            <EmptyState
              icon={ListPlus}
              title="No lines yet"
              description="Add a line for each item on this purchase order."
              action={{ label: 'Add line', onClick: () => setForm((f) => ({ ...f, lines: [...f.lines, newLine()] })), icon: Plus }}
            />
          ) : (
            <div className="rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Item</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
                    <th className="w-24 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Qty</th>
                    <th className="w-28 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</th>
                    <th className="w-20 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">GST%</th>
                    <th className="w-28 px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                    <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {form.lines.map((l, i) => {
                    const qtyErr = errors[`line-${i}-qty`] && submitted ? errors[`line-${i}-qty`] : null;
                    const gstErr = errors[`line-${i}-gstRate`] && submitted ? errors[`line-${i}-gstRate`] : null;
                    const amt = Number(l.qty || 0) * Number(l.rate || 0);
                    return (
                      <tr key={i} className="align-top">
                        <td className="px-2 py-2">
                          <SearchableSelect
                            id={`line-${i}-item`}
                            value={l.itemId}
                            onChange={(v) => setLine(i, 'itemId', v)}
                            options={items.map((it) => ({ value: it.id, label: `${it.code} — ${it.name}` }))}
                            placeholder="Select item…"
                            emptyText="No items match"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input aria-label={`Line ${i + 1} description`} className={styles.input} value={l.description || ''} onChange={(e) => setLine(i, 'description', e.target.value)} />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            id={`line-${i}-qty`} type="number" step="0.001"
                            className={`${styles.input} text-right ${qtyErr ? styles.inputError : ''}`}
                            aria-invalid={!!qtyErr}
                            aria-describedby={qtyErr ? `line-${i}-qty-error` : undefined}
                            value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)}
                          />
                          {qtyErr && <p id={`line-${i}-qty-error`} role="alert" className={styles.errorText}>{qtyErr}</p>}
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" step="0.01" aria-label={`Line ${i + 1} rate`} className={`${styles.input} text-right tabular-nums`} value={l.rate} onChange={(e) => setLine(i, 'rate', e.target.value)} />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            id={`line-${i}-gstRate`} type="number" step="0.01"
                            className={`${styles.input} text-right ${gstErr ? styles.inputError : ''}`}
                            aria-invalid={!!gstErr}
                            aria-describedby={gstErr ? `line-${i}-gstRate-error` : undefined}
                            value={l.gstRate} onChange={(e) => setLine(i, 'gstRate', e.target.value)}
                          />
                          {gstErr && <p id={`line-${i}-gstRate-error`} role="alert" className={styles.errorText}>{gstErr}</p>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-700">{inr(amt)}</td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button" aria-label={`Remove line ${i + 1}`}
                            className={`${styles.ghostBtn} !px-2 text-danger-500 hover:bg-danger-50 hover:text-danger-600`}
                            onClick={() => removeLine(i)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 rounded-b-lg border-t border-dashed border-slate-300 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-brand-600"
                onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, newLine()] }))}
              >
                <Plus className="h-4 w-4" /> Add line
              </button>
            </div>
          )}
          {submitted && errors.lines && (
            <p role="alert" className={`${styles.errorText} justify-center`}>{errors.lines}</p>
          )}

          <div className="ml-auto mt-4 max-w-sm rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span className="font-mono tabular-nums">{inr(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span>GST</span><span className="font-mono tabular-nums">{inr(totals.gst)}</span></div>
            <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span className="font-mono tabular-nums">{inr(totals.total)}</span></div>
          </div>
        </FormSection>

        <div className={styles.actionsBar}>
          <button type="button" className={styles.ghostBtn} onClick={() => navigate('/purchase-orders')}>
            <ArrowLeft className="h-4 w-4" /> Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
