import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft, Save, Factory, FileText, ListPlus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { required } from '../../lib/validation';
import { inr } from '../../lib/format';
import toast from 'react-hot-toast';

const newLine = () => ({
  itemId: '',
  description: '',
  drawingNumber: '',
  partNumber: '',
  qtySent: '',
  uomCode: '',
  rate: '',
  gstRate: 18,
  notes: '',
});

const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const nullIfBlank = (v) => {
  const s = (v == null ? '' : String(v)).trim();
  return s === '' ? null : s;
};

// a line the user started filling must be completed before submit; a fully
// blank row is ignored (same outcome the old silent filter produced)
const lineInPlay = (l) =>
  !!(l.itemId || nullIfBlank(l.description) || String(l.qtySent ?? '').trim() !== '' ||
    nullIfBlank(l.drawingNumber) || nullIfBlank(l.partNumber) || nullIfBlank(l.rate) || nullIfBlank(l.uomCode));

function validateLine(l) {
  const errs = {};
  if (!l.itemId && !nullIfBlank(l.description)) errs.item = 'Pick an item or enter a description';
  const qty = String(l.qtySent ?? '').trim();
  if (!qty) errs.qtySent = 'Qty is required';
  else if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) errs.qtySent = 'Qty must be greater than 0';
  const rate = nullIfBlank(l.rate);
  if (rate !== null && (!Number.isFinite(Number(rate)) || Number(rate) < 0)) errs.rate = 'Rate must be 0 or more';
  const gst = nullIfBlank(l.gstRate);
  if (gst !== null && (!Number.isFinite(Number(gst)) || Number(gst) < 0 || Number(gst) > 100)) errs.gstRate = 'GST% must be between 0 and 100';
  return errs;
}

