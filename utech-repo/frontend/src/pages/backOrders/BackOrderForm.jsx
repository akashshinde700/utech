import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, FileText, ListPlus, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Modal from '../../components/ui/Modal';
import { styles } from '../../lib/formStyles';
import { positiveNumber, required, validateAll } from '../../lib/validation';
import { toLocalInput, date, inr } from '../../lib/format';
import toast from 'react-hot-toast';

const schema = {
  partyId: (v) => required(v, 'Party'),
  date: (v) => required(v, 'Date'),
};

export default function BackOrderForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState([]);
  const [formData, setFormData] = useState({
    invoiceId: '',
    partyId: '',
    date: toLocalInput(),
    expectedDate: '',
    notes: '',
  });
  const [data, setData] = useState(null);
  // fulfill-line dialog state (replaces the old browser prompt)
  const [fulfillLine, setFulfillLine] = useState(null);
  const [fulfillQty, setFulfillQty] = useState('');
  const [fulfillError, setFulfillError] = useState(null);
  const [fulfilling, setFulfilling] = useState(false);

  async function loadInvoices() {
    const { data: response } = await api.get('/invoices', { params: { pageSize: 1000 } });
    setInvoices(response.items || []);
  }

  async function loadParties() {
    const { data: response } = await api.get('/parties', { params: { pageSize: 1000, type: 'CUSTOMER' } });
    setParties(response.items || []);
  }

  async function loadAllItems() {
    const { data: response } = await api.get('/items', { params: { pageSize: 1000 } });
    setAllItems(response.items || []);
  }

  async function loadBackOrder() {
    if (!id) return;
    const { data: response } = await api.get(`/back-orders/${id}`);
    setData(response);
    setFormData({
      invoiceId: response.invoiceId || '',
      partyId: response.partyId,
      date: response.date.split('T')[0],
      expectedDate: response.expectedDate ? response.expectedDate.split('T')[0] : '',
      notes: response.notes || '',
    });
    setItems(response.lines || []);
  }

  async function loadInvoiceLines(invoiceId) {
    if (!invoiceId) return;
    const { data: response } = await api.get(`/invoices/${invoiceId}`);
    setFormData(prev => ({ ...prev, partyId: response.partyId }));
    setItems(response.lines.map(l => ({
      itemId: l.itemId,
      description: l.description,
      qtyOrdered: 0,
      qtyFulfilled: 0,
      rate: l.rate,
      notes: '',
    })));
    setLineErrors([]);
  }

  useEffect(() => { loadInvoices(); loadParties(); loadAllItems(); if (id) loadBackOrder(); }, [id]);
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
  const partyOptions = parties.map((p) => ({
    value: p.id,
    label: `${p.code} — ${p.name}`,
    subtitle: p.phone || undefined,
  }));
  const itemOptions = allItems.map((i) => ({
    value: i.id,
    label: `${i.code} — ${i.name}`,
    subtitle: i.hsnCode ? `HSN ${i.hsnCode}` : undefined,
  }));

  function addItem() {
    setItems([...items, { itemId: '', description: '', qtyOrdered: 0, qtyFulfilled: 0, rate: 0, notes: '' }]);
    setLineErrors((prev) => [...prev, {}]);
  }

  function updateItem(index, field, value) {
    const updated = [...items];
    updated[index][field] = value;
    if (field === 'itemId') {
      const item = allItems.find(i => i.id === parseInt(value));
      if (item) {
        updated[index].description = item.name;
        updated[index].rate = item.saleRate || 0;
      }
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
    // line fields are read-only in edit mode — only validate on create
    const lErrs = isEdit ? [] : items.map((i) => ({
      itemId: required(i.itemId, 'Item'),
      qtyOrdered: positiveNumber(i.qtyOrdered, 'Ordered qty'),
      rate: positiveNumber(i.rate, 'Rate'),
    }));
    if (!ok || lErrs.some((le) => le.itemId || le.qtyOrdered || le.rate)) {
      setErrors(errs);
      setLineErrors(lErrs);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...formData,
        invoiceId: formData.invoiceId ? parseInt(formData.invoiceId) : null,
        partyId: parseInt(formData.partyId),
        expectedDate: formData.expectedDate || null,
        lines: items.map(i => ({
          ...i,
          itemId: parseInt(i.itemId),
          qtyOrdered: parseFloat(i.qtyOrdered),
          rate: parseFloat(i.rate),
        })),
      };
      if (isEdit) {
        await api.put(`/back-orders/${id}`, payload);
      } else {
        await api.post('/back-orders', payload);
      }
      navigate('/back-orders');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error saving back order');
    } finally {
      setLoading(false);
    }
  }

  // the backend blocks updates once a back order is FULFILLED/CANCELLED —
  // header notes/expected-date and per-line notes stay editable until then
  const editable = !isEdit || (data?.status !== 'FULFILLED' && data?.status !== 'CANCELLED');

  function openFulfill(line) {
    setFulfillLine(line);
    setFulfillQty('');
    setFulfillError(null);
  }

  async function confirmFulfill() {
    if (!fulfillLine) return;
    const parsed = parseFloat(fulfillQty);
    // the line row carries qtyOrdered/qtyFulfilled — fulfillment can never
    // exceed what is still outstanding, and must be a positive number
    const outstanding = Number(fulfillLine.qtyOrdered) - Number(fulfillLine.qtyFulfilled);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFulfillError('Enter a valid quantity greater than 0');
      return;
    }
    if (parsed > outstanding) {
      setFulfillError(`Only ${outstanding} outstanding on this line`);
      return;
    }
    setFulfilling(true);
    try {
      await api.post(`/back-orders/${id}/fulfill`, { lineId: fulfillLine.id, qty: parsed });
      toast.success('Fulfilled');
      setFulfillLine(null);
      loadBackOrder();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error fulfilling');
    } finally {
      setFulfilling(false);
    }
  }

  const fulfillOutstanding = fulfillLine ? Number(fulfillLine.qtyOrdered) - Number(fulfillLine.qtyFulfilled) : null;

  return (
    <div>
      <PageHeader
        title={isEdit ? `Back Order ${data?.number}` : 'New Back Order'}
        action={
          <button onClick={() => navigate('/back-orders')} className="btn-secondary">
            <X className="w-4 h-4" /> Cancel
          </button>
        }
      />
      <form onSubmit={handleSubmit} noValidate className="max-w-5xl space-y-5">
        <FormSection icon={FileText} title="Back Order Details" description="Optionally linked to the invoice that started it">
          <div className={styles.formGrid}>
            <FormField id="bo-invoice" label="Invoice (optional)" hint="Loads the invoice lines as back-ordered items">
              <SearchableSelect
                id="bo-invoice"
                value={formData.invoiceId}
                onChange={(v) => setField('invoiceId', v)}
                options={invoiceOptions}
                placeholder="Select invoice…"
                emptyText="No matching invoices"
                disabled={isEdit}
              />
            </FormField>
            <FormField id="bo-party" label="Party" required error={errors.partyId}>
              <SearchableSelect
                id="bo-party"
                value={formData.partyId}
                onChange={(v) => setField('partyId', v)}
                options={partyOptions}
                placeholder="Select party…"
                emptyText="No matching parties"
                error={errors.partyId}
                disabled={isEdit}
              />
            </FormField>
            <FormField id="bo-date" label="Date" required error={errors.date}>
              <input
                id="bo-date"
                type="date"
                className={`${styles.input} ${errors.date ? styles.inputError : ''}`}
                value={formData.date}
                onChange={(e) => setField('date', e.target.value)}
                aria-invalid={!!errors.date}
              />
            </FormField>
            <FormField id="bo-expected-date" label="Expected Date">
              <input
                id="bo-expected-date"
                type="date"
                className={styles.input}
                readOnly={!editable}
                value={formData.expectedDate}
                onChange={(e) => setField('expectedDate', e.target.value)}
              />
            </FormField>
            <FormField id="bo-notes" label="Notes" className="sm:col-span-2">
              <textarea
                id="bo-notes"
                rows={2}
                className={styles.textarea}
                readOnly={!editable}
                value={formData.notes}
                onChange={(e) => setField('notes', e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={ListPlus}
          title="Back Order Items"
          description="Outstanding quantities to fulfill as stock arrives"
          actions={
            !isEdit && (
              <button type="button" onClick={addItem} className="btn-secondary text-sm">
                <Plus className="w-4 h-4" /> Add Item
              </button>
            )
          }
        >
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">No items added</p>
          ) : (
            <>
              <div className="grid grid-cols-12 gap-2 mb-1 px-0.5">
                <div className="col-span-3 text-xs font-medium text-slate-500">Item</div>
                <div className="col-span-2 text-xs font-medium text-slate-500">Ordered</div>
                <div className="col-span-2 text-xs font-medium text-slate-500">Fulfilled</div>
                <div className="col-span-2 text-xs font-medium text-slate-500">Rate</div>
                <div className="col-span-2 text-xs font-medium text-slate-500">Notes</div>
                <div className="col-span-1"></div>
              </div>
              {items.map((item, idx) => (
                <div key={idx} className="mb-2 grid grid-cols-12 items-start gap-2">
                  <div className="col-span-3">
                    {!isEdit ? (
                      <FormField error={lineErrors[idx]?.itemId}>
                        <SearchableSelect
                          value={item.itemId}
                          onChange={(v) => updateItem(idx, 'itemId', v)}
                          options={itemOptions}
                          placeholder="Select item…"
                          emptyText="No matching items"
                          error={lineErrors[idx]?.itemId}
                        />
                      </FormField>
                    ) : (
                      <input className={`${styles.input} text-sm bg-slate-50`} value={item.description} readOnly tabIndex={-1} />
                    )}
                  </div>
                  <div className="col-span-2">
                    <FormField error={lineErrors[idx]?.qtyOrdered}>
                      <input
                        className={`${styles.input} text-sm ${lineErrors[idx]?.qtyOrdered ? styles.inputError : ''}`}
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="Ordered"
                        value={item.qtyOrdered}
                        onChange={(e) => updateItem(idx, 'qtyOrdered', e.target.value)}
                        readOnly={isEdit}
                        aria-invalid={!!lineErrors[idx]?.qtyOrdered}
                      />
                    </FormField>
                  </div>
                  <div className="col-span-2">
                    <input className={`${styles.input} text-sm bg-slate-50`} type="number" step="0.001" placeholder="Fulfilled" value={item.qtyFulfilled} readOnly tabIndex={-1} />
                  </div>
                  <div className="col-span-2">
                    <FormField error={lineErrors[idx]?.rate}>
                      <input
                        className={`${styles.input} text-sm ${lineErrors[idx]?.rate ? styles.inputError : ''}`}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Rate"
                        value={item.rate}
                        onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                        readOnly={isEdit}
                        aria-invalid={!!lineErrors[idx]?.rate}
                      />
                    </FormField>
                  </div>
                  <div className="col-span-2">
                    <input
                      className={`${styles.input} text-sm`}
                      placeholder="Notes"
                      readOnly={!editable}
                      value={item.notes}
                      onChange={(e) => updateItem(idx, 'notes', e.target.value)}
                    />
                  </div>
                  <div className="col-span-1 pt-1.5">
                    {!isEdit && (
                      <button type="button" onClick={() => removeItem(idx)} className="btn-icon text-danger-600 hover:bg-danger-50" aria-label={`Remove line ${idx + 1}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {isEdit && data?.status !== 'FULFILLED' && data?.status !== 'CANCELLED' && (
                      <button type="button" onClick={() => openFulfill(item)} className="btn-icon text-success-700 hover:bg-success-50" title="Fulfill" aria-label={`Fulfill line ${idx + 1}`}>
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          <div className={styles.actionsBar}>
            <button type="button" onClick={() => navigate('/back-orders')} className={styles.secondaryBtn}>Cancel</button>
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

      <Modal
        open={!!fulfillLine}
        onClose={() => { if (!fulfilling) setFulfillLine(null); }}
        title="Fulfill line item"
        description={fulfillLine?.description || undefined}
        size="md"
        footer={
          <>
            <button type="button" className={styles.secondaryBtn} onClick={() => setFulfillLine(null)} disabled={fulfilling}>Cancel</button>
            <button type="button" className={styles.primaryBtn} onClick={confirmFulfill} disabled={fulfilling}>
              {fulfilling && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {fulfilling ? 'Working…' : 'Fulfill'}
            </button>
          </>
        }
      >
        <FormField
          id="fulfill-qty"
          label="Quantity to fulfill"
          required
          hint={fulfillOutstanding != null ? `Outstanding on this line: ${fulfillOutstanding}` : undefined}
          error={fulfillError}
        >
          <input
            id="fulfill-qty"
            type="number"
            step="0.001"
            min="0"
            className={`${styles.input} ${fulfillError ? styles.inputError : ''}`}
            value={fulfillQty}
            onChange={(e) => { setFulfillQty(e.target.value); setFulfillError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmFulfill(); } }}
            aria-invalid={!!fulfillError}
          />
        </FormField>
      </Modal>
    </div>
  );
}
