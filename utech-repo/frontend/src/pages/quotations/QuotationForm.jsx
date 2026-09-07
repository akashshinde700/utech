import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BookmarkPlus, FileText, LayoutTemplate, ListPlus, Loader2, Plus, Save, Trash2, Upload, X,
} from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { styles } from '../../lib/formStyles';
import { positiveNumber, required, validateAll } from '../../lib/validation';
import { toLocalInput } from '../../lib/format';
import toast from 'react-hot-toast';

const schema = {
  partyId: (v) => required(v, 'Party'),
  date: (v) => required(v, 'Date'),
};

export default function QuotationForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;
  const [loading, setLoading] = useState(false);
  const [parties, setParties] = useState([]);
  const [lines, setLines] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [errors, setErrors] = useState({});
  const [lineErrors, setLineErrors] = useState([]);
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [formData, setFormData] = useState({
    partyId: '',
    date: toLocalInput(),
    validUntil: toLocalInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    notes: '',
    headerText: '',
    footerText: '',
    headerImageName: '', headerImageStoredName: '',
    footerImageName: '', footerImageStoredName: '',
  });
  const [data, setData] = useState(null);
  const [headerImagePreview, setHeaderImagePreview] = useState('');
  const [footerImagePreview, setFooterImagePreview] = useState('');
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [uploadingFooter, setUploadingFooter] = useState(false);

  async function loadParties() {
    const { data: response } = await api.get('/parties', { params: { pageSize: 1000, type: 'CUSTOMER' } });
    setParties(response.items || []);
  }

  async function loadTemplates() {
    const { data: response } = await api.get('/quotation-templates');
    setTemplates(response || []);
  }

  async function loadQuotation() {
    if (!id) return;
    const { data: response } = await api.get(`/quotations/${id}`);
    setData(response);
    setFormData({
      partyId: response.partyId,
      date: response.date.split('T')[0],
      validUntil: response.validTill?.split('T')[0] || '',
      notes: response.notes || '',
      headerText: response.headerText || '',
      footerText: response.footerText || '',
      headerImageName: response.headerImageName || '', headerImageStoredName: response.headerImageStoredName || '',
      footerImageName: response.footerImageName || '', footerImageStoredName: response.footerImageStoredName || '',
    });
    setLines(response.lines || []);
  }

  useEffect(() => { loadParties(); loadTemplates(); if (id) loadQuotation(); }, [id]);

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  useEffect(() => {
    if (!formData.headerImageStoredName) { setHeaderImagePreview(''); return; }
    let cancelled = false;
    api.get(`/quotation-templates/image/${formData.headerImageStoredName}`, { responseType: 'blob' })
      .then((r) => blobToDataUrl(r.data))
      .then((dataUrl) => { if (!cancelled) setHeaderImagePreview(dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [formData.headerImageStoredName]);

  useEffect(() => {
    if (!formData.footerImageStoredName) { setFooterImagePreview(''); return; }
    let cancelled = false;
    api.get(`/quotation-templates/image/${formData.footerImageStoredName}`, { responseType: 'blob' })
      .then((r) => blobToDataUrl(r.data))
      .then((dataUrl) => { if (!cancelled) setFooterImagePreview(dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [formData.footerImageStoredName]);

  function setField(k, v) {
    setFormData((f) => ({ ...f, [k]: v }));
    // clear the field's error as soon as its value changes
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  const partyOptions = parties.map((p) => ({
    value: p.id,
    label: p.name,
    subtitle: [p.code, p.phone].filter(Boolean).join(' · '),
  }));
  const templateOptions = templates.map((t) => ({ value: t.id, label: t.name }));

  function applyTemplate(templateId) {
    setSelectedTemplateId(templateId);
    const t = templates.find((x) => x.id === Number(templateId));
    if (t) setFormData((f) => ({
      ...f,
      headerText: t.headerText || '', footerText: t.footerText || '',
      headerImageName: t.headerImageName || '', headerImageStoredName: t.headerImageStoredName || '',
      footerImageName: t.footerImageName || '', footerImageStoredName: t.footerImageStoredName || '',
    }));
  }

  async function uploadHeaderFooterImage(e, slot) {
    const file = e.target.files?.[0];
    if (!file) return;
    const setUploading = slot === 'header' ? setUploadingHeader : setUploadingFooter;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data: uploaded } = await api.post('/quotation-templates/upload-image', fd);
      setFormData((f) => ({
        ...f,
        [`${slot}ImageName`]: uploaded.filename,
        [`${slot}ImageStoredName`]: uploaded.storedName,
      }));
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to upload image');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function removeHeaderFooterImage(slot) {
    setFormData((f) => ({ ...f, [`${slot}ImageName`]: '', [`${slot}ImageStoredName`]: '' }));
  }

  async function saveAsTemplate() {
    const name = newTemplateName.trim();
    if (!name) return;
    setSavingTemplate(true);
    try {
      const { data: t } = await api.post('/quotation-templates', {
        name, headerText: formData.headerText, footerText: formData.footerText,
        headerImageName: formData.headerImageName, headerImageStoredName: formData.headerImageStoredName,
        footerImageName: formData.footerImageName, footerImageStoredName: formData.footerImageStoredName,
      });
      setTemplates((prev) => [...prev, t].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTemplateId(String(t.id));
      setNewTemplateName('');
      toast.success(`Template "${t.name}" saved`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function deleteTemplate() {
    if (!templateToDelete) return;
    setDeletingTemplate(true);
    try {
      await api.delete(`/quotation-templates/${templateToDelete}`);
      setTemplates((prev) => prev.filter((x) => x.id !== Number(templateToDelete)));
      setSelectedTemplateId('');
      setTemplateToDelete(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete template');
    } finally {
      setDeletingTemplate(false);
    }
  }

  function addLine() {
    setLines([...lines, { description: '', drgNo: '', qty: 1, rate: 0, amount: 0 }]);
  }

  function updateLine(index, field, value) {
    const updated = [...lines];
    updated[index][field] = value;
    if (field === 'qty' || field === 'rate') {
      updated[index].amount = updated[index].qty * updated[index].rate;
    }
    setLines(updated);
    // clear the line's error as soon as the offending value is fixed
    setLineErrors((prev) => {
      if (!prev[index]?.[field]) return prev;
      const next = [...prev];
      next[index] = { ...next[index], [field]: undefined };
      return next;
    });
  }

  function removeLine(index) {
    setLines(lines.filter((_, i) => i !== index));
    setLineErrors((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const { errors: errs, ok } = validateAll(formData, schema);
    const lErrs = lines.map((l) => ({
      description: required(l.description, 'Part name'),
      qty: positiveNumber(l.qty, 'Qty'),
      rate: positiveNumber(l.rate, 'Rate'),
    }));
    if (!ok || lErrs.some((le) => le.description || le.qty || le.rate)) {
      setErrors(errs);
      setLineErrors(lErrs);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...formData,
        partyId: parseInt(formData.partyId),
        headerText: formData.headerText || null,
        footerText: formData.footerText || null,
        lines: lines.map(l => ({
          description: l.description,
          drgNo: l.drgNo || null,
          qty: parseFloat(l.qty),
          rate: parseFloat(l.rate),
          amount: parseFloat(l.amount),
        })),
      };
      if (isEdit) {
        await api.put(`/quotations/${id}`, payload);
      } else {
        await api.post('/quotations', payload);
      }
      navigate('/quotations');
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Error saving quotation');
    } finally {
      setLoading(false);
    }
  }

  const templateBeingDeleted = templates.find((x) => x.id === Number(templateToDelete));

  return (
    <div>
      <PageHeader
        title={isEdit ? `Quotation ${data?.number}` : 'New Quotation'}
        action={
          <button onClick={() => navigate('/quotations')} className="btn-secondary">
            <X className="w-4 h-4" /> Cancel
          </button>
        }
      />
      <form onSubmit={handleSubmit} noValidate className="max-w-5xl space-y-5">
        <FormSection icon={FileText} title="Quotation Details" description="Customer, validity and notes for this quotation">
          <div className={styles.formGrid}>
            <FormField id="quotation-party" label="Party" required error={errors.partyId} className="sm:col-span-2" hint="Only customers are listed">
              <SearchableSelect
                id="quotation-party"
                value={formData.partyId}
                onChange={(v) => setField('partyId', v)}
                options={partyOptions}
                placeholder="Select customer…"
                emptyText="No matching customers"
                disabled={isEdit}
              />
            </FormField>
            <FormField id="quotation-date" label="Date" required error={errors.date}>
              <input
                id="quotation-date"
                type="date"
                className={`${styles.input} ${errors.date ? styles.inputError : ''}`}
                value={formData.date}
                onChange={(e) => setField('date', e.target.value)}
                aria-invalid={!!errors.date}
              />
            </FormField>
            <FormField id="quotation-valid-until" label="Valid Until" hint="Defaults to 30 days from today">
              <input
                id="quotation-valid-until"
                type="date"
                className={styles.input}
                value={formData.validUntil}
                onChange={(e) => setField('validUntil', e.target.value)}
              />
            </FormField>
            <FormField id="quotation-notes" label="Notes" className="sm:col-span-2">
              <textarea
                id="quotation-notes"
                rows={2}
                className={styles.textarea}
                value={formData.notes}
                onChange={(e) => setField('notes', e.target.value)}
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={LayoutTemplate}
          title="Header & Footer"
          description="Letterhead text and images applied to the printed quotation"
          actions={
            <div className="flex items-center gap-2">
              <SearchableSelect
                className="w-44 sm:w-56"
                value={selectedTemplateId}
                onChange={applyTemplate}
                options={templateOptions}
                placeholder="Load saved template…"
                emptyText="No templates saved"
              />
              {selectedTemplateId && (
                <button
                  type="button"
                  className="btn-icon text-danger-600 hover:bg-danger-50"
                  onClick={() => setTemplateToDelete(selectedTemplateId)}
                  title="Delete this template"
                  aria-label="Delete this template"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          }
        >
          <div className={styles.formGrid}>
            <FormField id="quotation-header-text" label="Header text">
              <div className="space-y-2">
                <textarea
                  id="quotation-header-text"
                  rows={3}
                  className={styles.textarea}
                  placeholder="e.g. company letterhead, address"
                  value={formData.headerText}
                  onChange={(e) => setField('headerText', e.target.value)}
                />
                {headerImagePreview ? (
                  <div className="flex items-center gap-3">
                    <img src={headerImagePreview} alt="Header" className="h-14 border border-slate-200 rounded-lg object-contain bg-white" />
                    <span className="text-xs text-slate-500 truncate max-w-[140px]">{formData.headerImageName}</span>
                    <button type="button" className="btn-icon text-danger-600 hover:bg-danger-50" onClick={() => removeHeaderFooterImage('header')} aria-label="Remove header image">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="btn-secondary text-sm cursor-pointer w-fit">
                    <Upload className="w-4 h-4" /> {uploadingHeader ? 'Uploading…' : 'Upload header image'}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={uploadingHeader} onChange={e => uploadHeaderFooterImage(e, 'header')} />
                  </label>
                )}
              </div>
            </FormField>
            <FormField id="quotation-footer-text" label="Footer text">
              <div className="space-y-2">
                <textarea
                  id="quotation-footer-text"
                  rows={3}
                  className={styles.textarea}
                  placeholder="e.g. terms & conditions, bank details"
                  value={formData.footerText}
                  onChange={(e) => setField('footerText', e.target.value)}
                />
                {footerImagePreview ? (
                  <div className="flex items-center gap-3">
                    <img src={footerImagePreview} alt="Footer" className="h-14 border border-slate-200 rounded-lg object-contain bg-white" />
                    <span className="text-xs text-slate-500 truncate max-w-[140px]">{formData.footerImageName}</span>
                    <button type="button" className="btn-icon text-danger-600 hover:bg-danger-50" onClick={() => removeHeaderFooterImage('footer')} aria-label="Remove footer image">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="btn-secondary text-sm cursor-pointer w-fit">
                    <Upload className="w-4 h-4" /> {uploadingFooter ? 'Uploading…' : 'Upload footer image'}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={uploadingFooter} onChange={e => uploadHeaderFooterImage(e, 'footer')} />
                  </label>
                )}
              </div>
            </FormField>
            <div className="sm:col-span-2">
              <label htmlFor="quotation-template-name" className={styles.label}>Save current header/footer as template</label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  id="quotation-template-name"
                  className={`${styles.input} max-w-xs`}
                  placeholder="Template name…"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                />
                <button type="button" disabled={savingTemplate || !newTemplateName.trim()} className="btn-secondary text-sm" onClick={saveAsTemplate}>
                  {savingTemplate
                    ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    : <BookmarkPlus className="w-4 h-4" />} Save as template
                </button>
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection
          icon={ListPlus}
          title="Line Items"
          description="Parts quoted to the customer"
          actions={
            <button type="button" onClick={addLine} className="btn-secondary text-sm">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          }
        >
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">No items yet — click “Add Item” to start.</p>
          ) : (
            <>
              {/* desktop: 12-col grid */}
              <div className="hidden lg:block">
                <div className="grid grid-cols-12 gap-2 mb-1 px-0.5">
                  <div className="col-span-1 text-xs font-medium text-slate-500">Sr No</div>
                  <div className="col-span-3 text-xs font-medium text-slate-500">Part Name</div>
                  <div className="col-span-2 text-xs font-medium text-slate-500">Drg No</div>
                  <div className="col-span-2 text-xs font-medium text-slate-500">Reqrd. Qty</div>
                  <div className="col-span-2 text-xs font-medium text-slate-500">Rate/each</div>
                  <div className="col-span-1 text-xs font-medium text-slate-500">Total Amount</div>
                  <div className="col-span-1"></div>
                </div>
                {lines.map((line, idx) => (
                  <div key={idx} className="mb-2 grid grid-cols-12 items-start gap-2">
                    <div className="col-span-1 pt-2.5 text-sm text-slate-500">{idx + 1}</div>
                    <div className="col-span-3">
                      <FormField error={lineErrors[idx]?.description}>
                        <input
                          className={`${styles.input} text-sm ${lineErrors[idx]?.description ? styles.inputError : ''}`}
                          placeholder="Part name"
                          value={line.description || ''}
                          onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          aria-invalid={!!lineErrors[idx]?.description}
                        />
                      </FormField>
                    </div>
                    <div className="col-span-2">
                      <input className={`${styles.input} text-sm`} placeholder="Drg no" value={line.drgNo || ''} onChange={(e) => updateLine(idx, 'drgNo', e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <FormField error={lineErrors[idx]?.qty}>
                        <input
                          className={`${styles.input} text-sm ${lineErrors[idx]?.qty ? styles.inputError : ''}`}
                          type="number" step="0.001" min="0" placeholder="Qty"
                          value={line.qty}
                          onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                          aria-invalid={!!lineErrors[idx]?.qty}
                        />
                      </FormField>
                    </div>
                    <div className="col-span-2">
                      <FormField error={lineErrors[idx]?.rate}>
                        <input
                          className={`${styles.input} text-sm ${lineErrors[idx]?.rate ? styles.inputError : ''}`}
                          type="number" step="0.01" min="0" placeholder="Rate"
                          value={line.rate}
                          onChange={(e) => updateLine(idx, 'rate', e.target.value)}
                          aria-invalid={!!lineErrors[idx]?.rate}
                        />
                      </FormField>
                    </div>
                    <div className="col-span-1">
                      <input className={`${styles.input} text-sm bg-slate-50`} placeholder="Amount" value={line.amount} readOnly tabIndex={-1} />
                    </div>
                    <div className="col-span-1 pt-1.5">
                      <button type="button" onClick={() => removeLine(idx)} className="btn-icon text-danger-600 hover:bg-danger-50" aria-label={`Remove line ${idx + 1}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* tablet / phone: one card per line */}
              <div className="space-y-3 lg:hidden">
                {lines.map((line, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">Item {idx + 1}</span>
                      <button type="button" onClick={() => removeLine(idx)} className="btn-icon text-danger-600 hover:bg-danger-50" aria-label={`Remove line ${idx + 1}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <FormField label="Part Name" error={lineErrors[idx]?.description}>
                      <input
                        className={`${styles.input} ${lineErrors[idx]?.description ? styles.inputError : ''}`}
                        placeholder="Part name"
                        value={line.description || ''}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        aria-invalid={!!lineErrors[idx]?.description}
                      />
                    </FormField>
                    <FormField label="Drawing No">
                      <input className={styles.input} placeholder="Drg no" value={line.drgNo || ''} onChange={(e) => updateLine(idx, 'drgNo', e.target.value)} />
                    </FormField>
                    <div className="grid grid-cols-3 gap-3">
                      <FormField label="Qty" error={lineErrors[idx]?.qty}>
                        <input
                          className={`${styles.input} ${lineErrors[idx]?.qty ? styles.inputError : ''}`}
                          type="number" step="0.001" min="0" inputMode="decimal"
                          value={line.qty}
                          onChange={(e) => updateLine(idx, 'qty', e.target.value)}
                          aria-invalid={!!lineErrors[idx]?.qty}
                        />
                      </FormField>
                      <FormField label="Rate" error={lineErrors[idx]?.rate}>
                        <input
                          className={`${styles.input} ${lineErrors[idx]?.rate ? styles.inputError : ''}`}
                          type="number" step="0.01" min="0" inputMode="decimal"
                          value={line.rate}
                          onChange={(e) => updateLine(idx, 'rate', e.target.value)}
                          aria-invalid={!!lineErrors[idx]?.rate}
                        />
                      </FormField>
                      <FormField label="Amount">
                        <input className={`${styles.input} bg-slate-100`} value={line.amount} readOnly tabIndex={-1} />
                      </FormField>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className={styles.actionsBar}>
            <button type="button" onClick={() => navigate('/quotations')} className={styles.secondaryBtn}>Cancel</button>
            <button type="submit" disabled={loading} className={styles.primaryBtn}>
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Save className="h-4 w-4" />} {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </FormSection>
      </form>

      <ConfirmDialog
        open={!!templateToDelete}
        onClose={() => setTemplateToDelete(null)}
        onConfirm={deleteTemplate}
        title={templateBeingDeleted ? `Delete template "${templateBeingDeleted.name}"?` : 'Delete template?'}
        message="The saved header/footer content will be removed. Quotations already created are not affected."
        confirmLabel="Delete"
        variant="destructive"
        loading={deletingTemplate}
      />
    </div>
  );
}
