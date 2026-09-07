import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Check, Play, Undo2, ListPlus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, validateAll } from '../../lib/validation';
import { inr, toLocalInput } from '../../lib/format';
import toast from 'react-hot-toast';

function focusFirstError(errors) {
  const key = Object.keys(errors)[0];
  if (!key) return;
  const el = document.getElementById(key);
  if (el) {
    el.focus?.();
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
}

export default function PurchaseReturnForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [grns, setGrns] = useState([]);
  const [pos, setPos] = useState([]);
  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [formData, setFormData] = useState({
    grnId: '',
    poId: '',
    partyId: '',
    date: toLocalInput(),
    reason: '',
    notes: '',
  });
  const [data, setData] = useState(null);
  const [errors, setErrors] = useState({});
  // 'approve' | 'process' | null — pending status transition on a saved return
  const [confirmAction, setConfirmAction] = useState(null);
  const [acting, setActing] = useState(false);

  async function loadGrns() {
    const { data: response } = await api.get('/grns', { params: { pageSize: 1000, status: 'ACCEPTED' } });
    setGrns(response.items || []);
  }

  async function loadPos() {
    const { data: response } = await api.get('/purchase-orders', { params: { pageSize: 1000, status: 'APPROVED,RECEIVED' } });
    setPos(response.items || []);
  }

  async function loadParties() {
    const { data: response } = await api.get('/parties', { params: { pageSize: 1000, type: 'VENDOR' } });
    setParties(response.items || []);
  }

  async function loadReturn() {
    if (!id) return;
    const { data: response } = await api.get(`/purchase-returns/${id}`);
    setData(response);
    setFormData({
      grnId: response.grnId || '',
      poId: response.poId || '',
      partyId: response.partyId,
      date: response.date.split('T')[0],
      reason: response.reason || '',
      notes: response.notes || '',
    });
    setItems(response.lines || []);
  }

  async function loadGrnLines(grnId) {
    if (!grnId) return;
    const { data: response } = await api.get(`/grns/${grnId}`);
    setFormData(prev => ({ ...prev, partyId: response.partyId }));
    setItems(response.lines.map(l => ({
      grnLineId: l.id,
      itemId: l.itemId,
      description: l.item?.name || 'Item',
      qty: 0,
      rate: l.rate,
      gstRate: l.gstRate,
      amount: 0,
      reason: '',
    })));
  }

  async function loadPoLines(poId) {
    if (!poId) return;
    const { data: response } = await api.get(`/purchase-orders/${poId}`);
    setFormData(prev => ({ ...prev, partyId: response.partyId }));
    setItems(response.lines.map(l => ({
      itemId: l.itemId,
      description: l.item?.name || 'Item',
      qty: 0,
      rate: l.rate,
      gstRate: l.gstRate,
      amount: 0,
      reason: '',
    })));
  }

  useEffect(() => { loadGrns(); loadPos(); loadParties(); if (id) loadReturn(); }, [id]);
  useEffect(() => { if (formData.grnId && !id) loadGrnLines(formData.grnId); }, [formData.grnId, id]);
  useEffect(() => { if (formData.poId && !id) loadPoLines(formData.poId); }, [formData.poId, id]);

  function updateItem(index, field, value) {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'qty' || field === 'rate') {
      updated[index].amount = parseFloat(updated[index].qty || 0) * parseFloat(updated[index].rate || 0);
    }
    setItems(updated);
    if (field === 'qty') {
      const k = `line-${index}-qty`;
      setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
    }
  }

  function validate() {
    const { errors: all } = validateAll(formData, {
      partyId: (v) => required(v, 'Party'),
      date: (v) => required(v, 'Date'),
    });
    items.forEach((item, idx) => {
      const msg = positiveNumber(item.qty, 'Return qty');
      if (msg) all[`line-${idx}-qty`] = msg;
    });
    return all;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const all = validate();
    if (Object.keys(all).length) {
      setErrors(all);
      toast.error('Please fix the highlighted fields');
      focusFirstError(all);
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...formData,
        grnId: formData.grnId ? parseInt(formData.grnId) : null,
        poId: formData.poId ? parseInt(formData.poId) : null,
        partyId: parseInt(formData.partyId),
        lines: items.map(i => ({
          ...i,
          itemId: parseInt(i.itemId),
          qty: parseFloat(i.qty),
          rate: parseFloat(i.rate),
        })),
      };
      if (isEdit) {
        await api.put(`/purchase-returns/${id}`, payload);
      } else {
        await api.post('/purchase-returns', payload);
      }
      toast.success(isEdit ? 'Purchase return updated' : 'Purchase return saved');
      navigate('/purchase-returns');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error saving purchase return');
    } finally {
      setLoading(false);
    }
  }

  async function doAction(action) {
    setActing(true);
    try {
      if (action === 'approve') {
        await api.post(`/purchase-returns/${id}/approve`);
        toast.success('Approved');
        loadReturn();
      } else {
        await api.post(`/purchase-returns/${id}/process`);
        toast.success('Processed');
        loadReturn();
      }
      setConfirmAction(null);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || (action === 'approve' ? 'Error approving' : 'Error processing'));
    } finally {
      setActing(false);
    }
  }

  const total = items.reduce((sum, i) => sum + (i.amount || 0), 0);
  const show = (k) => errors[k] || null;

  return (
    <div>
      <PageHeader
        title={isEdit ? `Purchase Return ${data?.number || ''}` : 'New Purchase Return'}
        subtitle={isEdit
          ? 'Approve a draft, then process it to move stock and the party ledger'
          : 'Send goods back to a vendor against a GRN or PO'}
      />
      <form onSubmit={handleSubmit} className="max-w-5xl space-y-5">
        <FormSection icon={Undo2} title="Return Details" description="Pick a GRN (accepted receipts) or a PO — the other clears automatically">
          <div className={styles.formGrid}>
            <FormField id="grnId" label="GRN" hint="Only ACCEPTED GRNs are listed" htmlFor="grnId">
              <SearchableSelect
                id="grnId"
                value={formData.grnId}
                onChange={(v) => { setFormData((f) => ({ ...f, grnId: v, poId: '' })); setErrors((e) => (e.partyId ? { ...e, partyId: undefined } : e)); }}
                options={grns.map((g) => ({ value: g.id, label: g.number, subtitle: g.party?.name || undefined }))}
                placeholder="Select GRN…"
                disabled={isEdit}
                emptyText="No accepted GRNs match"
              />
            </FormField>
            <FormField id="poId" label="PO" hint="Or start from an approved / received PO" htmlFor="poId">
              <SearchableSelect
                id="poId"
                value={formData.poId}
                onChange={(v) => { setFormData((f) => ({ ...f, poId: v, grnId: '' })); setErrors((e) => (e.partyId ? { ...e, partyId: undefined } : e)); }}
                options={pos.map((p) => ({ value: p.id, label: p.number, subtitle: p.party?.name || undefined }))}
                placeholder="Select PO…"
                disabled={isEdit}
                emptyText="No open POs match"
              />
            </FormField>
            <FormField id="partyId" label="Vendor" required error={show('partyId')} hint="Auto-filled from the selected GRN or PO" htmlFor="partyId">
              <SearchableSelect
                id="partyId"
                value={formData.partyId}
                onChange={(v) => { setFormData((f) => ({ ...f, partyId: v })); setErrors((e) => (e.partyId ? { ...e, partyId: undefined } : e)); }}
                options={parties.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}`, subtitle: p.phone || undefined }))}
                placeholder="Select vendor…"
                disabled={isEdit}
                error={show('partyId')}
                emptyText="No vendors match"
              />
            </FormField>
            <FormField id="date" label="Date" required error={show('date')} htmlFor="date">
              <input
                id="date" type="date" className={styles.input} value={formData.date}
                onChange={(e) => { setFormData((f) => ({ ...f, date: e.target.value })); setErrors((e) => (e.date ? { ...e, date: undefined } : e)); }}
              />
            </FormField>
            <FormField id="reason" label="Reason" htmlFor="reason" className="sm:col-span-2">
              <textarea
                id="reason" rows={2} className={styles.textarea} value={formData.reason}
                placeholder="e.g. Damaged in transit — 5 units rejected"
                onChange={(e) => setFormData((f) => ({ ...f, reason: e.target.value }))}
              />
            </FormField>
            <FormField id="notes" label="Notes" htmlFor="notes" className="sm:col-span-2">
              <textarea
                id="notes" rows={2} className={styles.textarea} value={formData.notes}
                onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection icon={ListPlus} title="Return Items" description="Enter the quantity going back to the vendor for each item">
          {items.length === 0 ? (
            <EmptyState
              icon={ListPlus}
              title="No items loaded"
              description={isEdit ? 'This return has no lines.' : 'Select a GRN or PO above to load its items.'}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="hidden grid-cols-12 gap-2 border-b border-slate-100 bg-slate-50/50 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid">
                <div className="col-span-4">Item</div>
                <div className="col-span-2">Return qty</div>
                <div className="col-span-2">Rate</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-2">Reason</div>
              </div>
              {items.map((item, idx) => {
                const qtyErr = errors[`line-${idx}-qty`] || null;
                return (
                  <div key={idx} className="grid grid-cols-2 gap-2 border-b border-slate-100 px-2 py-2 last:border-b-0 sm:grid-cols-12 sm:items-start">
                    <div className="col-span-2 sm:col-span-4">
                      <input className={`${styles.input} text-sm`} value={item.description || ''} readOnly aria-label={`Item ${idx + 1}`} />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        id={`line-${idx}-qty`} type="number" step="0.001" placeholder="Qty"
                        className={`${styles.input} text-sm text-right ${qtyErr ? styles.inputError : ''}`}
                        aria-invalid={!!qtyErr}
                        aria-describedby={qtyErr ? `line-${idx}-qty-error` : undefined}
                        value={item.qty}
                        onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                      />
                      {qtyErr && <p id={`line-${idx}-qty-error`} role="alert" className={styles.errorText}>{qtyErr}</p>}
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="number" step="0.01" placeholder="Rate" aria-label={`Item ${idx + 1} rate`}
                        className={`${styles.input} text-sm text-right tabular-nums`} value={item.rate}
                        onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input className={`${styles.input} text-sm text-right tabular-nums`} value={inr(item.amount)} readOnly aria-label={`Item ${idx + 1} amount`} />
                    </div>
                    <div className="col-span-2 sm:col-span-2">
                      <input
                        placeholder="Reason" aria-label={`Item ${idx + 1} reason`}
                        className={`${styles.input} text-sm`} value={item.reason || ''}
                        onChange={(e) => updateItem(idx, 'reason', e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="ml-auto flex max-w-sm justify-between border-t border-slate-100 bg-slate-50/50 px-3 py-2 text-sm font-bold">
                <span>Total</span>
                <span className="font-mono tabular-nums">{inr(total)}</span>
              </div>
            </div>
          )}
        </FormSection>

        <div className={styles.actionsBar}>
          {isEdit && (
            <div className="flex gap-2 sm:mr-auto">
              {data?.status === 'DRAFT' && (
                <button type="button" className={styles.secondaryBtn} onClick={() => setConfirmAction('approve')}>
                  <Check className="h-4 w-4" /> Approve
                </button>
              )}
              {data?.status === 'APPROVED' && (
                <button type="button" className={styles.secondaryBtn} onClick={() => setConfirmAction('process')}>
                  <Play className="h-4 w-4" /> Process
                </button>
              )}
            </div>
          )}
          <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/purchase-returns')}>Cancel</button>
          {!isEdit && (
            <button type="submit" className={styles.primaryBtn} disabled={loading}>
              <Save className="h-4 w-4" /> {loading ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmAction === 'approve'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => doAction('approve')}
        title="Approve this purchase return?"
        message={`${data?.number || 'This return'} will move to APPROVED and become ready to process.`}
        confirmLabel="Approve"
        loading={acting}
      />
      <ConfirmDialog
        open={confirmAction === 'process'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => doAction('process')}
        title="Process this purchase return?"
        message="Processing will update stock and the party ledger. This cannot be undone from this screen."
        confirmLabel="Process"
        loading={acting}
      />
    </div>
  );
}
