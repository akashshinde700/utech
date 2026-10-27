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
import useRemoteOptions from '../../lib/useRemoteOptions';
import toast from 'react-hot-toast';

const emptyLine = () => ({ itemId: '', description: '', poLineId: '', qty: 0, qtyAccepted: 0, qtyRejected: 0, rate: '', notes: '', _autoAccepted: true });

const outstandingLines = (po) => po.lines
  .filter((l) => Number(l.qty) > Number(l.qtyReceived))
  .map((l) => ({
    itemId: l.itemId || '', description: l.description || '', poLineId: l.id,
    qty: Number(l.qty) - Number(l.qtyReceived),
    qtyAccepted: Number(l.qty) - Number(l.qtyReceived), qtyRejected: 0,
    rate: Number(l.rate), notes: '', _autoAccepted: true,
  }));

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

  const { items: parties, search: searchParties, error: partyLookupError, include: includeParties } = useRemoteOptions('/parties', { type: 'VENDOR' });
  const { items, search: searchItems, error: itemLookupError, include: includeItems } = useRemoteOptions('/items');
  const { items: pos, search: searchPOs, error: poLookupError } = useRemoteOptions('/purchase-orders', { status: 'APPROVED,PARTIALLY_RECEIVED,RECEIVED' });
  const [urlPoOption, setUrlPoOption] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    date: todayLocal(),
    poId: poIdParam || '', partyId: '', vehicleNo: '', notes: '',
    lines: [emptyLine()],
  });


  // if poId given, prefill from PO
  useEffect(() => {
    if (!poIdParam) return;
    api.get(`/purchase-orders/${poIdParam}`).then((r) => {
      const po = r.data;
      includeParties([po.party]);
      includeItems(po.lines.map((line) => line.item));
      setUrlPoOption({ value: po.id, label: po.number ? `${po.number}` : `PO #${po.id}` });
      setForm((f) => ({
        ...f,
        partyId: po.partyId,
        lines: outstandingLines(po),
      }));
    });
  }, [poIdParam, includeParties, includeItems]);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  const show = (k) => (submitted && errors[k] ? errors[k] : null);

  function setLine(i, patch) {
    setForm((f) => {
      const ls = [...f.lines];
      const previous = ls[i];
      const next = { ...previous, ...patch };
      if ('qtyAccepted' in patch) next._autoAccepted = false;
      if (previous._autoAccepted && ('qty' in patch || 'qtyRejected' in patch)) {
        next.qtyAccepted = Math.max(0, Number(next.qty || 0) - Number(next.qtyRejected || 0));
      }
      ls[i] = next;
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
    if (!form.lines.length) all.lines = 'Add at least one outstanding item';
    form.lines.forEach((l, i) => {
      if (!l.itemId && !l.description) all[`line-${i}-item`] = 'Select an item';
      const msg = positiveNumber(l.qty, 'Qty');
      if (msg) all[`line-${i}-qty`] = msg;
      const accepted = Number(l.qtyAccepted), rejected = Number(l.qtyRejected), qty = Number(l.qty);
      if (!Number.isFinite(accepted) || !Number.isFinite(rejected) || accepted < 0 || rejected < 0 || accepted + rejected > qty) {
        all[`line-${i}-qty`] = 'Accepted + rejected must not exceed received quantity';
      }
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
          itemId: l.itemId ? Number(l.itemId) : null,
          description: l.description || null,
          poLineId: l.poLineId ? Number(l.poLineId) : null,
          qty: Number(l.qty),
          qtyAccepted: Number(l.qtyAccepted),
          qtyRejected: Number(l.qtyRejected),
          rate: l.rate === '' || l.rate == null ? null : Number(l.rate),
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
      <PageHeader title="New GRN" subtitle="Only the accepted quantity is added to company stock on save" />
      <form onSubmit={save} className="max-w-5xl space-y-5">
        {(partyLookupError || itemLookupError || poLookupError) && <p role="alert" className="text-sm text-danger-700">Search could not be loaded. Check the connection and try searching again.</p>}
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
                onSearchChange={searchPOs}
                onChange={(v) => {
                  set('poId', v);
                  if (v && !poIdParam) {
                    api.get(`/purchase-orders/${v}`).then((r) => {
                      const po = r.data;
                      includeParties([po.party]);
                      includeItems(po.lines.map((line) => line.item));
                      setForm((f) => ({
                        ...f,
                        poId: v,
                        partyId: po.partyId,
                        lines: outstandingLines(po),
                      }));
                    }).catch(() => {});
                  }
                  if (!v && !poIdParam) setForm((f) => ({ ...f, poId: '', lines: [emptyLine()] }));
                }}
                allowClear={!poIdParam}
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
                onSearchChange={searchParties}
                onChange={(v) => set('partyId', v)}
                options={parties.map((p) => ({ value: p.id, label: p.code ? `${p.code} — ${p.name}` : p.name, subtitle: p.phone || undefined }))}
                placeholder="Select vendor…"
                disabled={!!form.poId}
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
              description={form.poId ? 'No outstanding lines on this purchase order.' : 'Add a line for each item received in this consignment.'}
              action={!form.poId ? { label: 'Add line', onClick: () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] })), icon: Plus } : undefined}
            />
          ) : (
            <div className="rounded-lg border border-slate-200">
              <div className="rounded-t-lg overflow-x-auto">
                <table className="min-w-[720px] w-full text-sm">
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
                            {l.poLineId && !l.itemId ? (
                              <span className="block min-w-[150px] py-2 text-sm text-slate-700">{l.description || 'Vendor-made part'} <span className="block text-xs text-slate-500">No catalog stock</span></span>
                            ) : (
                              <SearchableSelect
                                id={`line-${i}-item`}
                                value={l.itemId}
                                onChange={(v) => setLine(i, { itemId: v })}
                                options={items.map((it) => ({ value: it.id, label: `${it.code} — ${it.name}` }))}
                                onSearchChange={searchItems}
                                placeholder="Select item…"
                                disabled={!!l.poLineId}
                                error={show(`line-${i}-item`)}
                                emptyText="No items match"
                              />
                            )}
                            {show(`line-${i}-item`) && <p role="alert" className={styles.errorText}>{show(`line-${i}-item`)}</p>}
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
              {!form.poId && <button
                type="button"
                className="flex w-full items-center justify-center gap-1.5 rounded-b-lg border-t border-dashed border-slate-300 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-brand-600"
                onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}
              >
                <Plus className="h-4 w-4" /> Add line
              </button>}
            </div>
          )}
          {submitted && errors.lines && <p role="alert" className={styles.errorText}>{errors.lines}</p>}
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
