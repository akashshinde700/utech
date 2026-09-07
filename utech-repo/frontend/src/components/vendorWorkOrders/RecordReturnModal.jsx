import { useState } from 'react';
import { PackageCheck } from 'lucide-react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import FormField from '../ui/FormField';
import { styles } from '../../lib/formStyles';

const lineLabel = (l) => l.item?.name || l.description || l.partNumber || l.drawingNumber || `Line ${l.id}`;
const outstanding = (l) => Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected);

// Used only for work orders with no purchase order behind them (drawings out,
// parts back, nothing to invoice). Once a PO exists the server refuses this and
// the receipt has to come through a GRN instead, so quantities always have
// exactly one owner.
export default function RecordReturnModal({ workOrder, onClose, onSaved }) {
  const [rows, setRows] = useState(() =>
    workOrder.lines.map((l) => ({ id: l.id, qtyReceived: '', qtyRejected: '' }))
  );
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({}); // { [lineId]: { qtyReceived, qtyRejected } }

  function setRow(id, key, value) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    setErrors((e) => {
      const rowErrs = e[id];
      if (!rowErrs || !(key in rowErrs)) return e;
      const nextRow = { ...rowErrs };
      delete nextRow[key];
      const next = { ...e };
      if (Object.keys(nextRow).length) next[id] = nextRow;
      else delete next[id];
      return next;
    });
  }

  function validate() {
    const errs = {};
    for (const r of rows) {
      const line = workOrder.lines.find((l) => l.id === r.id);
      const open = outstanding(line);
      const rowErrs = {};
      for (const key of ['qtyReceived', 'qtyRejected']) {
        const v = String(r[key] ?? '').trim();
        if (v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) rowErrs[key] = 'Enter a valid quantity';
        else if (n > open) rowErrs[key] = `Only ${open} outstanding`;
      }
      if (Object.keys(rowErrs).length) errs[r.id] = rowErrs;
    }
    return errs;
  }

  async function save() {
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      const firstId = Object.keys(nextErrors)[0];
      document.getElementById(`return-${firstId}-qtyReceived`)?.focus();
      return;
    }
    setErrors({});

    const payload = rows
      .map((r) => ({
        id: r.id,
        qtyReceived: Number(r.qtyReceived || 0),
        qtyRejected: Number(r.qtyRejected || 0),
      }))
      .filter((r) => r.qtyReceived > 0 || r.qtyRejected > 0);

    if (!payload.length) {
      toast.error('Enter a received or rejected quantity on at least one line');
      return;
    }
    // caught here as well as server-side so the user sees which line is wrong
    for (const r of payload) {
      const line = workOrder.lines.find((l) => l.id === r.id);
      if (r.qtyReceived + r.qtyRejected > outstanding(line)) {
        toast.error(`"${lineLabel(line)}" only has ${outstanding(line)} outstanding`);
        return;
      }
    }

    setSaving(true);
    try {
      await api.post(`/vendor-work-orders/${workOrder.id}/receive`, {
        lines: payload,
        remarks: remarks.trim() || null,
      });
      toast.success('Return recorded');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record the return');
    } finally {
      setSaving(false);
    }
  }

  const rowError = (id, key) => errors[id]?.[key] || null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Record Return from Vendor"
      description={`${workOrder.number} — ${workOrder.party?.name}`}
      size="lg"
      footer={
        <>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.primaryBtn} disabled={saving} onClick={save}>
            <PackageCheck className="w-4 h-4" /> Save Return
          </button>
        </>
      }
    >
      <div className="overflow-x-auto scroll-x-hint">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="table-th min-w-[10rem]">Part</th>
              <th className="table-th w-20 text-right">Sent</th>
              <th className="table-th w-24 text-right">Outstanding</th>
              <th className="table-th w-32">Received now</th>
              <th className="table-th w-32">Rejected now</th>
            </tr>
          </thead>
          <tbody>
            {workOrder.lines.map((l, i) => {
              const open = outstanding(l);
              const row = rows.find((r) => r.id === l.id);
              return (
                <tr key={l.id} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                  <td className="table-td">
                    <div className="font-medium text-slate-800">{lineLabel(l)}</div>
                    {l.drawingNumber && (
                      <div className="text-[11px] text-slate-400">Drg: {l.drawingNumber}</div>
                    )}
                  </td>
                  <td className="table-td text-right tabular-nums font-mono">{Number(l.qtySent)}</td>
                  <td className="table-td text-right tabular-nums font-mono font-semibold">{open}</td>
                  <td className="table-td">
                    <input
                      id={`return-${l.id}-qtyReceived`}
                      aria-label={`${lineLabel(l)} — quantity received now`}
                      type="number"
                      step="0.001"
                      min="0"
                      max={open}
                      className={`${styles.input} !h-9 !text-xs tabular-nums ${rowError(l.id, 'qtyReceived') ? styles.inputError : ''}`}
                      aria-invalid={!!rowError(l.id, 'qtyReceived')}
                      disabled={open <= 0}
                      value={row?.qtyReceived ?? ''}
                      onChange={(e) => setRow(l.id, 'qtyReceived', e.target.value)}
                    />
                    {rowError(l.id, 'qtyReceived') && (
                      <p role="alert" className={styles.errorText}>{rowError(l.id, 'qtyReceived')}</p>
                    )}
                  </td>
                  <td className="table-td">
                    <input
                      id={`return-${l.id}-qtyRejected`}
                      aria-label={`${lineLabel(l)} — quantity rejected now`}
                      type="number"
                      step="0.001"
                      min="0"
                      max={open}
                      className={`${styles.input} !h-9 !text-xs tabular-nums ${rowError(l.id, 'qtyRejected') ? styles.inputError : ''}`}
                      aria-invalid={!!rowError(l.id, 'qtyRejected')}
                      disabled={open <= 0}
                      value={row?.qtyRejected ?? ''}
                      onChange={(e) => setRow(l.id, 'qtyRejected', e.target.value)}
                    />
                    {rowError(l.id, 'qtyRejected') && (
                      <p role="alert" className={styles.errorText}>{rowError(l.id, 'qtyRejected')}</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <FormField id="returnRemarks" label="Remarks">
          <textarea
            id="returnRemarks"
            className={styles.textarea}
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </FormField>
      </div>
    </Modal>
  );
}
