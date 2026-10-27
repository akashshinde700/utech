import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '../../lib/api';
import FormField from '../../components/ui/FormField';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { numericPrecision, trackedQuantity } from '../../lib/quantityValidation';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

// Reservations do not issue or consume stock. The operator explicitly releases
// a reservation before the corresponding physical movement.
export default function CustomerMaterialAllocations({ lot, onChange }) {
  const user = useAuth((s) => s.user);
  const canUpdate = hasPermission(user, 'customerMaterial.update');
  const canAllocate = canUpdate && hasPermission(user, 'jobcard.read');
  const [cards, setCards] = useState([]);
  const [cardError, setCardError] = useState('');
  const [jobcardId, setJobcardId] = useState('');
  const [qty, setQty] = useState('');
  const [weight, setWeight] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [release, setRelease] = useState(null);
  const [reconcile, setReconcile] = useState(false);
  const [reason, setReason] = useState('');
  const [measured, setMeasured] = useState('');

  const searchCards = useCallback(async (q = '') => {
    if (!canAllocate) return;
    try {
      // Search on the server, so cards beyond the first 100 are reachable.
      const { data } = await api.get('/jobcards', { params: { pageSize: 100, q } });
      const rows = data.items.filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.status)
        && (c.partyId == null || c.partyId === lot.customerId));
      setCards((old) => [...new Map([...old, ...rows].map((c) => [c.id, c])).values()]);
      setCardError('');
    } catch { setCardError('Could not load job cards. Search again or reload this page to retry.'); }
  }, [canAllocate, lot.customerId]);
  useEffect(() => { searchCards(); }, [searchCards]);

  async function allocate(e) {
    e.preventDefault();
    const next = {
      jobcardId: jobcardId ? null : 'Choose a job card',
      qty: trackedQuantity(qty, 'Quantity'),
      weight: trackedQuantity(weight, 'Weight'),
    };
    if (!next.qty && Number(qty) > Number(lot.unallocatedQty)) next.qty = 'Quantity exceeds the unallocated amount';
    if (!next.weight && lot.unallocatedWeight != null && Number(weight) > Number(lot.unallocatedWeight)) next.weight = 'Weight exceeds the unallocated amount';
    if (Object.values(next).some(Boolean)) { setErrors(next); return; }
    setBusy(true);
    try {
      await api.post(`/customer-material/${lot.id}/allocations`, { jobcardId: Number(jobcardId), qty: Number(qty), weight: Number(weight) });
      setJobcardId(''); setQty(''); setWeight(''); setErrors({});
      toast.success('Material reserved for job card');
      await onChange();
    } catch (err) { toast.error(err.response && err.response.status < 500 ? (err.response.data?.message || 'Could not reserve material') : 'Reservation result is uncertain. Refresh and verify before retrying.'); }
    finally { setBusy(false); }
  }

  async function confirmRelease() {
    if (reason.trim().length < 3) { setErrors({ reason: 'Enter a reason of at least 3 characters' }); return; }
    setBusy(true);
    try {
      await api.post(`/customer-material/${lot.id}/allocations/${release.id}/release`, { reason: reason.trim() });
      setRelease(null); setReason(''); setErrors({});
      toast.success('Reservation released');
      await onChange();
    } catch (err) { toast.error(err.response && err.response.status < 500 ? (err.response.data?.message || 'Could not release reservation') : 'Release result is uncertain. Refresh and verify before retrying.'); }
    finally { setBusy(false); }
  }

  async function confirmReconcile() {
    const value = String(measured).trim();
    const weightError = value === '' || !Number.isFinite(Number(value)) || Number(value) < 0
      ? 'Enter a non-negative measured weight'
      : numericPrecision(value, 'Weight', 3, '99999999999.999');
    const next = { measured: weightError, reason: reason.trim().length < 3 ? 'Enter a reason of at least 3 characters' : null };
    if (Object.values(next).some(Boolean)) { setErrors(next); return; }
    setBusy(true);
    try {
      await api.post(`/customer-material/${lot.id}/reconcile-weight`, { weight: Number(measured), reason: reason.trim() });
      setReconcile(false); setMeasured(''); setReason(''); setErrors({});
      toast.success('On-hand weight reconciled');
      await onChange();
    } catch (err) { toast.error(err.response && err.response.status < 500 ? (err.response.data?.message || 'Could not reconcile weight') : 'Measurement result is uncertain. Refresh and verify before retrying.'); }
    finally { setBusy(false); }
  }

  const allocations = lot.allocations || [];
  return (
    <section className="space-y-4 border-t border-slate-200 pt-5" aria-label="Job card material reservations">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-900">Job card reservations</h2>
          <p className="text-xs text-slate-500">Reservations do not move stock. Release a reservation before issuing or consuming it.</p>
        </div>
        {canUpdate && <button type="button" className="btn-secondary" onClick={() => { setReason(''); setMeasured(''); setErrors({}); setReconcile(true); }}>Reconcile on-hand weight</button>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div><span className="text-slate-500">Reserved qty:</span> <strong>{Number(lot.reservedQty)}</strong></div>
        <div><span className="text-slate-500">Unallocated qty:</span> <strong>{Number(lot.unallocatedQty)}</strong></div>
        <div><span className="text-slate-500">On-hand weight:</span> <strong>{lot.currentWeight == null ? 'Unknown' : Number(lot.currentWeight)}</strong></div>
        <div><span className="text-slate-500">Reserved weight:</span> <strong>{Number(lot.reservedWeight)}</strong></div>
        <div><span className="text-slate-500">Unallocated weight:</span> <strong>{lot.unallocatedWeight == null ? 'Unknown' : Number(lot.unallocatedWeight)}</strong></div>
      </div>
      {lot.currentWeight == null && <p className="text-sm text-amber-700">On-hand weight is unknown. Reconcile a measured value before reserving. Unmeasured movements make it unknown again.</p>}
      {lot.allocationDetailsRestricted && <p className="text-sm text-amber-700">Some reservation details are hidden by job card permissions; totals include all reservations.</p>}
      {allocations.length > 0 && <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="table-th">Job card</th><th className="table-th text-right">Qty</th><th className="table-th text-right">Weight</th><th className="table-th">Status</th><th className="table-th"></th></tr></thead>
          <tbody>{allocations.map((a) => <tr key={a.id}>
            <td className="table-td">{a.jobcard?.number || `#${a.jobcardId}`}</td>
            <td className="table-td text-right">{Number(a.qty)}</td><td className="table-td text-right">{Number(a.weight)}</td>
            <td className="table-td">{a.releasedAt ? 'Released' : 'Reserved'}</td>
            <td className="table-td">{canAllocate && !a.releasedAt && <button type="button" className="btn-secondary" onClick={() => { setRelease(a); setReason(''); setErrors({}); }}>Release</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {canAllocate && !['CONSUMED', 'DISPATCHED', 'RETURNED_TO_CUSTOMER'].includes(lot.status) && <form onSubmit={allocate} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField id="allocation-card" label="Job card" required error={errors.jobcardId}>
            <SearchableSelect id="allocation-card" value={jobcardId} onChange={setJobcardId} onSearchChange={searchCards}
              options={cards.map((c) => ({ value: c.id, label: c.number }))} placeholder="Search job card number…" />
          </FormField>
          <FormField id="allocation-qty" label="Reserve quantity" required error={errors.qty}>
            <input id="allocation-qty" type="number" min="0" step="0.001" className={styles.input} value={qty} onChange={(e) => setQty(e.target.value)} />
          </FormField>
          <FormField id="allocation-weight" label="Measured weight" required error={errors.weight}>
            <input id="allocation-weight" type="number" min="0" step="0.001" className={styles.input} value={weight} onChange={(e) => setWeight(e.target.value)} />
          </FormField>
        </div>
        {cardError && <p role="alert" className="text-sm text-red-700">{cardError}</p>}
        <button type="submit" className="btn-primary" disabled={busy || lot.currentWeight == null || !!cardError}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Reserve material</button>
      </form>}
      <Modal open={!!release} onClose={() => setRelease(null)} title="Release reservation" description="This makes the unused quantity and weight available again; it does not move stock." size="md"
        footer={<><button type="button" className={styles.secondaryBtn} onClick={() => setRelease(null)} disabled={busy}>Cancel</button><button type="button" className={styles.primaryBtn} onClick={confirmRelease} disabled={busy}>Release</button></>}>
        <FormField id="release-reason" label="Reason" required error={errors.reason}><input id="release-reason" className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </Modal>
      <Modal open={reconcile} onClose={() => setReconcile(false)} title="Reconcile measured on-hand weight" description="Enter the actual weight currently on hand, not the original inward weight or material still at a vendor." size="md"
        footer={<><button type="button" className={styles.secondaryBtn} onClick={() => setReconcile(false)} disabled={busy}>Cancel</button><button type="button" className={styles.primaryBtn} onClick={confirmReconcile} disabled={busy}>Save measurement</button></>}>
        <div className="space-y-3">
          <FormField id="measured-weight" label="Measured on-hand weight" required error={errors.measured}><input id="measured-weight" type="number" min="0" step="0.001" className={styles.input} value={measured} onChange={(e) => setMeasured(e.target.value)} /></FormField>
          <FormField id="measure-reason" label="Reason" required error={errors.reason}><input id="measure-reason" className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
        </div>
      </Modal>
    </section>
  );
}