export default function VendorWorkOrderForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = !!id;

  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [sourceAssignment, setSourceAssignment] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    partyId: '',
    date: new Date().toISOString().slice(0, 10),
    expectedReturnDate: '',
    scopeDescription: '',
    instructions: '',
    notes: '',
    lines: [newLine()],
  });

  const assignmentId = searchParams.get('assignmentId');

  useEffect(() => {
    api.get('/parties', { params: { type: 'VENDOR', pageSize: 200 } }).then((r) => setParties(r.data.items));
    api.get('/items', { params: { pageSize: 200 } }).then((r) => setItems(r.data.items));
  }, []);

  // starting from the assignment the department was given: show what is being
  // outsourced and seed the scope with the drawing/page it came from, so the
  // vendor record carries the same reference the shop floor is using
  useEffect(() => {
    if (isEdit || !assignmentId) return;
    api.get(`/assignments/${assignmentId}`).then((r) => {
      const a = r.data;
      setSourceAssignment(a);
      const pages = a.pageNumbers && a.pageNumbers.length ? ` (page ${a.pageNumbers.join(', ')})` : '';
      setForm((f) => ({
        ...f,
        scopeDescription: f.scopeDescription || `${a.attachment?.filename || 'Assigned document'}${pages}`,
        instructions: f.instructions || a.instructions || '',
        expectedReturnDate: f.expectedReturnDate || toDateInput(a.dueDate),
      }));
    });
  }, [assignmentId, isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/vendor-work-orders/${id}`).then((r) => {
      const v = r.data;
      if (v.status !== 'DRAFT') {
        toast.error('Only a draft work order can be edited');
        navigate(`/vendor-work-orders/${id}`);
        return;
      }
      setSourceAssignment(v.assignment || null);
      setForm({
        partyId: String(v.partyId),
        date: toDateInput(v.date),
        expectedReturnDate: toDateInput(v.expectedReturnDate),
        scopeDescription: v.scopeDescription || '',
        instructions: v.instructions || '',
        notes: v.notes || '',
        lines: v.lines.length
          ? v.lines.map((l) => ({
              itemId: l.itemId ? String(l.itemId) : '',
              description: l.description || '',
              drawingNumber: l.drawingNumber || '',
              partNumber: l.partNumber || '',
              qtySent: String(Number(l.qtySent)),
              uomCode: l.uomCode || '',
              rate: l.rate == null ? '' : String(Number(l.rate)),
              gstRate: Number(l.gstRate),
              notes: l.notes || '',
            }))
          : [newLine()],
      });
    });
  }, [id, isEdit, navigate]);

  const vendorOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}`, subtitle: p.phone || undefined })),
    [parties]
  );
  const itemOptions = useMemo(
    () => items.map((it) => ({ value: it.id, label: `${it.code} — ${it.name}`, subtitle: it.uomCode || undefined })),
    [items]
  );

  const estimate = useMemo(() => {
    let subtotal = 0;
    let gst = 0;
    for (const l of form.lines) {
      const amount = Number(l.qtySent || 0) * Number(l.rate || 0);
      subtotal += amount;
      gst += (amount * Number(l.gstRate || 0)) / 100;
    }
    return { subtotal, gst, total: subtotal + gst };
  }, [form.lines]);

  function clearError(key) {
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    clearError(key);
  }

  function setLine(i, key, value) {
    setForm((f) => {
      const lines = [...f.lines];
      lines[i] = { ...lines[i], [key]: value };
      if (key === 'itemId' && value) {
        const it = items.find((x) => x.id === Number(value));
        if (it) {
          lines[i].description = lines[i].description || it.name;
          lines[i].uomCode = lines[i].uomCode || it.uomCode || '';
          if (lines[i].gstRate == null || lines[i].gstRate === '') lines[i].gstRate = Number(it.gstRate || 18);
        }
      }
      return { ...f, lines };
    });
    setErrors((e) => {
      const lineErrs = e.lines?.[i];
      if (!lineErrs || !(key in lineErrs)) return e;
      const nextLine = { ...lineErrs };
      delete nextLine[key === 'itemId' || key === 'description' ? 'item' : key];
      const nextLines = { ...e.lines };
      if (Object.keys(nextLine).length) nextLines[i] = nextLine;
      else delete nextLines[i];
      return { ...e, lines: nextLines };
    });
  }

  function blurField(key) {
    if (key === 'partyId' && !form.partyId) setErrors((e) => ({ ...e, partyId: required(form.partyId, 'Vendor') }));
    if (key === 'date' && !form.date) setErrors((e) => ({ ...e, date: required(form.date, 'Raised on') }));
  }

  function focusFirstError(errs) {
    const firstKey = Object.keys(errs)[0];
    if (!firstKey) return;
    if (firstKey === 'lines') {
      const li = Object.keys(errs.lines)[0];
      const el = document.getElementById(`line-${li}-qty`);
      el?.focus();
      return;
    }
    const el = document.getElementById(firstKey);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  }

  async function save(e) {
    e.preventDefault();
    const nextErrors = {};
    if (!form.partyId) nextErrors.partyId = required(form.partyId, 'Vendor');
    if (!form.date) nextErrors.date = required(form.date, 'Raised on');
    const lineErrs = {};
    form.lines.forEach((l, i) => {
      if (lineInPlay(l)) {
        const le = validateLine(l);
        if (Object.keys(le).length) lineErrs[i] = le;
      }
    });
    if (Object.keys(lineErrs).length) nextErrors.lines = lineErrs;

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      focusFirstError(nextErrors);
      return;
    }
    setErrors({});

    // a line is valid with either a catalog item or a description — an
    // outsourced one-off part usually has no Item master row
    const lines = form.lines
      .filter(lineInPlay)
      .map((l) => ({
        itemId: l.itemId ? Number(l.itemId) : null,
        description: nullIfBlank(l.description),
        drawingNumber: nullIfBlank(l.drawingNumber),
        partNumber: nullIfBlank(l.partNumber),
        qtySent: Number(l.qtySent),
        uomCode: nullIfBlank(l.uomCode),
        rate: nullIfBlank(l.rate) === null ? null : Number(l.rate),
        gstRate: nullIfBlank(l.gstRate) === null ? 18 : Number(l.gstRate),
        notes: nullIfBlank(l.notes),
      }));
    if (!lines.length) {
      toast.error('Add at least one line with an item or description and a quantity');
      return;
    }

    const payload = {
      partyId: Number(form.partyId),
      date: form.date,
      expectedReturnDate: form.expectedReturnDate || null,
      scopeDescription: nullIfBlank(form.scopeDescription),
      instructions: nullIfBlank(form.instructions),
      notes: nullIfBlank(form.notes),
      lines,
    };
    // the server infers the project and department from the assignment, so it is
    // only sent on create
    if (!isEdit && assignmentId) payload.assignmentId = Number(assignmentId);

    setSaving(true);
    try {
      const { data } = isEdit
        ? await api.put(`/vendor-work-orders/${id}`, payload)
        : await api.post('/vendor-work-orders', payload);
      toast.success(isEdit ? 'Vendor work order saved' : 'Vendor work order created as a draft');
      navigate(`/vendor-work-orders/${data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save the vendor work order');
    } finally {
      setSaving(false);
    }
  }

  const lineError = (i, key) => errors.lines?.[i]?.[key] || null;

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Vendor Work Order' : 'New Vendor Work Order'}
        subtitle="Hand project scope to an external vendor — saved as a draft until you send it out"
      />

      <form onSubmit={save} className="max-w-6xl space-y-5">
        {sourceAssignment && (
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3">
            <div className="text-xs font-semibold text-brand-700 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Outsourcing work assigned to this department
            </div>
            <div className="text-sm text-slate-700 mt-1">
              {sourceAssignment.attachment?.filename}
              {sourceAssignment.pageNumbers && sourceAssignment.pageNumbers.length
                ? ` — page(s) ${sourceAssignment.pageNumbers.join(', ')}`
                : ' — whole document'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Assigned by {sourceAssignment.assignedBy?.name || '—'} to{' '}
              {sourceAssignment.assignedTo?.name || '—'}. The project and department are carried over
              automatically.
            </div>
          </div>
        )}

        <FormSection icon={Factory} title="Vendor & Schedule" description="Who the work goes to and when it is due back">
          <div className={styles.formGrid3}>
            <FormField
              id="partyId"
              label="Vendor"
              required
              hint="Only parties saved as Vendor or Both can be selected."
              error={errors.partyId}
              className="sm:col-span-2 lg:col-span-1"
            >
              <SearchableSelect
                id="partyId"
                value={form.partyId}
                onChange={(v) => setField('partyId', v)}
                options={vendorOptions}
                placeholder="Select vendor…"
                error={errors.partyId}
              />
            </FormField>
            <FormField id="date" label="Raised on" required error={errors.date}>
              <input
                id="date"
                type="date"
                className={`${styles.input} ${errors.date ? styles.inputError : ''}`}
                value={form.date}
                aria-invalid={!!errors.date}
                aria-describedby={errors.date ? 'date-error' : undefined}
                onChange={(e) => setField('date', e.target.value)}
                onBlur={() => blurField('date')}
              />
            </FormField>
            <FormField id="expectedReturnDate" label="Expected back by" hint="Drives the overdue-at-vendor warning.">
              <input
                id="expectedReturnDate"
                type="date"
                className={styles.input}
                value={form.expectedReturnDate}
                onChange={(e) => setField('expectedReturnDate', e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={FileText} title="Scope & Instructions" description="What the vendor is being asked to do">
          <div className="space-y-4">
            <FormField id="scopeDescription" label="Scope given to the vendor" className="sm:col-span-2">
              <textarea
                id="scopeDescription"
                className={styles.textarea}
                rows={2}
                placeholder="e.g. Machining of bracket as per drawing 2371-003-2150"
                value={form.scopeDescription}
                onChange={(e) => setField('scopeDescription', e.target.value)}
              />
            </FormField>
            <div className={styles.formGrid}>
              <FormField id="instructions" label="Instructions to the vendor">
                <textarea
                  id="instructions"
                  className={styles.textarea}
                  rows={2}
                  value={form.instructions}
                  onChange={(e) => setField('instructions', e.target.value)}
                />
              </FormField>
              <FormField id="notes" label="Internal notes">
                <textarea
                  id="notes"
                  className={styles.textarea}
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                />
              </FormField>
            </div>
          </div>
        </FormSection>

        <FormSection
          icon={ListPlus}
          title="Line Items"
          description="One row per part or operation — pick a catalog item or describe it"
          actions={
            <button type="button" className={styles.secondaryBtn} onClick={() => setForm({ ...form, lines: [...form.lines, newLine()] })}>
              <Plus className="w-4 h-4" /> Add line
            </button>
          }
        >
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th min-w-[13rem]">Item (optional)</th>
                  <th className="table-th min-w-[11rem]">Description</th>
                  <th className="table-th min-w-[8rem]">Drawing No</th>
                  <th className="table-th min-w-[7rem]">Part No</th>
                  <th className="table-th min-w-[6rem]">Qty *</th>
                  <th className="table-th min-w-[5rem]">UOM</th>
                  <th className="table-th min-w-[7rem]">Rate</th>
                  <th className="table-th min-w-[6rem]">GST%</th>
                  <th className="table-th min-w-[7rem] text-right">Amount</th>
                  <th className="table-th w-10"></th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                    <td className="table-td">
                      <SearchableSelect
                        value={l.itemId}
                        onChange={(v) => setLine(i, 'itemId', v)}
                        options={itemOptions}
                        placeholder="— not in catalog —"
                        allowClear
                        error={lineError(i, 'item')}
                      />
                      {lineError(i, 'item') && (
                        <p id={`line-${i}-item-error`} role="alert" className={styles.errorText}>{lineError(i, 'item')}</p>
                      )}
                    </td>
                    <td className="table-td">
                      <input
                        aria-label={`Line ${i + 1} description`}
                        className={`${styles.input} !h-9 !text-xs ${lineError(i, 'item') ? styles.inputError : ''}`}
                        placeholder="Required when no item is picked"
                        value={l.description}
                        onChange={(e) => setLine(i, 'description', e.target.value)}
                      />
                    </td>
                    <td className="table-td">
                      <input
                        aria-label={`Line ${i + 1} drawing number`}
                        className={`${styles.input} !h-9 !text-xs`}
                        value={l.drawingNumber}
                        onChange={(e) => setLine(i, 'drawingNumber', e.target.value)}
                      />
                    </td>
                    <td className="table-td">
                      <input
                        aria-label={`Line ${i + 1} part number`}
                        className={`${styles.input} !h-9 !text-xs`}
                        value={l.partNumber}
                        onChange={(e) => setLine(i, 'partNumber', e.target.value)}
                      />
                    </td>
                    <td className="table-td">
                      <input
                        id={`line-${i}-qty`}
                        aria-label={`Line ${i + 1} quantity`}
                        type="number"
                        step="0.001"
                        min="0"
                        className={`${styles.input} !h-9 !text-xs tabular-nums ${lineError(i, 'qtySent') ? styles.inputError : ''}`}
                        aria-invalid={!!lineError(i, 'qtySent')}
                        aria-describedby={lineError(i, 'qtySent') ? `line-${i}-qty-error` : undefined}
                        value={l.qtySent}
                        onChange={(e) => setLine(i, 'qtySent', e.target.value)}
                      />
                      {lineError(i, 'qtySent') && (
                        <p id={`line-${i}-qty-error`} role="alert" className={styles.errorText}>{lineError(i, 'qtySent')}</p>
                      )}
                    </td>
                    <td className="table-td">
                      <input
                        aria-label={`Line ${i + 1} UOM`}
                        className={`${styles.input} !h-9 !text-xs`}
                        value={l.uomCode}
                        onChange={(e) => setLine(i, 'uomCode', e.target.value)}
                      />
                    </td>
                    <td className="table-td">
                      <input
                        aria-label={`Line ${i + 1} rate`}
                        type="number"
                        step="0.01"
                        min="0"
                        className={`${styles.input} !h-9 !text-xs tabular-nums ${lineError(i, 'rate') ? styles.inputError : ''}`}
                        value={l.rate}
                        onChange={(e) => setLine(i, 'rate', e.target.value)}
                      />
                      {lineError(i, 'rate') && <p role="alert" className={styles.errorText}>{lineError(i, 'rate')}</p>}
                    </td>
                    <td className="table-td">
                      <input
                        aria-label={`Line ${i + 1} GST percent`}
                        type="number"
                        step="0.01"
                        min="0"
                        className={`${styles.input} !h-9 !text-xs tabular-nums ${lineError(i, 'gstRate') ? styles.inputError : ''}`}
                        value={l.gstRate}
                        onChange={(e) => setLine(i, 'gstRate', e.target.value)}
                      />
                      {lineError(i, 'gstRate') && <p role="alert" className={styles.errorText}>{lineError(i, 'gstRate')}</p>}
                    </td>
                    <td className="table-td text-right tabular-nums font-mono text-slate-700">
                      {inr(Number(l.qtySent || 0) * Number(l.rate || 0))}
                    </td>
                    <td className="table-td">
                      <button
                        type="button"
                        className="btn-danger !px-2 !py-1"
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

          <div className="mt-4 ml-auto max-w-sm text-sm bg-slate-50 rounded-xl p-3 border border-slate-100">
            <div className="text-[11px] text-slate-400 mb-1">
              Indicative value — the actual commitment is the purchase order raised from this work order.
            </div>
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums font-mono">{inr(estimate.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>GST</span>
              <span className="tabular-nums font-mono">{inr(estimate.gst)}</span>
            </div>
            <div className="flex justify-between font-bold border-t pt-1">
              <span>Total</span>
              <span className="tabular-nums font-mono">{inr(estimate.total)}</span>
            </div>
          </div>
        </FormSection>

        <div className={styles.actionsBar}>
          <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/vendor-work-orders')}>
            <ArrowLeft className="w-4 h-4" /> Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            <Save className="w-4 h-4" /> {isEdit ? 'Save' : 'Create Draft'}
          </button>
        </div>
      </form>
    </div>
  );
}
