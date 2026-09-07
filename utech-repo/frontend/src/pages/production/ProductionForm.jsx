import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, X, Plus, Trash2, Play, Check, Loader2, Factory, Package } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, validateAll } from '../../lib/validation';
import { toLocalInput } from '../../lib/format';
import toast from 'react-hot-toast';

export default function ProductionForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [saving, setSaving] = useState(false);
  const [shifts, setShifts] = useState([]);
  const [jobcards, setJobcards] = useState([]);
  const [items, setItems] = useState([]);
  const [boms, setBoms] = useState([]);
  const [machines, setMachines] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [errors, setErrors] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [confirmStart, setConfirmStart] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeForm, setCompleteForm] = useState({ qtyProduced: '', qtyRejected: '0' });
  const [completeErrors, setCompleteErrors] = useState({});
  const [data, setData] = useState(null);
  const [formData, setFormData] = useState({
    shiftId: '',
    jobcardId: '',
    itemId: '',
    bomId: '',
    machineId: '',
    date: toLocalInput(),
    qtyPlanned: '',
    notes: '',
  });

  async function loadShifts() {
    const { data: response } = await api.get('/production/shifts');
    setShifts(response || []);
  }

  async function loadJobcards() {
    const { data: response } = await api.get('/jobcards', { params: { pageSize: 1000, status: 'IN_PROGRESS' } });
    setJobcards(response.items || []);
  }

  async function loadItems() {
    const { data: response } = await api.get('/items', { params: { pageSize: 1000, type: 'FINISHED,SEMI_FINISHED' } });
    setItems(response.items || []);
  }

  async function loadBoms() {
    const { data: response } = await api.get('/boms', { params: { pageSize: 1000 } });
    setBoms(response.items || []);
  }

  async function loadMachines() {
    const { data: response } = await api.get('/machines', { params: { pageSize: 1000, status: 'ACTIVE' } });
    setMachines(response.items || []);
  }

  async function loadAllItems() {
    const { data: response } = await api.get('/items', { params: { pageSize: 1000 } });
    setAllItems(response.items || []);
  }

  async function loadBatch() {
    if (!id) return;
    const { data: response } = await api.get(`/production/batches/${id}`);
    setData(response);
    setFormData({
      shiftId: response.shiftId,
      jobcardId: response.jobcardId || '',
      itemId: response.itemId,
      bomId: response.bomId || '',
      machineId: response.machineId || '',
      date: response.date.split('T')[0],
      qtyPlanned: response.qtyPlanned,
      notes: response.notes || '',
    });
    setMaterials(response.materialConsumptions || []);
  }

  async function loadBomItems(bomId) {
    if (!bomId) return;
    const { data: response } = await api.get(`/boms/${bomId}`);
    setMaterials(response.items.map((i) => ({
      itemId: i.itemId,
      qtyPlanned: i.qty,
      qtyConsumed: 0,
      uomCode: i.uomCode,
      notes: i.notes,
    })));
  }

  useEffect(() => { loadShifts(); loadJobcards(); loadItems(); loadBoms(); loadMachines(); loadAllItems(); if (id) loadBatch(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (formData.bomId && !id) loadBomItems(formData.bomId); }, [formData.bomId, id]);

  const shiftOptions = shifts.map((s) => ({
    value: s.id,
    label: `${s.code} — ${s.name}`,
    subtitle: `${s.startTime} to ${s.endTime}`,
  }));
  const jobcardOptions = jobcards.map((j) => ({ value: j.id, label: j.number, subtitle: j.itemDescription || undefined }));
  const itemOptions = items.map((i) => ({ value: i.id, label: `${i.code} — ${i.name}` }));
  const bomOptions = boms.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  const machineOptions = machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }));
  const allItemOptions = allItems.map((i) => ({ value: i.id, label: `${i.code} — ${i.name}` }));

  function setField(key, value) {
    setFormData((f) => ({ ...f, [key]: value }));
    setErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  function addMaterial() {
    setMaterials([...materials, { itemId: '', qtyPlanned: 0, qtyConsumed: 0, uomCode: '', notes: '' }]);
  }

  function updateMaterial(index, field, value) {
    const updated = [...materials];
    updated[index][field] = value;
    setMaterials(updated);
    setRowErrors((errs) => {
      const key = `m${index}_${field}`;
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  function removeMaterial(index) {
    setMaterials(materials.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const schema = {
      shiftId: (v) => required(v, 'Shift'),
      date: (v) => required(v, 'Date'),
      itemId: (v) => required(v, 'Item'),
      qtyPlanned: (v) => positiveNumber(v, 'Planned quantity'),
    };
    materials.forEach((m, idx) => {
      if (!isEdit) schema[`m${idx}_itemId`] = () => required(m.itemId, 'Material item');
      if (!isEdit) {
        schema[`m${idx}_qtyPlanned`] = () => {
          const s = String(m.qtyPlanned ?? '').trim();
          if (s === '') return 'Material planned qty is required';
          const n = Number(s);
          if (!Number.isFinite(n) || n < 0) return 'Must be 0 or more';
          return null;
        };
      }
      schema[`m${idx}_qtyConsumed`] = () => {
        const s = String(m.qtyConsumed ?? '').trim();
        if (s === '') return null;
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) return 'Must be 0 or more';
        return null;
      };
    });
    const { errors: nextErrors, ok } = validateAll(formData, schema);
    if (!ok) {
      setErrors(nextErrors);
      setRowErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...formData,
        shiftId: parseInt(formData.shiftId),
        jobcardId: formData.jobcardId ? parseInt(formData.jobcardId) : null,
        itemId: parseInt(formData.itemId),
        bomId: formData.bomId ? parseInt(formData.bomId) : null,
        machineId: formData.machineId ? parseInt(formData.machineId) : null,
        qtyPlanned: parseFloat(formData.qtyPlanned),
        materialConsumptions: materials.map((m) => ({
          ...m,
          itemId: parseInt(m.itemId),
          qtyPlanned: parseFloat(m.qtyPlanned),
          qtyConsumed: parseFloat(m.qtyConsumed),
        })),
      };
      if (isEdit) {
        await api.put(`/production/batches/${id}`, payload);
      } else {
        await api.post('/production/batches', payload);
      }
      toast.success(isEdit ? 'Batch updated' : 'Batch created');
      navigate('/production/batches');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error saving production batch');
    } finally {
      setSaving(false);
    }
  }

  async function handleStart() {
    setStartBusy(true);
    try {
      await api.post(`/production/batches/${id}/start`);
      toast.success('Started');
      setConfirmStart(false);
      loadBatch();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error starting');
    } finally {
      setStartBusy(false);
    }
  }

  function openComplete() {
    setCompleteForm({ qtyProduced: '', qtyRejected: '0' });
    setCompleteErrors({});
    setCompleting(true);
  }

  async function handleComplete() {
    const { errors: nextErrors, ok } = validateAll(completeForm, {
      qtyProduced: (v) => positiveNumber(v, 'Quantity produced'),
      qtyRejected: (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return null;
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) return 'Must be 0 or more';
        return null;
      },
    });
    if (!ok) {
      setCompleteErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setCompleteBusy(true);
    try {
      await api.post(`/production/batches/${id}/complete`, {
        qtyProduced: parseFloat(completeForm.qtyProduced),
        qtyRejected: Number(completeForm.qtyRejected || 0),
      });
      toast.success('Completed');
      setCompleting(false);
      loadBatch();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error completing');
    } finally {
      setCompleteBusy(false);
    }
  }

  // the backend only persists qtyConsumed edits post-creation, one material
  // row at a time — this is the only field a completed BOM line can still
  // update while the batch is IN_PROGRESS
  async function saveMaterialConsumption(material) {
    const qty = parseFloat(material.qtyConsumed);
    if (!Number.isFinite(qty) || qty < 0) { toast.error('Enter a valid consumed quantity'); return; }
    try {
      await api.post(`/production/batches/${id}/materials`, { materialId: material.id, qtyConsumed: qty });
      toast.success('Consumption updated');
      loadBatch();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update consumption');
    }
  }

  const rowError = (idx, field) => rowErrors[`m${idx}_${field}`] || null;

  return (
    <div>
      <PageHeader
        title={isEdit ? `Production Batch ${data?.number || ''}` : 'New Production Batch'}
        subtitle="Planned output for a shift against an item / BOM"
        action={
          <button onClick={() => navigate('/production/batches')} className={styles.secondaryBtn}>
            <X className="h-4 w-4" aria-hidden="true" /> Cancel
          </button>
        }
      />
      <form onSubmit={handleSubmit} className="max-w-5xl space-y-5" noValidate>
        <FormSection icon={Factory} title="Batch Details" description="Shift, item and planned quantity">
          <div className={styles.formGrid}>
            <FormField id="batch-shift" label="Shift" required error={errors.shiftId}>
              {isEdit ? (
                <input
                  id="batch-shift"
                  className={styles.input}
                  value={shiftOptions.find((o) => String(o.value) === String(formData.shiftId))?.label || formData.shiftId}
                  readOnly
                  disabled
                />
              ) : (
                <SearchableSelect
                  id="batch-shift"
                  value={formData.shiftId}
                  onChange={(v) => setField('shiftId', v)}
                  options={shiftOptions}
                  placeholder="Select shift…"
                  error={errors.shiftId}
                />
              )}
            </FormField>
            <FormField id="batch-date" label="Date" required error={errors.date}>
              <input
                id="batch-date"
                type="date"
                className={`${styles.input} ${errors.date ? styles.inputError : ''}`}
                aria-invalid={!!errors.date}
                aria-describedby={errors.date ? 'batch-date-error' : undefined}
                value={formData.date}
                onChange={(e) => setField('date', e.target.value)}
              />
            </FormField>
            <FormField id="batch-jobcard" label="Jobcard" hint="Links this batch to an open jobcard">
              {isEdit ? (
                <input
                  id="batch-jobcard"
                  className={styles.input}
                  value={jobcardOptions.find((o) => String(o.value) === String(formData.jobcardId))?.label || '—'}
                  readOnly
                  disabled
                />
              ) : (
                <SearchableSelect
                  id="batch-jobcard"
                  value={formData.jobcardId}
                  onChange={(v) => setField('jobcardId', v)}
                  options={jobcardOptions}
                  placeholder="Select jobcard…"
                  allowClear
                />
              )}
            </FormField>
            <FormField id="batch-item" label="Item" required error={errors.itemId}>
              {isEdit ? (
                <input
                  id="batch-item"
                  className={styles.input}
                  value={itemOptions.find((o) => String(o.value) === String(formData.itemId))?.label || formData.itemId}
                  readOnly
                  disabled
                />
              ) : (
                <SearchableSelect
                  id="batch-item"
                  value={formData.itemId}
                  onChange={(v) => setField('itemId', v)}
                  options={itemOptions}
                  placeholder="Select item…"
                  error={errors.itemId}
                />
              )}
            </FormField>
            <FormField id="batch-bom" label="BOM" hint="Auto-loads planned material consumption">
              {isEdit ? (
                <input
                  id="batch-bom"
                  className={styles.input}
                  value={bomOptions.find((o) => String(o.value) === String(formData.bomId))?.label || '—'}
                  readOnly
                  disabled
                />
              ) : (
                <SearchableSelect
                  id="batch-bom"
                  value={formData.bomId}
                  onChange={(v) => setField('bomId', v)}
                  options={bomOptions}
                  placeholder="Select BOM…"
                  allowClear
                />
              )}
            </FormField>
            <FormField id="batch-machine" label="Machine">
              <SearchableSelect
                id="batch-machine"
                value={formData.machineId}
                onChange={(v) => setField('machineId', v)}
                options={machineOptions}
                placeholder="Select machine…"
                allowClear
              />
            </FormField>
            <FormField id="batch-qty" label="Planned Quantity" required error={errors.qtyPlanned}>
              <input
                id="batch-qty"
                type="number"
                step="0.001"
                className={`${styles.input} tabular-nums ${errors.qtyPlanned ? styles.inputError : ''}`}
                aria-invalid={!!errors.qtyPlanned}
                aria-describedby={errors.qtyPlanned ? 'batch-qty-error' : undefined}
                value={formData.qtyPlanned}
                onChange={(e) => setField('qtyPlanned', e.target.value)}
              />
            </FormField>
            <FormField id="batch-notes" label="Notes" className="sm:col-span-2">
              <textarea
                id="batch-notes"
                className={styles.textarea}
                rows={2}
                value={formData.notes}
                onChange={(e) => setField('notes', e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={Package}
          title="Material Consumption"
          description={isEdit ? 'Only consumed quantities can be edited after creation' : 'Select a BOM to auto-load materials, or add rows manually'}
          actions={
            !isEdit && (
              <button type="button" onClick={addMaterial} className={styles.secondaryBtn}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Add Material
              </button>
            )
          }
        >
          {materials.length === 0 ? (
            <p className="text-sm text-slate-500">No materials added. Select a BOM to auto-load materials.</p>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium text-slate-400 lg:grid">
                <div className="col-span-4">Item</div>
                <div className="col-span-2">Planned</div>
                <div className="col-span-2">Consumed</div>
                <div className="col-span-1">UoM</div>
                <div className="col-span-2">Notes</div>
                <div className="col-span-1" />
              </div>
              {materials.map((material, idx) => (
                <div key={material.id ?? idx} className="grid grid-cols-1 gap-2 lg:grid-cols-12 lg:items-start">
                  <div className="lg:col-span-4">
                    {!isEdit ? (
                      <SearchableSelect
                        id={`mat-item-${idx}`}
                        value={material.itemId}
                        onChange={(v) => updateMaterial(idx, 'itemId', v)}
                        options={allItemOptions}
                        placeholder="Select item…"
                        error={rowError(idx, 'itemId')}
                      />
                    ) : (
                      <input className={styles.input} value={allItems.find((i) => i.id === material.itemId)?.name || ''} readOnly />
                    )}
                  </div>
                  <div className="lg:col-span-2">
                    <input
                      aria-label={`Planned quantity for material ${idx + 1}`}
                      className={`${styles.input} tabular-nums ${rowError(idx, 'qtyPlanned') ? styles.inputError : ''}`}
                      type="number"
                      step="0.001"
                      placeholder="Planned"
                      value={material.qtyPlanned}
                      onChange={(e) => updateMaterial(idx, 'qtyPlanned', e.target.value)}
                      readOnly={isEdit}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <input
                      aria-label={`Consumed quantity for material ${idx + 1}`}
                      className={`${styles.input} tabular-nums ${rowError(idx, 'qtyConsumed') ? styles.inputError : ''}`}
                      type="number"
                      step="0.001"
                      placeholder="Consumed"
                      value={material.qtyConsumed}
                      onChange={(e) => updateMaterial(idx, 'qtyConsumed', e.target.value)}
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <input
                      aria-label={`UoM for material ${idx + 1}`}
                      className={styles.input}
                      placeholder="UoM"
                      value={material.uomCode}
                      onChange={(e) => updateMaterial(idx, 'uomCode', e.target.value)}
                      readOnly={isEdit}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <input
                      aria-label={`Notes for material ${idx + 1}`}
                      className={styles.input}
                      placeholder="Notes"
                      value={material.notes}
                      onChange={(e) => updateMaterial(idx, 'notes', e.target.value)}
                      readOnly={isEdit}
                    />
                  </div>
                  <div className="lg:col-span-1">
                    {!isEdit && (
                      <button type="button" onClick={() => removeMaterial(idx)} className="btn-icon text-danger-600 hover:bg-danger-50" aria-label={`Remove material ${idx + 1}`}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                    {isEdit && data?.status === 'IN_PROGRESS' && (
                      <button type="button" onClick={() => saveMaterialConsumption(material)} className="btn-icon text-brand-700 hover:bg-brand-50" title="Save consumed quantity" aria-label={`Save consumed quantity for material ${idx + 1}`}>
                        <Save className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.actionsBar}>
            <div className="flex gap-2 sm:mr-auto">
              {isEdit && data?.status === 'PLANNED' && (
                <button type="button" onClick={() => setConfirmStart(true)} className={styles.secondaryBtn}>
                  <Play className="h-4 w-4" aria-hidden="true" /> Start
                </button>
              )}
              {isEdit && data?.status === 'IN_PROGRESS' && (
                <button type="button" onClick={openComplete} className={styles.secondaryBtn}>
                  <Check className="h-4 w-4" aria-hidden="true" /> Complete
                </button>
              )}
            </div>
            <button type="button" onClick={() => navigate('/production/batches')} className={styles.secondaryBtn}>Cancel</button>
            {!isEdit && (
              <button type="submit" disabled={saving} className={styles.primaryBtn}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </FormSection>
      </form>

      <ConfirmDialog
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        onConfirm={handleStart}
        title="Start this production batch?"
        message="The batch will move to IN_PROGRESS and material consumption can be recorded."
        confirmLabel="Start batch"
        loading={startBusy}
      />

      <Modal
        open={completing}
        onClose={() => setCompleting(false)}
        title="Complete batch"
        description="Record the final output quantities for this batch"
        size="md"
        footer={
          <>
            <button type="button" className={styles.secondaryBtn} onClick={() => setCompleting(false)} disabled={completeBusy}>Cancel</button>
            <button type="button" className={styles.primaryBtn} onClick={handleComplete} disabled={completeBusy}>
              {completeBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {completeBusy ? 'Completing…' : 'Complete batch'}
            </button>
          </>
        }
      >
        <div className={styles.formGrid}>
          <FormField id="qty-produced" label="Quantity produced" required error={completeErrors.qtyProduced}>
            <input
              id="qty-produced"
              type="number"
              step="0.001"
              className={`${styles.input} tabular-nums ${completeErrors.qtyProduced ? styles.inputError : ''}`}
              aria-invalid={!!completeErrors.qtyProduced}
              value={completeForm.qtyProduced}
              onChange={(e) => { setCompleteForm((f) => ({ ...f, qtyProduced: e.target.value })); setCompleteErrors((errs) => ({ ...errs, qtyProduced: undefined })); }}
              autoFocus
            />
          </FormField>
          <FormField id="qty-rejected" label="Quantity rejected" hint="Optional — defaults to 0" error={completeErrors.qtyRejected}>
            <input
              id="qty-rejected"
              type="number"
              step="0.001"
              className={`${styles.input} tabular-nums ${completeErrors.qtyRejected ? styles.inputError : ''}`}
              value={completeForm.qtyRejected}
              onChange={(e) => { setCompleteForm((f) => ({ ...f, qtyRejected: e.target.value })); setCompleteErrors((errs) => ({ ...errs, qtyRejected: undefined })); }}
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
