import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ListPlus, Loader2, Play, RotateCcw, Save, X } from 'lucide-react';
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
  const [allItems, setAllItems] = useState([]);
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

  async function loadInvoices() {
    const { data: response } = await api.get('/invoices', { params: { pageSize: 1000, status: 'ISSUED,PAID,PARTIALLY_PAID' } });
    setInvoices(response.items || []);
  }

  async function loadAllItems() {
    const { data: response } = await api.get('/items', { params: { pageSize: 1000 } });
    setAllItems(response.items || []);
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

  useEffect(() => { loadInvoices(); loadAllItems(); if (id) loadReturn(); }, [id]);
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

  function removeItem(index) {
    setItems(items.filter((_, i) => i !== index));
    setLineErrors((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const { errors: errs, ok } = validateAll(formData, schema);
    const lErrs = items.map((i) => ({
      qty: positiveNumber(i.qty, 'Qty'),
      rate: positiveNumber(i.rate, 'Rate'),
    }));
    if (!ok || lErrs.some((le) => le.qty || le.rate)) {
      setErrors(errs);
      setLineErrors(lErrs);
      toast.error('Please fix the highlighted fields');
      return;
    }
    if (items.length === 0 || items.every(i => !i.itemId)) {
      toast.error('Please add at least one item');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...formData,
        invoiceId: parseInt(formData.invoiceId),
        items: items.map(i => ({
          itemId: parseInt(i.itemId),
          qty: parseFloat(i.qty),
          rate: parseFloat(i.rate),
          amount: parseFloat(i.amount),
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
        await api.post(`/sales-returns/${id}/process`);
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

  const total = items.reduce((sum, i) => sum + (i.amount || 0), 0);
  // the backend only allows editing a sales return while it's still DRAFT —
  // once approved/processed, header + line fields are read-only
  const editable = !isEdit || data?.status === 'DRAFT';

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
                <button type="button" onClick={() => setConfirmAction('process')} className={styles.secondaryBtn}>
                  <Play className="h-4 w-4" /> Process
                </button>
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
          : 'This will update stock and party ledger.'}
        confirmLabel={confirmAction === 'approve' ? 'Approve' : 'Process'}
        loading={actionLoading}
      />
    </div>
  );
}
