import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft, Save, PackageCheck, ListPlus } from 'lucide-react';
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

const emptyLine = () => ({ itemId: '', poLineId: '', qty: 0, qtyAccepted: 0, qtyRejected: 0, rate: '', notes: '' });

function focusFirstError(errors) {
  const key = Object.keys(errors)[0];
  if (!key) return;
  const el = document.getElementById(key);
  if (el) {
    el.focus?.();
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
}

export default function GRNForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const poIdParam = params.get('poId');

  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [pos, setPos] = useState([]);
  const [urlPoOption, setUrlPoOption] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    date: todayLocal(),
    poId: poIdParam || '', partyId: '', vehicleNo: '', notes: '',
    lines: [emptyLine()],
  });

  useEffect(() => {
    api.get('/parties', { params: { type: 'VENDOR', pageSize: 100 } }).then((r) => setParties(r.data.items));
    api.get('/items', { params: { pageSize: 200 } }).then((r) => setItems(r.data.items));
    // POs open for receiving (mirrors the statuses the GRN endpoint accepts)
    api.get('/purchase-orders', { params: { status: 'APPROVED,PARTIALLY_RECEIVED,RECEIVED', pageSize: 100 } })
      .then((r) => setPos(r.data.items))
      .catch(() => {});
  }, []);

  // if poId given, prefill from PO
  useEffect(() => {
    if (!poIdParam) return;
    api.get(`/purchase-orders/${poIdParam}`).then((r) => {
      const po = r.data;
      setUrlPoOption({ value: po.id, label: po.number ? `${po.number}` : `PO #${po.id}` });
      setForm((f) => ({
        ...f,
        partyId: po.partyId,
        lines: po.lines.map((l) => ({
          itemId: l.itemId,
          poLineId: l.id,
          qty: Number(l.qty) - Number(l.qtyReceived),
          qtyAccepted: Number(l.qty) - Number(l.qtyReceived),
          qtyRejected: 0,
          rate: Number(l.rate),
          notes: '',
        })),
      }));
    });
  }, [poIdParam]);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  const show = (k) => (submitted && errors[k] ? errors[k] : null);

  function setLine(i, patch) {
    setForm((f) => {
      const ls = [...f.lines];
      ls[i] = { ...ls[i], ...patch };
      return { ...f, lines: ls };
    });
    setErrors((e) => {
      const qtyKey = `line-${i}-qty`;
      if (!e[qtyKey]) return e;
      const next = { ...e };
      delete next[qtyKey];
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
    form.lines.forEach((l, i) => {
      const msg = positiveNumber(l.qty, 'Qty');
      if (msg) all[`line-${i}-qty`] = msg;
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
      await api.post('/grns', {
        ...form,
        poId: form.poId ? Number(form.poId) : null,
        partyId: form.partyId ? Number(form.partyId) : null,
        lines: form.lines.map((l) => ({
          itemId: Number(l.itemId),
          poLineId: l.poLineId ? Number(l.poLineId) : null,
          qty: Number(l.qty),
          qtyAccepted: Number(l.qtyAccepted),
          qtyRejected: Number(l.qtyRejected),
          rate: l.rate ? Number(l.rate) : null,
          notes: l.notes || null,
        })),
      });
      toast.success('GRN saved');
      navigate('/grns');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save GRN');
    } finally {
      setSaving(false);
    }
  }

  const poOptions = [
    ...(urlPoOption ? [urlPoOption] : []),
    ...pos
      .filter((p) => !urlPoOption || String(p.id) !== String(urlPoOption.value))
      .map((p) => ({ value: p.id, label: `${p.number}`, subtitle: p.party?.name })),
  ];

  return (
    <div>
      <PageHeader title="New GRN" subtitle="Stock will be added on save" />
      <form onSubmit={save} className="max-w-5xl space-y-5">
        <FormSection icon={PackageCheck} title="Receipt Details" description="Where the goods came from and when they arrived">
          <div className={styles.formGrid}>
            <FormField id="date" label="Date" required error={show('date')} htmlFor="date">
              <input
                id="date" type="date" className={styles.input} value={form.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </FormField>
            <FormField id="poId" label="Purchase Order" hint="Selecting a PO prefills its outstanding lines"
              error={show('poId')} htmlFor="poId">
              <SearchableSelect
                id="poId"
                value={form.poId}
                onChange={(v) => {
                  set('poId', v);
                  if (v && !poIdParam) {
                    api.get(`/purchase-orders/${v}`).then((r) => {
                      const po = r.data;
                      setForm((f) => ({
                        ...f,
                        poId: v,
                        partyId: f.partyId || po.partyId,
                        lines: po.lines.map((l) => ({
                          itemId: l.itemId,
                          poLineId: l.id,
                          qty: Number(l.qty) - Number(l.qtyReceived),
                          qtyAccepted: Number(l.qty) - Number(l.qtyReceived),
                          qtyRejected: 0,
                          rate: Number(l.rate),
                          notes: '',
                        })),
                      }));
                    }).catch(() => {});
                  }
                }}
                options={poOptions}
                placeholder="Select PO…"
                disabled={!!poIdParam}
                emptyText="No open purchase orders"
              />
            </FormField>
            <FormField id="vehicleNo" label="Vehicle No" error={show('vehicleNo')} htmlFor="vehicleNo">
              <input
                id="vehicleNo" className={styles.input} value={form.vehicleNo}
                onChange={(e) => set('vehicleNo', e.target.value)}
              />
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
          </div>
        </FormSection>

        <FormSection icon={ListPlus} title="Item Lines" description="Quantities received, accepted and rejected">
          {form.lines.length === 0 ? (
            <EmptyState
              icon={ListPlus}
              title="No lines yet"
              description="Add a line for each item received in this consignment."
              action={{ label: 'Add line', onClick: () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] })), icon: Plus }}
            />
          ) : (
            <div className="rounded-lg border border-slate-200">
              <div className="rounded-t-lg">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/50">
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Item</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-24">Qty</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-24">Accepted</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-24">Rejected</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-28">Rate</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                      <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {form.lines.map((l, i) => {
                      const qtyErr = errors[`line-${i}-qty`] && submitted ? errors[`line-${i}-qty`] : null;
                      return (
                        <tr key={i} className="align-top">
                          <td className="px-2 py-2">
                            <SearchableSelect
                              id={`line-${i}-item`}
                              value={l.itemId}
                              onChange={(v) => setLine(i, { itemId: v })}
                              options={items.map((it) => ({ value: it.id, label: `${it.code} — ${it.name}` }))}
                              placeholder="Select item…"
                              emptyText="No items match"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              id={`line-${i}-qty`} type="number" step="0.001"
                              className={`${styles.input} text-right ${qtyErr ? styles.inputError : ''}`}
                              aria-invalid={!!qtyErr}
                              aria-describedby={qtyErr ? `line-${i}-qty-error` : undefined}
                              value={l.qty}
                              onChange={(e) => setLine(i, { qty: e.target.value })}
                            />
                            {qtyErr && <p id={`line-${i}-qty-error`} role="alert" className={styles.errorText}>{qtyErr}</p>}
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" step="0.001" aria-label={`Line ${i + 1} accepted quantity`}
                              className={`${styles.input} text-right`} value={l.qtyAccepted}
                              onChange={(e) => setLine(i, { qtyAccepted: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" step="0.001" aria-label={`Line ${i + 1} rejected quantity`}
                              className={`${styles.input} text-right`} value={l.qtyRejected}
                              onChange={(e) => setLine(i, { qtyRejected: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" step="0.01" aria-label={`Line ${i + 1} rate`}
                              className={`${styles.input} text-right tabular-nums`} value={l.rate}
                              onChange={(e) => setLine(i, { rate: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              aria-label={`Line ${i + 1} notes`}
                              className={styles.input} value={l.notes || ''}
                              onChange={(e) => setLine(i, { notes: e.target.value })}
                            />
                          </td>
                          <td className="px-2 py-2 text-right">
                            <button
                              type="button"
                              aria-label={`Remove line ${i + 1}`}
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
              </div>
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
          <button type="button" className={styles.ghostBtn} onClick={() => navigate('/grns')}>
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
