import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileDown, ListPlus, Loader2, Pencil, ReceiptText, Wallet } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import Modal from '../../components/ui/Modal';
import { styles } from '../../lib/formStyles';
import { positiveNumber, required, validateAll } from '../../lib/validation';
import { inr, date, todayLocal } from '../../lib/format';
import { amountInWordsINR } from '../../lib/numberToWords';
import toast from 'react-hot-toast';

export default function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [inv, setInv] = useState(null);
  const [pay, setPay] = useState(null); // payment dialog state
  const [payErrors, setPayErrors] = useState({});
  const [paySaving, setPaySaving] = useState(false);

  async function load() { const r = await api.get(`/invoices/${id}`); setInv(r.data); }
  useEffect(() => { load(); }, [id]);

  if (!inv) return <div className="text-sm text-slate-500">Loading…</div>;

  const balance = Number(inv.total) - Number(inv.amountPaid);

  function setPayField(k, v) {
    setPay((p) => ({ ...p, [k]: v }));
    // clear the field's error as soon as its value changes
    setPayErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  async function addPayment() {
    const { errors, ok } = validateAll(pay, {
      date: (v) => required(v, 'Date'),
      amount: (v) => positiveNumber(v, 'Amount'),
    });
    if (!ok) {
      setPayErrors(errors);
      return;
    }
    setPaySaving(true);
    try {
      await api.post(`/invoices/${id}/payments`, {
        date: pay.date, amount: Number(pay.amount), mode: pay.mode,
        reference: pay.reference || null, notes: pay.notes || null,
      });
      toast.success('Payment recorded');
      setPay(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setPaySaving(false);
    }
  }

  function downloadPdf() {
    const token = localStorage.getItem('utech.token');
    const url = `/api/invoices/${id}/pdf`;
    // simple inline trigger using fetch for auth header
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const u = URL.createObjectURL(blob);
        window.open(u, '_blank');
      });
  }

  return (
    <div>
      <PageHeader
        title={`Invoice ${inv.number}`}
        subtitle={`To ${inv.party?.name ?? '—'} • ${date(inv.date)}`}
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={downloadPdf}><FileDown className="w-4 h-4" /> PDF</button>
            <Link to={`/invoices/${id}/edit`} className="btn-secondary"><Pencil className="w-4 h-4" /> Edit</Link>
            <button className="btn-primary" onClick={() => { setPayErrors({}); setPay({ date: todayLocal(), amount: '', mode: 'BANK', reference: '', notes: '' }); }}><Wallet className="w-4 h-4" /> Record payment</button>
          </div>
        }
      />

      <div className="max-w-5xl space-y-5">
        <FormSection icon={ReceiptText} title="Invoice Details" actions={<Badge status={inv.overdue ? 'OVERDUE' : inv.status}>{inv.overdue ? 'OVERDUE' : inv.status}</Badge>}>
          <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
            <div className="min-w-0">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Bill To</div>
              <div className="text-lg font-bold text-slate-900">{inv.party?.name ?? '—'}</div>
              {inv.party?.gstin && <div className="text-sm text-slate-600">GSTIN: {inv.party.gstin}</div>}
              {inv.party?.addressLine1 && <div className="text-sm text-slate-600">{inv.party.addressLine1}</div>}
              {(inv.party?.city || inv.party?.state || inv.party?.pincode) && (
                <div className="text-sm text-slate-600">{[inv.party?.city, inv.party?.state, inv.party?.pincode].filter(Boolean).join(', ')}</div>
              )}
            </div>
            <dl className="shrink-0 space-y-1 text-sm sm:text-right">
              <div className="flex justify-between gap-8 sm:justify-end"><dt className="text-slate-500">Invoice No.</dt><dd className="font-medium text-slate-800">{inv.number}</dd></div>
              <div className="flex justify-between gap-8 sm:justify-end"><dt className="text-slate-500">Invoice Date</dt><dd className="font-medium text-slate-800">{date(inv.date)}</dd></div>
              <div className="flex justify-between gap-8 sm:justify-end"><dt className="text-slate-500">Due Date</dt><dd className="font-medium text-slate-800">{date(inv.dueDate)}</dd></div>
            </dl>
          </div>
        </FormSection>

        <FormSection icon={ListPlus} title="Line Items">
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="table-th rounded-tl-lg">#</th>
                  <th className="table-th">Description</th>
                  <th className="table-th">HSN</th>
                  <th className="table-th text-right">Qty</th>
                  <th className="table-th text-right">Rate</th>
                  <th className="table-th text-right">GST%</th>
                  <th className="table-th text-right rounded-tr-lg">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(inv.lines || []).map((l, i) => (
                  <tr key={l.id} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                    <td className="table-td">{i + 1}</td>
                    <td className="table-td font-medium">{l.description}</td>
                    <td className="table-td">{l.hsnCode || '—'}</td>
                    <td className="table-td text-right">{Number(l.qty)}</td>
                    <td className="table-td text-right">{inr(l.rate)}</td>
                    <td className="table-td text-right">{Number(l.gstRate)}%</td>
                    <td className="table-td text-right font-medium">{inr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection icon={Wallet} title="Summary">
          <div className="ml-auto max-w-sm space-y-1 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">{inr(inv.subtotal)}</span></div>
            {Number(inv.discount) > 0 && <>
              <div className="flex justify-between"><span className="text-slate-500">Discount</span><span className="font-medium text-danger-600">- {inr(inv.discount)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Taxable Value</span><span className="font-medium">{inr(Number(inv.subtotal) - Number(inv.discount))}</span></div>
            </>}
            {Number(inv.cgst) > 0 && <>
              <div className="flex justify-between"><span className="text-slate-500">CGST</span><span className="font-medium">{inr(inv.cgst)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">SGST</span><span className="font-medium">{inr(inv.sgst)}</span></div>
            </>}
            {Number(inv.igst) > 0 && <div className="flex justify-between"><span className="text-slate-500">IGST</span><span className="font-medium">{inr(inv.igst)}</span></div>}
            {Number(inv.roundOff) !== 0 && <div className="flex justify-between"><span className="text-slate-500">Round Off</span><span className="font-medium">{Number(inv.roundOff) > 0 ? '+ ' : '- '}{inr(Math.abs(Number(inv.roundOff)))}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-2 mt-1 font-bold text-base"><span>Total</span><span>{inr(inv.total)}</span></div>
            <div className="flex justify-between text-success-700"><span>Paid</span><span className="font-medium">{inr(inv.amountPaid)}</span></div>
            <div className="flex justify-between font-semibold text-slate-800"><span>Balance</span><span>{inr(balance)}</span></div>
          </div>

          {/* amount in words — mirrors QuotationView so printed/accounting docs read the same */}
          <div className="ml-auto max-w-sm border-t border-slate-100 pt-2 text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wide">Amount in words: </span>
            <span className="italic">{amountInWordsINR(inv.total)}</span>
          </div>
        </FormSection>

        {inv.payments && inv.payments.length > 0 && (
          <FormSection icon={Wallet} title="Payments" description={`${inv.payments.length} payment${inv.payments.length === 1 ? '' : 's'} recorded`}>
            <div className="overflow-x-auto scroll-x-hint">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="table-th rounded-tl-lg">Date</th>
                    <th className="table-th">Mode</th>
                    <th className="table-th">Reference</th>
                    <th className="table-th text-right rounded-tr-lg">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="table-td">{date(p.date)}</td>
                      <td className="table-td"><Badge status="PAID">{p.mode}</Badge></td>
                      <td className="table-td">{p.reference || '—'}</td>
                      <td className="table-td text-right font-medium">{inr(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}
      </div>

      <Modal
        open={!!pay}
        onClose={() => { if (!paySaving) setPay(null); }}
        title="Record payment"
        description={`Invoice ${inv.number} — balance ${inr(balance)}`}
        size="md"
        footer={
          <>
            <button type="button" className={styles.secondaryBtn} onClick={() => setPay(null)} disabled={paySaving}>Cancel</button>
            <button type="button" className={styles.primaryBtn} onClick={addPayment} disabled={paySaving}>
              {paySaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {paySaving ? 'Saving…' : 'Save payment'}
            </button>
          </>
        }
      >
        {pay && (
          <div className="space-y-4">
            <FormField id="pay-date" label="Date" required error={payErrors.date}>
              <input
                id="pay-date"
                type="date"
                className={`${styles.input} ${payErrors.date ? styles.inputError : ''}`}
                value={pay.date}
                onChange={(e) => setPayField('date', e.target.value)}
                aria-invalid={!!payErrors.date}
              />
            </FormField>
            <FormField id="pay-amount" label="Amount" required hint={`Balance due ${inr(balance)}`} error={payErrors.amount}>
              <input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0"
                className={`${styles.input} ${payErrors.amount ? styles.inputError : ''}`}
                value={pay.amount}
                onChange={(e) => setPayField('amount', e.target.value)}
                aria-invalid={!!payErrors.amount}
              />
            </FormField>
            <FormField id="pay-mode" label="Mode">
              <select id="pay-mode" className={styles.input} value={pay.mode} onChange={(e) => setPayField('mode', e.target.value)}>
                <option>CASH</option><option>BANK</option><option>UPI</option><option>CHEQUE</option>
              </select>
            </FormField>
            <FormField id="pay-reference" label="Reference" hint="UTR / cheque number">
              <input id="pay-reference" className={styles.input} value={pay.reference} onChange={(e) => setPayField('reference', e.target.value)} />
            </FormField>
            <FormField id="pay-notes" label="Notes">
              <textarea id="pay-notes" rows={2} className={styles.textarea} value={pay.notes || ''} onChange={(e) => setPayField('notes', e.target.value)} />
            </FormField>
          </div>
        )}
      </Modal>
    </div>
  );
}
