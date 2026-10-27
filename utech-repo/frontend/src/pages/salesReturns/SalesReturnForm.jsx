import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ListPlus, Loader2, PackageCheck, Play, RotateCcw, Save, Truck, X } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { styles } from '../../lib/formStyles';
import { positiveNumber, required, validateAll } from '../../lib/validation';
import { inr, toLocalInput, date } from '../../lib/format';
import toast from 'react-hot-toast';

const schema = {
  invoiceId: (v) => required(v, 'Invoice'),
  date: (v) => required(v, 'Date'),
};

export default function SalesReturnForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState([]);
  const [confirmAction, setConfirmAction] = useState(null); // 'approve' | 'process'
  const [actionLoading, setActionLoading] = useState(false);
  const [formData, setFormData] = useState({
    invoiceId: '',
    date: toLocalInput(),
    reason: '',
    notes: '',
  });
  const [data, setData] = useState(null);
  // AUD-211 — proof that the goods physically came back. Stock cannot be
  // restored until this is recorded against the return.
  const [dispatches, setDispatches] = useState([]);
  const [receipt, setReceipt] = useState({ returnChallanNo: '', receivedAt: toLocalInput(), dispatchChallanId: '' });
  const [receiptBusy, setReceiptBusy] = useState(false);

  async function loadInvoices() {
    const { data: response } = await api.get('/invoices', { params: { pageSize: 1000, status: 'ISSUED,PAID,PARTIALLY_PAID' } });
    setInvoices(response.items || []);
  }

  async function loadReturn() {
    if (!id) return;
    const { data: response } = await api.get(`/sales-returns/${id}`);
    setData(response);
    setFormData({
      invoiceId: response.invoiceId,
      date: response.date.split('T')[0],
      reason: response.reason || '',
      notes: response.notes || '',
    });
    setItems(response.lines || []);
    setReceipt({
      returnChallanNo: response.returnChallanNo || '',
      receivedAt: response.receivedAt ? String(response.receivedAt).split('T')[0] : toLocalInput(),
      dispatchChallanId: response.dispatchChallanId || '',
    });
    // the optional dispatch challan must be one of THIS customer's
    try {
      const { data: list } = await api.get('/dispatch', { params: { partyId: response.partyId, pageSize: 100 } });
      setDispatches(list.items || []);
    } catch {
      // a user without dispatch.read can still record the challan number
      setDispatches([]);
    }
  }

  // Records the physical return receipt; the server validates the challan,
  // the customer and the quantity that challan actually shipped.
  async function saveReceipt() {
    if (!receipt.returnChallanNo.trim()) { toast.error('Enter the return challan number'); return; }
    if (!receipt.receivedAt) { toast.error('Enter the date the goods were received'); return; }
    setReceiptBusy(true);
    try {
      await api.post(`/sales-returns/${id}/receipt`, {
        returnChallanNo: receipt.returnChallanNo.trim(),
        receivedAt: receipt.receivedAt,
        dispatchChallanId: receipt.dispatchChallanId ? parseInt(receipt.dispatchChallanId, 10) : null,
      });
      toast.success('Physical receipt recorded');
      await loadReturn();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Could not record the receipt');
    } finally {
      setReceiptBusy(false);
    }
  }

  async function loadInvoiceLines(invoiceId) {
    if (!invoiceId) return;
    const { data: response } = await api.get(`/invoices/${invoiceId}`);
    setItems(response.lines.map(l => ({
      invoiceLineId: l.id,
      itemId: l.itemId,
      description: l.description,
      hsnCode: l.hsnCode,
      qty: 0,
      rate: l.rate,
      gstRate: l.gstRate,
      amount: 0,
      reason: '',
    })));
    setLineErrors([]);
  }

  useEffect(() => { loadInvoices(); if (id) loadReturn(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (formData.invoiceId && !id) loadInvoiceLines(formData.invoiceId); }, [formData.invoiceId, id]);

  function setField(k, v) {
    setFormData((f) => ({ ...f, [k]: v }));
    // clear the field's error as soon as its value changes
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  const invoiceOptions = invoices.map((inv) => ({
    value: inv.id,
    label: `${inv.number} — ${inv.party?.name ?? ''}`.trim(),
    subtitle: [date(inv.date), inr(inv.total)].filter(Boolean).join(' · '),
  }));

  function updateItem(index, field, value) {
    const updated = [...items];
    updated[index][field] = value;
    if (field === 'qty' || field === 'rate') {
      updated[index].amount = parseFloat(updated[index].qty || 0) * parseFloat(updated[index].rate || 0);
    }
    setItems(updated);
    // clear the line's error as soon as the offending value is fixed
    setLineErrors((prev) => {
      if (!prev[index]?.[field]) return prev;
      const next = [...prev];
      next[index] = { ...next[index], [field]: undefined };
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const { errors: errs, ok } = validateAll(formData, schema);
    // Only lines with a quantity take part in the return — an invoice can have
    // many lines and the user is usually returning one or two of them. Qty 0
    // (the default when an invoice is picked) simply means "not in this return".
    const isSelected = (i) => Number(i.qty) > 0;
    const selected = items.filter(isSelected);
    const lErrs = items.map((i) => {
      const raw = String(i.qty ?? '').trim();
      const qty = raw === '' || Number(i.qty) === 0 ? null
        : (!Number.isFinite(Number(i.qty)) || Number(i.qty) < 0 ? 'Qty must be 0 or more' : null);
      return {
        qty,
        rate: isSelected(i) ? positiveNumber(i.rate, 'Rate') : null,
      };
    });
    if (!ok || lErrs.some((le) => le.qty || le.rate)) {
      setErrors(errs);
      setLineErrors(lErrs);
      toast.error('Please fix the highlighted fields');
      return;
    }
    if (selected.length === 0) {
      toast.error('Enter a quantity for at least one line');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...formData,
        invoiceId: parseInt(formData.invoiceId),
        // the API reads `lines`, and only the lines the user gave a quantity
        // are sent. Each must carry the invoiceLineId it is returning against
        // (the server rejects lines that don't belong to the invoice) plus the
        // description/GST rate it needs to recompute tax; amounts are computed
        // server-side.
        lines: selected.map(i => ({
          invoiceLineId: parseInt(i.invoiceLineId),
          itemId: i.itemId != null && i.itemId !== '' ? parseInt(i.itemId) : null,
          description: i.description || '',
          hsnCode: i.hsnCode || null,
          qty: parseFloat(i.qty),
          rate: parseFloat(i.rate),
          gstRate: i.gstRate != null && i.gstRate !== '' ? parseFloat(i.gstRate) : 0,
          reason: i.reason || formData.reason || null,
        })),
      };
      if (isEdit) {
        await api.put(`/sales-returns/${id}`, payload);
      } else {
        await api.post('/sales-returns', payload);
      }
      toast.success('Saved successfully');
      navigate('/sales-returns');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save sales return');
    } finally {
      setLoading(false);
    }
  }

  async function runConfirmAction() {
    if (!confirmAction || !id) return;
    setActionLoading(true);
    try {
      if (confirmAction === 'approve') {
        await api.post(`/sales-returns/${id}/approve`);
        toast.success('Approved successfully');
      } else {
        await api.post(`/sales-returns/${id}/process`, {});
        toast.success('Processed successfully');
      }
      setConfirmAction(null);
      loadReturn();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || (confirmAction === 'approve' ? 'Failed to approve' : 'Failed to process'));
    } finally {
      setActionLoading(false);
    }
  }

  const subtotal = items.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const gstTotal = items.reduce(
    (sum, i) => sum + (Number(i.amount || 0) * Number(i.gstRate ?? 18)) / 100,
    0,
  );
  const total = Math.round((subtotal + gstTotal) * 100) / 100;
  // the backend only allows editing a sales return while it's still DRAFT —
  // once approved/processed, header + line fields are read-only
  const editable = !isEdit || data?.status === 'DRAFT';
  const hasReceipt = !!(data?.returnChallanNo && data?.receivedAt);
  const receiptEditable = isEdit && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(data?.status);
  const dispatchOptions = dispatches.map((d) => ({
    value: d.id,
    label: `${d.number} — ${date(d.date)}`,
    subtitle: d.status,
  }));

  return (
    <div>
      <PageHeader
        title={isEdit ? `Sales Return ${data?.number}` : 'New Sales Return'}
        action={
          <button onClick={() => navigate('/sales-returns')} className="btn-secondary">
            <X className="w-4 h-4" /> Cancel
          </button>
        }
      />
      <form onSubmit={handleSubmit} noValidate className="max-w-5xl space-y-5">
        <FormSection icon={RotateCcw} title="Return Details" description="Invoice being returned and why">
          <div className={styles.formGrid}>
            <FormField id="return-invoice" label="Invoice" required error={errors.invoiceId} className="sm:col-span-2" hint="Only issued or paid invoices can be returned">
              <SearchableSelect
                id="return-invoice"
                value={formData.invoiceId}
                onChange={(v) => setField('invoiceId', v)}
                options={invoiceOptions}
                placeholder="Select invoice…"
                emptyText="No matching invoices"
                disabled={isEdit}
              />
            </FormField>
            <FormField id="return-date" label="Date" required error={errors.date}>
              <input
                id="return-date"
                type="date"
                className={`${styles.input} ${errors.date ? styles.inputError : ''}`}
                value={formData.date}
                onChange={(e) => setField('date', e.target.value)}
                aria-invalid={!!errors.date}
              />
            </FormField>
            <FormField id="return-reason" label="Reason" className="sm:col-span-2">
              <textarea
                id="return-reason"
                rows={2}
                className={styles.textarea}
                readOnly={!editable}
                value={formData.reason}
                onChange={(e) => setField('reason', e.target.value)}
              />
            </FormField>
            <FormField id="return-notes" label="Notes" className="sm:col-span-2">
              <textarea
                id="return-notes"
                rows={2}
                className={styles.textarea}
                readOnly={!editable}
                value={formData.notes}
                onChange={(e) => setField('notes', e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        {isEdit && (
          <FormSection
            icon={PackageCheck}
            title="Physical Receipt"
            description="Proof the material actually came back — stock is only restored once this is recorded"
          >
            {hasReceipt && (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="font-semibold">Receipt recorded</div>
                <div className="mt-1 grid gap-1 sm:grid-cols-3">
                  <div><span className="text-xs text-emerald-700">Return challan</span><div className="font-medium">{data.returnChallanNo}</div></div>
                  <div><span className="text-xs text-emerald-700">Received on</span><div className="font-medium">{date(data.receivedAt)}</div></div>
                  <div><span className="text-xs text-emerald-700">Dispatch challan</span><div className="font-medium">{data.dispatchChallan?.number || '—'}</div></div>
                </div>
                {data.receivedBy?.name && (
                  <div className="mt-2 text-xs text-emerald-700">Booked by {data.receivedBy.name}</div>
                )}
              </div>
            )}
            {!receiptEditable ? (
              !hasReceipt && (
                <p className="text-sm text-slate-500">
                  This return can no longer be processed — no physical receipt was recorded.
                </p>
              )
            ) : (
              <div className={styles.formGrid}>
                <FormField id="return-challan-no" label="Return challan no." required hint="The document the customer sent the goods back with">
                  <input
                    id="return-challan-no"
                    className={styles.input}
                    value={receipt.returnChallanNo}
                    maxLength={60}
                    onChange={(e) => setReceipt((r) => ({ ...r, returnChallanNo: e.target.value }))}
                  />
                </FormField>
                <FormField id="return-received-at" label="Received on" required hint="Cannot be a future date">
                  <input
                    id="return-received-at"
                    type="date"
                    className={styles.input}
                    value={receipt.receivedAt}
                    onChange={(e) => setReceipt((r) => ({ ...r, receivedAt: e.target.value }))}
                  />
                </FormField>
                <FormField id="return-dispatch-challan" label="Dispatch challan" className="sm:col-span-2"
                  hint="Optional — caps the returned quantity at what we actually shipped">
                  <SearchableSelect
                    id="return-dispatch-challan"
                    value={receipt.dispatchChallanId}
                    onChange={(v) => setReceipt((r) => ({ ...r, dispatchChallanId: v }))}
                    options={dispatchOptions}
                    placeholder="Not linked to a dispatch"
                    emptyText="No dispatches for this customer"
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <button type="button" onClick={saveReceipt} disabled={receiptBusy} className={styles.secondaryBtn}>
                    {receiptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                    {hasReceipt ? 'Update receipt' : 'Record receipt'}
                  </button>
                </div>
              </div>
            )}
          </FormSection>
        )}

        <FormSection icon={ListPlus} title="Return Items" description="Quantities to bring back into stock">
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">Select an invoice to load items</p>
          ) : (
            <>
              <div className="grid grid-cols-12 gap-2 mb-1 px-0.5">
                <div className="col-span-4 text-xs font-medium text-slate-500">Item</div>
                <div className="col-span-2 text-xs font-medium text-slate-500">Qty</div>
                <div className="col-span-2 text-xs font-medium text-slate-500">Rate</div>
                <div className="col-span-2 text-xs font-medium text-slate-500">Amount</div>
                <div className="col-span-2 text-xs font-medium text-slate-500">Reason</div>
              </div>
              {items.length > 0 && (
                <div className="mb-2 text-xs text-slate-500">
                  Set a line's quantity to 0 to leave it out of this return.
                </div>
              )}
              {items.map((item, idx) => (
                <div key={idx} className="mb-2 grid grid-cols-12 items-start gap-2">
                  <div className="col-span-4">
                    <input className={`${styles.input} text-sm bg-slate-50`} value={item.description} readOnly tabIndex={-1} />
                  </div>
                  <div className="col-span-2">
                    <FormField error={lineErrors[idx]?.qty}>
                      <input
                        className={`${styles.input} text-sm ${lineErrors[idx]?.qty ? styles.inputError : ''}`}
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="Qty"
                        readOnly={!editable}
                        value={item.qty}
                        onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                        aria-invalid={!!lineErrors[idx]?.qty}
                      />
                    </FormField>
                  </div>
                  <div className="col-span-2">
                    <FormField error={lineErrors[idx]?.rate}>
                      <input
                        className={`${styles.input} text-sm ${lineErrors[idx]?.rate ? styles.inputError : ''}`}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Rate"
                        readOnly={!editable}
                        value={item.rate}
                        onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                        aria-invalid={!!lineErrors[idx]?.rate}
                      />
                    </FormField>
                  </div>
                  <div className="col-span-2">
                    <input className={`${styles.input} text-sm bg-slate-50`} value={inr(item.amount)} readOnly tabIndex={-1} />
                  </div>
                  <div className="col-span-2">
                    <input
                      className={`${styles.input} text-sm`}
                      placeholder="Reason"
                      readOnly={!editable}
                      value={item.reason}
                      onChange={(e) => updateItem(idx, 'reason', e.target.value)}
                    />
                  </div>
                </div>
              ))}
              <div className="mt-2 text-right text-sm font-semibold text-slate-800">
                Total: <span className="tabular-nums">{inr(total)}</span>
              </div>
            </>
          )}

          <div className={styles.actionsBar}>
            <div className="flex gap-2 sm:mr-auto">
              {isEdit && data?.status === 'DRAFT' && (
                <button type="button" onClick={() => setConfirmAction('approve')} className={styles.secondaryBtn}>
                  <Check className="h-4 w-4" /> Approve
                </button>
              )}
              {isEdit && data?.status === 'APPROVED' && (
                <button
                  type="button"
                  onClick={() => setConfirmAction('process')}
                  className={styles.secondaryBtn}
                  disabled={!hasReceipt}
                  title={hasReceipt ? 'Restore stock and credit the customer' : 'Record the physical return receipt first'}
                >
                  <Play className="h-4 w-4" /> Process
                </button>
              )}
              {isEdit && data?.status === 'APPROVED' && !hasReceipt && (
                <span className="self-center text-xs text-amber-700">
                  Record the physical receipt (challan no. + received date) to process this return.
                </span>
              )}
            </div>
            <button type="button" onClick={() => navigate('/sales-returns')} className={styles.secondaryBtn}>Cancel</button>
            {editable && (
              <button type="submit" disabled={loading} className={styles.primaryBtn}>
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Save className="h-4 w-4" />} {loading ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </FormSection>
      </form>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => { if (!actionLoading) setConfirmAction(null); }}
        onConfirm={runConfirmAction}
        title={confirmAction === 'approve' ? 'Approve this sales return?' : 'Process this sales return?'}
        message={confirmAction === 'approve'
          ? 'The return will be locked for editing and can then be processed.'
          : `This restores stock against the recorded receipt ${data?.returnChallanNo ? `(${data.returnChallanNo})` : ''} and credits the customer.`}
        confirmLabel={confirmAction === 'approve' ? 'Approve' : 'Process'}
        loading={actionLoading}
      />
    </div>
  );
}
