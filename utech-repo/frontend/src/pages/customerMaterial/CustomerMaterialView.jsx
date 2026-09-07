import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Users, Package, Activity, CheckCircle2, Send, RotateCcw, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import FormField from '../../components/ui/FormField';
import { styles } from '../../lib/formStyles';
import { positiveNumber, validateAll } from '../../lib/validation';
import { date, datetime } from '../../lib/format';
import toast from 'react-hot-toast';

const ACTIONS = [
  { key: 'consume', label: 'Mark Consumed', icon: CheckCircle2, endpoint: 'consume' },
  { key: 'dispatchToCustomer', label: 'Dispatch to Customer', icon: Send, endpoint: 'dispatch-to-customer' },
  { key: 'returnToCustomer', label: 'Return Unused', icon: RotateCcw, endpoint: 'return-to-customer' },
];

const CLOSED_STATUSES = ['CONSUMED', 'DISPATCHED', 'RETURNED_TO_CUSTOMER'];

export default function CustomerMaterialView() {
  const { id } = useParams();
  const [lot, setLot] = useState(null);
  const [acting, setActing] = useState(null);
  const [actingBusy, setActingBusy] = useState(false);
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});

  async function load() { const r = await api.get(`/customer-material/${id}`); setLot(r.data); }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function openAction(action) {
    setActing(action);
    setQty(String(lot.availableQty));
    setNotes('');
    setErrors({});
  }

  async function runAction() {
    if (!acting) return;
    const { errors: nextErrors, ok } = validateAll({ qty }, {
      qty: (v) => {
        const base = positiveNumber(v, 'Quantity');
        if (base) return base;
        if (Number(v) > Number(lot.availableQty)) return `Quantity cannot exceed available ${Number(lot.availableQty)}`;
        return null;
      },
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setActingBusy(true);
    try {
      await api.post(`/customer-material/${id}/${acting.endpoint}`, { qty: Number(qty), notes: notes || null });
      toast.success('Updated');
      setActing(null); setQty(''); setNotes('');
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to record movement');
    } finally {
      setActingBusy(false);
    }
  }

  if (!lot) return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-10">
      <div className="w-4 h-4 border-2 border-slate-300 border-t-brand-500 rounded-full animate-spin" />
      Loading…
    </div>
  );

  const canAct = !CLOSED_STATUSES.includes(lot.status);

  return (
    <div>
      <PageHeader
        title={`Customer Material ${lot.inwardNumber}`}
        subtitle={`${lot.customer?.name} • ${date(lot.receivedDate)}`}
        action={<Link to="/customer-material" className="btn-secondary"><ArrowLeft className="w-4 h-4" /> Back</Link>}
      />

      <div className="card p-6 max-w-3xl space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-slate-400" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Material</span>
            </div>
            <div className="font-bold text-lg text-slate-900">{lot.materialDescription}</div>
          </div>
          <Badge status={lot.status}>{(lot.status || '').replace(/_/g, ' ')}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Original Qty', value: Number(lot.qty) },
            { label: 'Available', value: Number(lot.availableQty), color: 'text-success-600' },
            { label: 'Weight', value: lot.weight != null ? Number(lot.weight) : '—' },
          ].map((s) => (
            <div key={s.label} className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-center">
              <div className={`text-2xl font-bold tabular-nums ${s.color || 'text-slate-800'}`}>{s.value}</div>
              <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><div className="label mb-0.5">Heat Number</div><div className="text-slate-800">{lot.heatNumber || '—'}</div></div>
          <div><div className="label mb-0.5">Lot Number</div><div className="text-slate-800">{lot.lotNumber || '—'}</div></div>
          <div><div className="label mb-0.5">Location</div><div className="text-slate-800">{lot.location || '—'}</div></div>
          <div><div className="label mb-0.5">UoM</div><div className="text-slate-800">{lot.uomCode || '—'}</div></div>
          <div><div className="label mb-0.5">Job Card</div><div className="text-slate-800">{lot.jobcard?.number || '—'}</div></div>
          <div><div className="label mb-0.5">Catalog Item</div><div className="text-slate-800">{lot.item?.name || '—'}</div></div>
        </div>

        {canAct && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-4 h-4 text-brand-600" aria-hidden="true" />
              <div className="font-semibold text-sm text-slate-800">Actions</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {ACTIONS.map((a) => (
                <button key={a.key} type="button" className="btn-secondary" onClick={() => openAction(a)}>
                  <a.icon className="w-4 h-4" aria-hidden="true" /> {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-brand-600" aria-hidden="true" />
            <div className="font-semibold text-sm text-slate-800">Movement History</div>
          </div>
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead><tr>
                <th className="table-th rounded-tl-lg">Date</th><th className="table-th">Type</th>
                <th className="table-th text-right">In</th><th className="table-th text-right">Out</th>
                <th className="table-th text-right rounded-tr-lg">Balance</th>
              </tr></thead>
              <tbody>
                {(lot.stockLedger || []).map((r) => (
                  <tr key={r.id}>
                    <td className="table-td">{datetime(r.date)}</td>
                    <td className="table-td">{(r.refType || '').replace(/_/g, ' ')}</td>
                    <td className="table-td text-right text-success-600 tabular-nums">{Number(r.qtyIn) || ''}</td>
                    <td className="table-td text-right text-danger-600 tabular-nums">{Number(r.qtyOut) || ''}</td>
                    <td className="table-td text-right font-semibold tabular-nums">{Number(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {acting && (
        <Modal
          open
          onClose={() => setActing(null)}
          title={acting.label}
          description={`Available quantity: ${Number(lot.availableQty)} ${lot.uomCode || ''}`.trim()}
          size="md"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setActing(null)} disabled={actingBusy}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={runAction} disabled={actingBusy}>
                {actingBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {actingBusy ? 'Working…' : 'Confirm'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <FormField id="cm-action-qty" label="Quantity" required error={errors.qty}>
              <input
                id="cm-action-qty"
                type="number"
                step="0.001"
                max={lot.availableQty}
                className={`${styles.input} tabular-nums ${errors.qty ? styles.inputError : ''}`}
                aria-invalid={!!errors.qty}
                aria-describedby={errors.qty ? 'cm-action-qty-error' : undefined}
                value={qty}
                onChange={(e) => { setQty(e.target.value); setErrors({}); }}
              />
            </FormField>
            <FormField id="cm-action-notes" label="Notes">
              <input id="cm-action-notes" className={styles.input} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </div>
        </Modal>
      )}
    </div>
  );
}
