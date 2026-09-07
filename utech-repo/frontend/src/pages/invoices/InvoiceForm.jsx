import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Calculator, ListPlus, Loader2, Plus, ReceiptText, Save, StickyNote, Trash2,
} from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { gstRate, positiveNumber, required, validateAll } from '../../lib/validation';
import { inr, todayLocal } from '../../lib/format';
import toast from 'react-hot-toast';

const newLine = () => ({
  itemId: '', description: '', hsnCode: '', qty: 1, rate: 0, gstRate: 18,
});

// discount may be empty (= 0) but never negative / non-numeric
function nonNegative(v, label) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return `${label} must be 0 or more`;
  return null;
}

const schema = {
  date: (v) => required(v, 'Date'),
  partyId: (v) => required(v, 'Party'),
  discount: (v) => nonNegative(v, 'Discount'),
};

export default function InvoiceForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState([]);
  const [form, setForm] = useState({
    date: todayLocal(),
    dueDate: '', partyId: '', isIntraState: true, discount: 0, notes: '', termsText: '',
    lines: [newLine()],
  });

  useEffect(() => {
    api.get('/parties', { params: { pageSize: 100 } }).then((r) => setParties(r.data.items));
    api.get('/items', { params: { pageSize: 200 } }).then((r) => setItems(r.data.items));
  }, []);

  useEffect(() => {
    if (!id) return;
    api.get(`/invoices/${id}`).then((r) => {
      const inv = r.data;
      setForm({
        date: inv.date.slice(0, 10),
        dueDate: inv.dueDate ? inv.dueDate.slice(0, 10) : '',
        partyId: inv.partyId,
        isIntraState: Number(inv.cgst) > 0,
        discount: Number(inv.discount || 0),
        notes: inv.notes || '',
        termsText: inv.termsText || '',
        lines: inv.lines.map((l) => ({
          itemId: l.itemId || '',
          description: l.description, hsnCode: l.hsnCode || '',
          qty: Number(l.qty), rate: Number(l.rate), gstRate: Number(l.gstRate),
        })),
      });
    });
  }, [id]);

  // mirrors backend utils/gst.js: a header discount reduces the TAXABLE value
  // (spread proportionally across lines); GST is charged on the net, and the
  // grand total is rounded to the nearest rupee.
  const totals = useMemo(() => {
    let subtotal = 0;
    for (const l of form.lines) subtotal += Number(l.qty || 0) * Number(l.rate || 0);
    subtotal = Math.round(subtotal * 100) / 100;
    const disc = Math.min(Number(form.discount || 0), subtotal);
    const keep = subtotal > 0 ? (subtotal - disc) / subtotal : 1;
    let gst = 0;
    for (const l of form.lines) {
      const net = Number(l.qty || 0) * Number(l.rate || 0) * keep;
      gst += (net * Number(l.gstRate || 0)) / 100;
    }
    gst = Math.round(gst * 100) / 100;
    const cgst = form.isIntraState ? Math.round((gst / 2) * 100) / 100 : 0;
    const sgst = form.isIntraState ? Math.round((gst - cgst) * 100) / 100 : 0;
    const igst = form.isIntraState ? 0 : gst;
    const taxable = Math.round((subtotal - disc) * 100) / 100;
    const exact = Math.round((taxable + cgst + sgst + igst) * 100) / 100;
    const total = Math.round(exact);
    return { subtotal, taxable, cgst, sgst, igst, roundOff: Math.round((total - exact) * 100) / 100, total };
  }, [form]);

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    // clear the field's error as soon as its value changes
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  function setLine(i, k, v) {
    const lines = [...form.lines];
    lines[i] = { ...lines[i], [k]: v };
    if (k === 'itemId') {
      const it = items.find((x) => x.id === Number(v));
      if (it) {
        lines[i].description = it.name;
        lines[i].hsnCode = it.hsnCode || '';
        lines[i].rate = Number(it.saleRate || 0);
        lines[i].gstRate = Number(it.gstRate || 18);
      }
    }
    setForm({ ...form, lines });
    // clear the line's error as soon as the offending value is fixed
    setLineErrors((prev) => {
      if (!prev[i]?.[k]) return prev;
      const next = [...prev];
      next[i] = { ...next[i], [k]: undefined };
      return next;
    });
  }

  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, newLine()] }));
    setLineErrors((prev) => [...prev, {}]);
  }
  function removeLine(i) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, ix) => ix !== i) }));
    setLineErrors((prev) => prev.filter((_, ix) => ix !== i));
  }

  const partyOptions = parties.map((p) => ({
    value: p.id,
    label: `${p.code} — ${p.name}`,
    subtitle: p.gstin ? `GSTIN ${p.gstin}` : p.phone || undefined,
  }));
  const itemOptions = items.map((it) => ({
    value: it.id,
    label: `${it.code} — ${it.name}`,
    subtitle: it.hsnCode ? `HSN ${it.hsnCode}` : undefined,
  }));

  async function save(e) {
    e.preventDefault();
    const { errors: errs, ok } = validateAll(form, schema);
    const lErrs = form.lines.map((l) => ({
      description: required(l.description, 'Description'),
      qty: positiveNumber(l.qty, 'Qty'),
      rate: positiveNumber(l.rate, 'Rate'),
      gstRate: gstRate(l.gstRate),
    }));
    if (!ok || lErrs.some((le) => le.description || le.qty || le.rate || le.gstRate)) {
      setErrors(errs);
      setLineErrors(lErrs);
      toast.error('Please fix the highlighted fields');
      return;
    }
    if (form.lines.length === 0 || form.lines.every((l) => !l.itemId)) {
      toast.error('Please add at least one line item');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        partyId: Number(form.partyId),
        dueDate: form.dueDate || null,
        discount: Number(form.discount || 0),
        lines: form.lines.map((l) => ({
          ...l,
          itemId: l.itemId ? Number(l.itemId) : null,
          qty: Number(l.qty), rate: Number(l.rate), gstRate: Number(l.gstRate),
        })),
      };
      if (id) await api.put(`/invoices/${id}`, payload);
      else await api.post('/invoices', payload);
      toast.success('Saved successfully');
      navigate('/invoices');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title={id ? 'Edit invoice' : 'New invoice'} />

      <form onSubmit={save} noValidate className="max-w-6xl space-y-5">
        <FormSection icon={ReceiptText} title="Invoice Details" description="Party, dates and GST treatment">
          <div className={styles.formGrid}>
            <FormField id="invoice-date" label="Date" required error={errors.date}>
              <input
                id="invoice-date"
                type="date"
                className={`${styles.input} ${errors.date ? styles.inputError : ''}`}
                value={form.date}
                onChange={(e) => setField('date', e.target.value)}
                aria-invalid={!!errors.date}
              />
            </FormField>
            <FormField id="invoice-due-date" label="Due Date">
              <input
                id="invoice-due-date"
                type="date"
                className={styles.input}
                value={form.dueDate}
                onChange={(e) => setField('dueDate', e.target.value)}
              />
            </FormField>
            <FormField id="invoice-party" label="Party" required error={errors.partyId} className="sm:col-span-2">
              <SearchableSelect
                id="invoice-party"
                value={form.partyId}
                onChange={(v) => setField('partyId', v)}
                options={partyOptions}
                placeholder="Select party…"
                emptyText="No matching parties"
              />
            </FormField>
            <FormField id="invoice-gst-type" label="GST Type" className="sm:col-span-2" hint="Auto-set from the customer's GSTIN state when available; otherwise use this">
              <div className="flex flex-wrap gap-4 pt-1.5 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="gst-type"
                    className="h-4 w-4 accent-brand-600"
                    checked={form.isIntraState}
                    onChange={() => setField('isIntraState', true)}
                  />
                  Intra-state (CGST + SGST)
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="gst-type"
                    className="h-4 w-4 accent-brand-600"
                    checked={!form.isIntraState}
                    onChange={() => setField('isIntraState', false)}
                  />
                  Inter-state (IGST)
                </label>
              </div>
            </FormField>
            <FormField id="invoice-discount" label="Discount" hint="₹ off the taxable value — GST is charged on the net" error={errors.discount}>
              <input
                id="invoice-discount"
                type="number"
                step="0.01"
                min="0"
                className={`${styles.input} ${errors.discount ? styles.inputError : ''}`}
                value={form.discount}
                onChange={(e) => setField('discount', e.target.value)}
                aria-invalid={!!errors.discount}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={ListPlus}
          title="Line Items"
          description="Pick an item to prefill description, rate and GST — or leave the item blank for a manual line"
          actions={
            <button type="button" className="btn-secondary text-sm" onClick={addLine}>
              <Plus className="w-4 h-4" /> Add line
            </button>
          }
        >
          {/* wide table on desktop, stacked cards on tablet/phone */}
          <div className="overflow-x-auto scroll-x-hint hidden lg:block">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th rounded-tl-lg min-w-[200px]">Item</th>
                  <th className="table-th">Description</th>
                  <th className="table-th w-24">HSN</th>
                  <th className="table-th w-24">Qty</th>
                  <th className="table-th w-28">Rate</th>
                  <th className="table-th w-20">GST%</th>
                  <th className="table-th w-32 text-right">Amount</th>
                  <th className="table-th w-10 rounded-tr-lg"></th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l, i) => {
                  const amount = Number(l.qty || 0) * Number(l.rate || 0);
                  return (
                    <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                      <td className="table-td">
                        <FormField error={lineErrors[i]?.itemId}>
                          <SearchableSelect
                            value={l.itemId}
                            onChange={(v) => setLine(i, 'itemId', v)}
                            options={itemOptions}
                            placeholder="— manual —"
                            emptyText="No matching items"
                            error={lineErrors[i]?.itemId}
                          />
                        </FormField>
                      </td>
                      <td className="table-td">
                        <FormField error={lineErrors[i]?.description}>
                          <input
                            className={`${styles.input} ${lineErrors[i]?.description ? styles.inputError : ''}`}
                            value={l.description}
                            onChange={(e) => setLine(i, 'description', e.target.value)}
                            aria-invalid={!!lineErrors[i]?.description}
                          />
                        </FormField>
                      </td>
                      <td className="table-td">
                        <input className={styles.input} value={l.hsnCode || ''} onChange={(e) => setLine(i, 'hsnCode', e.target.value)} />
                      </td>
                      <td className="table-td">
                        <FormField error={lineErrors[i]?.qty}>
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            className={`${styles.input} ${lineErrors[i]?.qty ? styles.inputError : ''}`}
                            value={l.qty}
                            onChange={(e) => setLine(i, 'qty', e.target.value)}
                            aria-invalid={!!lineErrors[i]?.qty}
                          />
                        </FormField>
                      </td>
                      <td className="table-td">
                        <FormField error={lineErrors[i]?.rate}>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className={`${styles.input} ${lineErrors[i]?.rate ? styles.inputError : ''}`}
                            value={l.rate}
                            onChange={(e) => setLine(i, 'rate', e.target.value)}
                            aria-invalid={!!lineErrors[i]?.rate}
                          />
                        </FormField>
                      </td>
                      <td className="table-td">
                        <FormField error={lineErrors[i]?.gstRate}>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="28"
                            className={`${styles.input} ${lineErrors[i]?.gstRate ? styles.inputError : ''}`}
                            value={l.gstRate}
                            onChange={(e) => setLine(i, 'gstRate', e.target.value)}
                            aria-invalid={!!lineErrors[i]?.gstRate}
                          />
                        </FormField>
                      </td>
                      <td className="table-td text-right font-medium">{inr(amount)}</td>
                      <td className="table-td">
                        <button
                          type="button"
                          className="btn-icon text-danger-600 hover:bg-danger-50"
                          onClick={() => removeLine(i)}
                          aria-label={`Remove line ${i + 1}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* tablet / phone: one card per line, fields stacked */}
          <div className="space-y-3 lg:hidden">
            {form.lines.map((l, i) => {
              const amount = Number(l.qty || 0) * Number(l.rate || 0);
              return (
                <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">Line {i + 1}</span>
                    <button
                      type="button"
                      className="btn-icon text-danger-600 hover:bg-danger-50"
                      onClick={() => removeLine(i)}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <FormField label="Item" error={lineErrors[i]?.itemId}>
                    <SearchableSelect
                      value={l.itemId}
                      onChange={(v) => setLine(i, 'itemId', v)}
                      options={itemOptions}
                      placeholder="— manual —"
                      emptyText="No matching items"
                      error={lineErrors[i]?.itemId}
                    />
                  </FormField>
                  <FormField label="Description" error={lineErrors[i]?.description}>
                    <input
                      className={`${styles.input} ${lineErrors[i]?.description ? styles.inputError : ''}`}
                      value={l.description}
                      onChange={(e) => setLine(i, 'description', e.target.value)}
                      aria-invalid={!!lineErrors[i]?.description}
                    />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="HSN">
                      <input className={styles.input} value={l.hsnCode || ''} onChange={(e) => setLine(i, 'hsnCode', e.target.value)} />
                    </FormField>
                    <FormField label="Qty" error={lineErrors[i]?.qty}>
                      <input
                        type="number" step="0.001" min="0" inputMode="decimal"
                        className={`${styles.input} ${lineErrors[i]?.qty ? styles.inputError : ''}`}
                        value={l.qty}
                        onChange={(e) => setLine(i, 'qty', e.target.value)}
                        aria-invalid={!!lineErrors[i]?.qty}
                      />
                    </FormField>
                    <FormField label="Rate" error={lineErrors[i]?.rate}>
                      <input
                        type="number" step="0.01" min="0" inputMode="decimal"
                        className={`${styles.input} ${lineErrors[i]?.rate ? styles.inputError : ''}`}
                        value={l.rate}
                        onChange={(e) => setLine(i, 'rate', e.target.value)}
                        aria-invalid={!!lineErrors[i]?.rate}
                      />
                    </FormField>
                    <FormField label="GST %" error={lineErrors[i]?.gstRate}>
                      <input
                        type="number" step="0.01" min="0" max="28" inputMode="decimal"
                        className={`${styles.input} ${lineErrors[i]?.gstRate ? styles.inputError : ''}`}
                        value={l.gstRate}
                        onChange={(e) => setLine(i, 'gstRate', e.target.value)}
                        aria-invalid={!!lineErrors[i]?.gstRate}
                      />
                    </FormField>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-sm">
                    <span className="text-slate-500">Amount</span>
                    <span className="font-semibold tabular-nums">{inr(amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </FormSection>

        <FormSection icon={StickyNote} title="Notes & Terms" description="Printed on the invoice below the line items">
          <div className={styles.formGrid}>
            <FormField id="invoice-notes" label="Notes">
              <textarea id="invoice-notes" rows={3} className={styles.textarea} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
            </FormField>
            <FormField id="invoice-terms" label="Terms">
              <textarea id="invoice-terms" rows={3} className={styles.textarea} value={form.termsText} onChange={(e) => setField('termsText', e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={Calculator} title="Summary" description="Totals are calculated from the line items">
          <div className="ml-auto max-w-sm space-y-1 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">{inr(totals.subtotal)}</span></div>
            {Number(form.discount) > 0 && (
              <>
                <div className="flex justify-between"><span className="text-slate-500">Discount</span><span className="font-medium text-danger-600">- {inr(form.discount)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Taxable Value</span><span className="font-medium">{inr(totals.taxable)}</span></div>
              </>
            )}
            {form.isIntraState ? (
              <>
                <div className="flex justify-between"><span className="text-slate-500">CGST</span><span className="font-medium">{inr(totals.cgst)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">SGST</span><span className="font-medium">{inr(totals.sgst)}</span></div>
              </>
            ) : (
              <div className="flex justify-between"><span className="text-slate-500">IGST</span><span className="font-medium">{inr(totals.igst)}</span></div>
            )}
            {Number(totals.roundOff) !== 0 && (
              <div className="flex justify-between"><span className="text-slate-500">Round Off</span><span className="font-medium">{totals.roundOff > 0 ? '+ ' : '- '}{inr(Math.abs(totals.roundOff))}</span></div>
            )}
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 font-bold text-base"><span>Total</span><span>{inr(totals.total)}</span></div>
          </div>

          <div className={styles.actionsBar}>
            <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/invoices')}>
              <ArrowLeft className="h-4 w-4" /> Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Save className="h-4 w-4" />} {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </FormSection>
      </form>
    </div>
  );
}
