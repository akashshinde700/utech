import { useEffect, useMemo, useState } from 'react';
import { Send, Plus, Trash2, Package } from 'lucide-react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import FormField from '../ui/FormField';
import SearchableSelect from '../ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { todayLocal, toLocalInput } from '../../lib/format';

const newMaterialLine = () => ({ itemId: '', qtySent: '', rate: '', notes: '' });

// The moment the user asked to capture: the scope leaves the building. If
// physical material goes with the drawings we also raise a jobwork challan
// server-side, which is the one document allowed to move company stock — so
// ticking the box here is what makes stock go OUT, exactly once.
export default function SendToVendorModal({ workOrder, onClose, onSaved }) {
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    sentDate: todayLocal(),
    expectedReturnDate: workOrder.expectedReturnDate
      ? toLocalInput(workOrder.expectedReturnDate)
      : '',
    notes: '',
  });
  const [issueMaterial, setIssueMaterial] = useState(false);
  const [materialLines, setMaterialLines] = useState([newMaterialLine()]);

  useEffect(() => {
    if (issueMaterial && !items.length) {
      api.get('/items', { params: { pageSize: 200 } }).then((r) => setItems(r.data.items));
    }
  }, [issueMaterial, items.length]);

  const itemOptions = useMemo(
    () =>
      items.map((it) => ({
        value: it.id,
        label: `${it.code} — ${it.name}`,
        subtitle: `stock ${Number(it.currentStock)}`,
      })),
    [items]
  );

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function setMaterialLine(i, key, value) {
    setMaterialLines((prev) => prev.map((l, ix) => (ix === i ? { ...l, [key]: value } : l)));
    setErrors((e) => {
      const lineErrs = e.lines?.[i];
      if (!lineErrs || !(key in lineErrs)) return e;
      const nextLine = { ...lineErrs };
      delete nextLine[key];
      const nextLines = { ...e.lines };
      if (Object.keys(nextLine).length) nextLines[i] = nextLine;
      else delete nextLines[i];
      return { ...e, lines: nextLines };
    });
  }

  function validate() {
    const errs = {};
    if (!form.sentDate) errs.sentDate = 'Sent on date is required';
    if (issueMaterial) {
      const lineErrs = {};
      materialLines.forEach((l, i) => {
        if (!l.itemId && String(l.qtySent ?? '').trim() === '') return; // untouched row
        const le = {};
        if (!l.itemId) le.itemId = 'Pick an item';
        const qty = String(l.qtySent ?? '').trim();
        if (!qty) le.qtySent = 'Qty is required';
        else if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) le.qtySent = 'Qty must be greater than 0';
        const rate = String(l.rate ?? '').trim();
        if (rate !== '' && (!Number.isFinite(Number(rate)) || Number(rate) < 0)) le.rate = 'Rate must be 0 or more';
        if (Object.keys(le).length) lineErrs[i] = le;
      });
      if (Object.keys(lineErrs).length) errs.lines = lineErrs;
    }
    return errs;
  }

  async function save() {
    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      if (nextErrors.lines) {
        const i = Object.keys(nextErrors.lines)[0];
        document.getElementById(`material-${i}-qty`)?.focus();
      } else {
        document.getElementById(nextErrors.sentDate ? 'sentDate' : undefined)?.focus();
      }
      return;
    }
    setErrors({});

    let payloadMaterial;
    if (issueMaterial) {
      payloadMaterial = materialLines
        .filter((l) => l.itemId && Number(l.qtySent) > 0)
        .map((l) => ({
          itemId: Number(l.itemId),
          qtySent: Number(l.qtySent),
          rate: l.rate === '' ? null : Number(l.rate),
          notes: l.notes.trim() || null,
        }));
      if (!payloadMaterial.length) {
        toast.error('Add at least one material line with an item and a quantity, or untick material issue');
        return;
      }
    }

    setSaving(true);
    try {
      await api.post(`/vendor-work-orders/${workOrder.id}/send`, {
        sentDate: form.sentDate,
        expectedReturnDate: form.expectedReturnDate || null,
        notes: form.notes.trim() || null,
        ...(payloadMaterial ? { materialLines: payloadMaterial } : {}),
      });
      toast.success(`Sent to ${workOrder.party?.name}`);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send to vendor');
    } finally {
      setSaving(false);
    }
  }

  const lineError = (i, key) => errors.lines?.[i]?.[key] || null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Send to Vendor"
      description={`${workOrder.number} — ${workOrder.party?.name}`}
      size="lg"
      footer={
        <>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.primaryBtn} disabled={saving} onClick={save}>
            <Send className="w-4 h-4" /> Confirm Send
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className={styles.formGrid}>
          <FormField id="sentDate" label="Sent on" required error={errors.sentDate}>
            <input
              id="sentDate"
              type="date"
              className={`${styles.input} ${errors.sentDate ? styles.inputError : ''}`}
              aria-invalid={!!errors.sentDate}
              aria-describedby={errors.sentDate ? 'sentDate-error' : undefined}
              value={form.sentDate}
              onChange={(e) => setField('sentDate', e.target.value)}
            />
          </FormField>
          <FormField id="expectedReturnDate" label="Expected back by">
            <input
              id="expectedReturnDate"
              type="date"
              className={styles.input}
              value={form.expectedReturnDate}
              onChange={(e) => setField('expectedReturnDate', e.target.value)}
            />
          </FormField>
        </div>

        <FormField id="dispatchNotes" label="Dispatch notes">
          <textarea
            id="dispatchNotes"
            className={styles.textarea}
            rows={2}
            placeholder="e.g. drawings emailed, hard copy handed to vendor representative"
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
          />
        </FormField>

        <div className="rounded-xl border border-slate-200 p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={issueMaterial}
              onChange={(e) => setIssueMaterial(e.target.checked)}
            />
            <span>
              <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-brand-600" /> Company material is issued with this work
              </span>
              <span className="block text-xs text-slate-400 mt-0.5">
                Leave unticked when the vendor manufactures from their own raw material — then only drawings go
                out and company stock is untouched. Ticking it raises a jobwork challan and moves stock OUT.
              </span>
            </span>
          </label>

          {issueMaterial && (
            <div className="mt-3">
              <div className="overflow-x-auto scroll-x-hint">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className="table-th min-w-[13rem]">Item *</th>
                      <th className="table-th min-w-[6rem]">Qty *</th>
                      <th className="table-th min-w-[6rem]">Rate</th>
                      <th className="table-th min-w-[8rem]">Notes</th>
                      <th className="table-th w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialLines.map((l, i) => (
                      <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                        <td className="table-td">
                          <SearchableSelect
                            value={l.itemId}
                            onChange={(v) => setMaterialLine(i, 'itemId', v)}
                            options={itemOptions}
                            placeholder="Select item…"
                            loading={issueMaterial && !items.length}
                            error={lineError(i, 'itemId')}
                          />
                          {lineError(i, 'itemId') && (
                            <p id={`material-${i}-item-error`} role="alert" className={styles.errorText}>{lineError(i, 'itemId')}</p>
                          )}
                        </td>
                        <td className="table-td">
                          <input
                            id={`material-${i}-qty`}
                            aria-label={`Material line ${i + 1} quantity`}
                            type="number"
                            step="0.001"
                            min="0"
                            className={`${styles.input} !h-9 !text-xs tabular-nums ${lineError(i, 'qtySent') ? styles.inputError : ''}`}
                            aria-invalid={!!lineError(i, 'qtySent')}
                            aria-describedby={lineError(i, 'qtySent') ? `material-${i}-qty-error` : undefined}
                            value={l.qtySent}
                            onChange={(e) => setMaterialLine(i, 'qtySent', e.target.value)}
                          />
                          {lineError(i, 'qtySent') && (
                            <p id={`material-${i}-qty-error`} role="alert" className={styles.errorText}>{lineError(i, 'qtySent')}</p>
                          )}
                        </td>
                        <td className="table-td">
                          <input
                            aria-label={`Material line ${i + 1} rate`}
                            type="number"
                            step="0.01"
                            min="0"
                            className={`${styles.input} !h-9 !text-xs tabular-nums ${lineError(i, 'rate') ? styles.inputError : ''}`}
                            value={l.rate}
                            onChange={(e) => setMaterialLine(i, 'rate', e.target.value)}
                          />
                          {lineError(i, 'rate') && <p role="alert" className={styles.errorText}>{lineError(i, 'rate')}</p>}
                        </td>
                        <td className="table-td">
                          <input
                            aria-label={`Material line ${i + 1} notes`}
                            className={`${styles.input} !h-9 !text-xs`}
                            value={l.notes}
                            onChange={(e) => setMaterialLine(i, 'notes', e.target.value)}
                          />
                        </td>
                        <td className="table-td">
                          <button
                            type="button"
                            className="btn-danger !px-2 !py-1"
                            aria-label={`Remove material line ${i + 1}`}
                            onClick={() => setMaterialLines((prev) => prev.filter((_, ix) => ix !== i))}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="btn-secondary !px-2 !py-1 text-xs mt-2"
                onClick={() => setMaterialLines((prev) => [...prev, newMaterialLine()])}
              >
                <Plus className="w-3.5 h-3.5" /> Add material line
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
