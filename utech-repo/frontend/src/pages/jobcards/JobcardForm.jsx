import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, ArrowLeft, Save, Loader2, ClipboardList, Package, Upload, FileText, Check, X } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import PdfViewerModal from '../../components/pdf/PdfViewerModal';
import FormField from '../../components/ui/FormField';
import FormSection from '../../components/ui/FormSection';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { styles } from '../../lib/formStyles';
import { positiveNumber, required } from '../../lib/validation';
import { todayLocal } from '../../lib/format';
import toast from 'react-hot-toast';

const newLine = () => ({ itemId: '', itemName: '', qty: 1, uomCode: '', notes: '' });

const DOC_CATEGORIES = [
  { key: 'ASSEMBLY', label: 'Assembly' },
  { key: 'SUBASSEMBLY', label: 'Subassembly' },
  { key: 'SUBPART', label: 'Subparts' },
];

// a line the user actually started filling — untouched rows are ignored by
// validation (they still go out in the payload exactly as before)
const lineInPlay = (l) =>
  !!(l.itemId || (l.itemName || '').trim() || String(l.qty ?? '').trim() === '' ||
    (l.uomCode || '').trim() || (l.notes || '').trim());

export default function JobcardForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [newItemRow, setNewItemRow] = useState(null);
  const [newItemDraft, setNewItemDraft] = useState({ name: '', uomId: '' });
  const [pendingDocs, setPendingDocs] = useState({ ASSEMBLY: [], SUBASSEMBLY: [], SUBPART: [] });
  const [pdfViewer, setPdfViewer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [confirmDeleteFile, setConfirmDeleteFile] = useState(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [form, setForm] = useState({
    date: todayLocal(),
    partyId: '', itemId: '', itemDescription: '', qtyOrdered: 0,
    assignedOperatorId: '', projectEngineerId: '',
    projectNumber: '', assemblyNumber: '', drawingNumber: '',
    startDate: '', endDate: '', remarks: '',
    lines: [], operations: [],
  });

  useEffect(() => {
    api.get('/parties', { params: { pageSize: 100 } }).then((r) => setParties(r.data.items));
    api.get('/items', { params: { pageSize: 200 } }).then((r) => setItems(r.data.items));
    api.get('/users', { params: { pageSize: 200 } }).then((r) => setUsers(r.data.items)).catch(() => {});
    api.get('/items/lookups').then((r) => setUoms(r.data.uoms)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    api.get(`/jobcards/${id}`).then((r) => {
      const jc = r.data;
      setForm({
        date: jc.date.slice(0, 10),
        partyId: jc.partyId || '',
        itemId: jc.itemId || '',
        itemDescription: jc.itemDescription || '',
        assignedOperatorId: jc.assignedOperatorId || '',
        projectEngineerId: jc.projectEngineerId || '',
        projectNumber: jc.projectNumber || '',
        assemblyNumber: jc.assemblyNumber || '',
        drawingNumber: jc.drawingNumber || '',
        qtyOrdered: Number(jc.qtyOrdered),
        startDate: jc.startDate ? jc.startDate.slice(0, 10) : '',
        endDate: jc.endDate ? jc.endDate.slice(0, 10) : '',
        remarks: jc.remarks || '',
        lines: jc.lines.map((l) => ({ id: l.id, itemId: l.itemId, itemName: l.itemName || l.item?.name || '', qty: Number(l.qty), uomCode: l.uomCode || '', notes: l.notes || '' })),
        operations: [],
      });
    });
    loadAttachments();
  }, [id]);

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
    [parties]
  );
  const engineerOptions = useMemo(
    () => users.filter((u) => u.role?.name === 'Project Engineer').map((u) => ({ value: u.id, label: u.name, subtitle: u.role?.name })),
    [users]
  );
  const itemOptions = useMemo(
    () => items.map((it) => ({ value: it.id, label: `${it.code} — ${it.name}` })),
    [items]
  );
  const uomOptions = useMemo(() => uoms.map((u) => ({ value: u.id, label: u.code })), [uoms]);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function setLine(i, key, value) {
    setForm((f) => {
      const lines = [...f.lines];
      lines[i] = { ...lines[i], [key]: value };
      return { ...f, lines };
    });
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

  function loadAttachments() {
    if (!id) return;
    api.get(`/attachments/JOBCARD/${id}`).then((r) => setAttachments(r.data));
  }

  async function uploadFilesTo(jobcardId, lineId, files, category) {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    if (lineId) fd.append('lineId', lineId);
    if (category) fd.append('category', category);
    await api.post(`/attachments/JOBCARD/${jobcardId}`, fd);
  }

  async function uploadCategoryPdfs(e, category) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      if (id) {
        await uploadFilesTo(id, null, files, category);
        toast.success('Uploaded');
        loadAttachments();
      } else {
        setPendingDocs((pd) => ({ ...pd, [category]: [...pd[category], ...files] }));
      }
    } finally {
      e.target.value = '';
    }
  }

  function removePendingDoc(category, fi) {
    setPendingDocs((pd) => {
      const arr = [...pd[category]];
      arr.splice(fi, 1);
      return { ...pd, [category]: arr };
    });
  }

  async function uploadLinePdfs(e, lineId) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      await uploadFilesTo(id, lineId, files);
      toast.success('Uploaded');
      loadAttachments();
    } finally {
      e.target.value = '';
    }
  }

  function stageLineFiles(e, i) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const ls = [...form.lines];
    ls[i] = { ...ls[i], _pendingFiles: [...(ls[i]._pendingFiles || []), ...files] };
    setForm({ ...form, lines: ls });
    e.target.value = '';
  }

  function startNewItem(i) {
    setNewItemRow(i);
    setNewItemDraft({ name: '', uomId: '' });
  }

  function cancelNewItem() {
    setNewItemRow(null);
    setNewItemDraft({ name: '', uomId: '' });
  }

  async function createItemForLine(i) {
    const name = newItemDraft.name.trim();
    if (!name) return;
    try {
      const r = await api.post('/items', {
        name,
        type: 'RAW_MATERIAL',
        uomId: newItemDraft.uomId ? Number(newItemDraft.uomId) : null,
        projectNumber: form.projectNumber || null,
      });
      const created = r.data;
      setItems((prev) => [...prev, created]);
      const ls = [...form.lines];
      ls[i] = { ...ls[i], itemId: created.id, itemName: created.name };
      setForm({ ...form, lines: ls });
      cancelNewItem();
      toast.success('Item created');
    } catch {}
  }

  function removeStagedLineFile(i, fi) {
    const ls = [...form.lines];
    const pf = [...(ls[i]._pendingFiles || [])];
    pf.splice(fi, 1);
    ls[i] = { ...ls[i], _pendingFiles: pf };
    setForm({ ...form, lines: ls });
  }

  function viewLocalFile(file) {
    window.open(URL.createObjectURL(file), '_blank');
  }

  async function downloadPdf(a) {
    const r = await api.get(`/attachments/file/${a.id}`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([r.data], { type: a.mimeType }));
    const link = document.createElement('a');
    link.href = url; link.download = a.filename;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  }

  async function doDeleteFile() {
    const a = confirmDeleteFile;
    if (!a) return;
    setDeletingFile(true);
    try {
      await api.delete(`/attachments/file/${a.id}`);
      setConfirmDeleteFile(null);
      loadAttachments();
    } catch {
      toast.error('Failed to delete file');
    } finally {
      setDeletingFile(false);
    }
  }

  function focusFirstError(errs) {
    const firstKey = Object.keys(errs)[0];
    if (!firstKey) return;
    if (firstKey === 'lines') {
      const li = Object.keys(errs.lines)[0];
      document.getElementById(`jc-line-${li}-qty`)?.focus();
      return;
    }
    document.getElementById(`jc-${firstKey}`)?.focus();
  }

  async function save(e) {
    e.preventDefault();
    const nextErrors = {};
    const dateErr = required(form.date, 'Date');
    if (dateErr) nextErrors.date = dateErr;
    const qtyErr = positiveNumber(form.qtyOrdered, 'Qty ordered');
    if (qtyErr) nextErrors.qtyOrdered = qtyErr;
    const lineErrs = {};
    form.lines.forEach((l, i) => {
      if (!lineInPlay(l)) return;
      const lq = positiveNumber(l.qty, 'Line qty');
      if (lq) lineErrs[i] = { qty: lq };
    });
    if (Object.keys(lineErrs).length) nextErrors.lines = lineErrs;

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      focusFirstError(nextErrors);
      return;
    }
    setErrors({});

    setSaving(true);
    try {
      const payload = {
        ...form,
        partyId: form.partyId ? Number(form.partyId) : null,
        itemId: form.itemId ? Number(form.itemId) : null,
        assignedOperatorId: form.assignedOperatorId ? Number(form.assignedOperatorId) : null,
        projectEngineerId: form.projectEngineerId ? Number(form.projectEngineerId) : null,
        qtyOrdered: Number(form.qtyOrdered),
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        lines: form.lines.map((l) => {
          const { _pendingFiles, ...rest } = l;
          return { ...rest, itemId: l.itemId ? Number(l.itemId) : null, qty: Number(l.qty) };
        }),
        operations: [],
      };
      let jobcardId = id;
      let respLines;
      if (id) {
        const r = await api.put(`/jobcards/${id}`, payload);
        respLines = r.data.lines;
      } else {
        const r = await api.post('/jobcards', payload);
        jobcardId = r.data.id;
        respLines = r.data.lines;
      }

      // upload any locally staged PDFs now that lines have real ids
      const knownIds = new Set(form.lines.filter((l) => l.id).map((l) => l.id));
      const newOriginal = form.lines.filter((l) => !l.id);
      const newResp = (respLines || []).filter((rl) => !knownIds.has(rl.id));
      for (let i = 0; i < newOriginal.length; i++) {
        const orig = newOriginal[i];
        const resp = newResp[i];
        if (orig._pendingFiles?.length && resp) {
          await uploadFilesTo(jobcardId, resp.id, orig._pendingFiles);
        }
      }

      // upload any locally staged assembly/subassembly/subpart docs
      for (const cat of Object.keys(pendingDocs)) {
        if (pendingDocs[cat].length) {
          await uploadFilesTo(jobcardId, null, pendingDocs[cat], cat);
        }
      }
      setPendingDocs({ ASSEMBLY: [], SUBASSEMBLY: [], SUBPART: [] });

      toast.success('Saved');
      navigate(`/jobcards/${jobcardId}`);
    } catch {} finally {
      setSaving(false);
    }
  }

  const lineError = (i, key) => errors.lines?.[i]?.[key] || null;
  const inputCls = (key) => `${styles.input} ${errors[key] ? styles.inputError : ''}`;

  return (
    <div>
      <PageHeader
        title={id ? 'Edit Project' : 'New Project'}
        subtitle={id ? 'Update the jobcard details, materials and drawings' : 'Raise a production jobcard with materials and drawing documents'}
      />
      {pdfViewer && (
        <PdfViewerModal
          attachmentId={pdfViewer.id}
          filename={pdfViewer.filename}
          onClose={() => setPdfViewer(null)}
          onDownload={() => downloadPdf(pdfViewer)}
        />
      )}
      <ConfirmDialog
        open={!!confirmDeleteFile}
        onClose={() => setConfirmDeleteFile(null)}
        onConfirm={doDeleteFile}
        title="Delete file?"
        message={confirmDeleteFile ? `"${confirmDeleteFile.filename}" will be permanently removed from this jobcard.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        loading={deletingFile}
      />
      <form onSubmit={save} noValidate className="max-w-6xl space-y-5">
        <FormSection icon={ClipboardList} title="Basic Details" description="Project reference, party and schedule">
          <div className={styles.formGrid3}>
            <FormField id="jc-date" label="Date" required error={errors.date}>
              <input
                id="jc-date"
                type="date"
                className={inputCls('date')}
                aria-invalid={!!errors.date}
                aria-describedby={errors.date ? 'jc-date-error' : undefined}
                value={form.date}
                onChange={(e) => setField('date', e.target.value)}
              />
            </FormField>
            <FormField id="jc-party" label="Party" className="sm:col-span-2" hint="Customer this project is for.">
              <SearchableSelect
                id="jc-party"
                value={form.partyId}
                onChange={(v) => setField('partyId', v)}
                options={partyOptions}
                placeholder="Select party…"
                allowClear
              />
            </FormField>
            <FormField id="jc-engineer" label="Assigned Engineer" className="sm:col-span-2" hint="Users with the Project Engineer role.">
              <SearchableSelect
                id="jc-engineer"
                value={form.assignedOperatorId}
                onChange={(v) => setField('assignedOperatorId', v)}
                options={engineerOptions}
                placeholder="Select engineer…"
                allowClear
              />
            </FormField>
            <FormField id="jc-qtyOrdered" label="Qty Ordered" required error={errors.qtyOrdered}>
              <input
                id="jc-qtyOrdered"
                type="number"
                step="0.001"
                min="0"
                className={inputCls('qtyOrdered')}
                aria-invalid={!!errors.qtyOrdered}
                aria-describedby={errors.qtyOrdered ? 'jc-qtyOrdered-error' : undefined}
                value={form.qtyOrdered}
                onChange={(e) => setField('qtyOrdered', e.target.value)}
              />
            </FormField>
            <FormField id="jc-projectNumber" label="Project Number">
              <input id="jc-projectNumber" className={styles.input} value={form.projectNumber} onChange={(e) => setField('projectNumber', e.target.value)} />
            </FormField>
            <FormField id="jc-assemblyNumber" label="Assembly Number">
              <input id="jc-assemblyNumber" className={styles.input} value={form.assemblyNumber} onChange={(e) => setField('assemblyNumber', e.target.value)} />
            </FormField>
            <FormField id="jc-drawingNumber" label="Drawing Number">
              <input id="jc-drawingNumber" className={styles.input} value={form.drawingNumber} onChange={(e) => setField('drawingNumber', e.target.value)} />
            </FormField>
            <FormField id="jc-startDate" label="Start">
              <input id="jc-startDate" type="date" className={styles.input} value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
            </FormField>
            <FormField id="jc-endDate" label="End">
              <input id="jc-endDate" type="date" className={styles.input} value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />
            </FormField>
            <FormField id="jc-remarks" label="Remarks" className="sm:col-span-2 lg:col-span-3">
              <textarea id="jc-remarks" rows={2} className={styles.textarea} value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} />
            </FormField>
          </div>
        </FormSection>

        <FormSection
          icon={Package}
          title="Materials (BOM)"
          description="Raw materials drawn for this jobcard — attach line drawings as PDFs"
          actions={
            <button type="button" className={styles.secondaryBtn} onClick={() => setForm({ ...form, lines: [...form.lines, newLine()] })}>
              <Plus className="w-4 h-4" /> Add material
            </button>
          }
        >
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead><tr>
                <th className="table-th min-w-[13rem]">Item</th><th className="table-th w-28">Project No</th><th className="table-th min-w-[6rem]">Qty</th><th className="table-th min-w-[5rem]">UoM</th><th className="table-th min-w-[8rem]">Notes</th><th className="table-th min-w-[9rem]">Drawing</th><th className="table-th w-10"></th>
              </tr></thead>
              <tbody>
                {form.lines.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No materials yet — click “Add material”.</td></tr>
                )}
                {form.lines.map((l, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                    <td className="table-td">
                      {newItemRow === i ? (
                        <div className="flex flex-col gap-1 min-w-[220px]">
                          <input
                            className={`${styles.input} !h-9 !text-xs`}
                            placeholder="New item name"
                            autoFocus
                            value={newItemDraft.name}
                            onChange={(e) => setNewItemDraft((d) => ({ ...d, name: e.target.value }))}
                          />
                          <div className="flex gap-1">
                            <SearchableSelect
                              className="min-w-0 flex-1"
                              value={newItemDraft.uomId}
                              onChange={(v) => setNewItemDraft((d) => ({ ...d, uomId: v }))}
                              options={uomOptions}
                              placeholder="UoM…"
                              allowClear
                            />
                            <button type="button" className="btn-primary !px-2" aria-label="Create item" onClick={() => createItemForLine(i)}><Check className="w-3.5 h-3.5" /></button>
                            <button type="button" className="btn-secondary !px-2" aria-label="Cancel new item" onClick={cancelNewItem}><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <SearchableSelect
                            className="min-w-[11rem] flex-1"
                            value={l.itemId || ''}
                            onChange={(v) => {
                              const it = items.find((x) => String(x.id) === String(v));
                              setLine(i, 'itemId', v);
                              setLine(i, 'itemName', it?.name || '');
                            }}
                            options={itemOptions}
                            placeholder="— select item —"
                            allowClear
                          />
                          <button
                            type="button"
                            title="Add new item"
                            className="btn-secondary !px-2 shrink-0"
                            onClick={() => startNewItem(i)}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="table-td text-slate-500">{form.projectNumber || '—'}</td>
                    <td className="table-td">
                      <input
                        id={`jc-line-${i}-qty`}
                        aria-label={`Line ${i + 1} quantity`}
                        type="number"
                        step="0.001"
                        min="0"
                        className={`${styles.input} !h-9 !text-xs tabular-nums ${lineError(i, 'qty') ? styles.inputError : ''}`}
                        aria-invalid={!!lineError(i, 'qty')}
                        aria-describedby={lineError(i, 'qty') ? `jc-line-${i}-qty-error` : undefined}
                        value={l.qty}
                        onChange={(e) => setLine(i, 'qty', e.target.value)}
                      />
                      {lineError(i, 'qty') && (
                        <p id={`jc-line-${i}-qty-error`} role="alert" className={styles.errorText}>{lineError(i, 'qty')}</p>
                      )}
                    </td>
                    <td className="table-td"><input aria-label={`Line ${i + 1} UoM`} className={`${styles.input} !h-9 !text-xs w-20`} value={l.uomCode || ''} onChange={(e) => setLine(i, 'uomCode', e.target.value)} /></td>
                    <td className="table-td"><input aria-label={`Line ${i + 1} notes`} className={`${styles.input} !h-9 !text-xs min-w-[8rem]`} value={l.notes || ''} onChange={(e) => setLine(i, 'notes', e.target.value)} /></td>
                    <td className="table-td">
                      <div className="flex flex-col gap-1">
                        <label className="btn-secondary !px-2 !py-0.5 cursor-pointer w-fit">
                          <Upload className="w-3 h-3" /> PDF
                          <input type="file" accept="application/pdf" multiple hidden onChange={(e) => (l.id ? uploadLinePdfs(e, l.id) : stageLineFiles(e, i))} />
                        </label>
                        {l.id && attachments.filter((a) => a.lineId === l.id).map((a) => (
                          <div key={a.id} className="flex items-center gap-1 text-xs">
                            <button type="button" className="text-brand-600 underline truncate max-w-[90px]" title={a.filename} onClick={() => setPdfViewer(a)}>{a.filename}</button>
                            <button type="button" aria-label={`Delete ${a.filename}`} onClick={() => setConfirmDeleteFile(a)}><Trash2 className="w-3 h-3 text-danger-500" /></button>
                          </div>
                        ))}
                        {(l._pendingFiles || []).map((f, fi) => (
                          <div key={fi} className="flex items-center gap-1 text-xs text-warning-600">
                            <button type="button" className="underline truncate max-w-[70px]" title={f.name} onClick={() => viewLocalFile(f)}>{f.name}</button>
                            <span className="text-[10px]">pending</span>
                            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removeStagedLineFile(i, fi)}><Trash2 className="w-3 h-3 text-danger-500" /></button>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="table-td"><button type="button" className="btn-danger !px-2 !py-0.5" aria-label={`Remove line ${i + 1}`} onClick={() => setForm({ ...form, lines: form.lines.filter((_, ix) => ix !== i) })}><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection icon={FileText} title="Drawing Documents" description="Assembly, subassembly and subpart PDFs for the shop floor">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {DOC_CATEGORIES.map((cat) => (
              <div key={cat.key} className="rounded-xl border border-slate-200 p-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <FileText className="w-4 h-4 text-brand-600" /> {cat.label}
                  </div>
                  <label className="btn-secondary !px-2 !py-0.5 cursor-pointer">
                    <Upload className="w-3 h-3" /> PDF
                    <input type="file" accept="application/pdf" multiple hidden onChange={(e) => uploadCategoryPdfs(e, cat.key)} />
                  </label>
                </div>
                <div className="flex flex-col gap-1.5">
                  {attachments.filter((a) => a.category === cat.key).length === 0 && !pendingDocs[cat.key].length && (
                    <div className="text-xs text-slate-400">No files</div>
                  )}
                  {attachments.filter((a) => a.category === cat.key).map((a) => (
                    <div key={a.id} className="flex items-center gap-1 text-xs">
                      <button type="button" className="text-brand-600 underline truncate max-w-[160px]" title={a.filename} onClick={() => setPdfViewer(a)}>{a.filename}</button>
                      <button type="button" aria-label={`Delete ${a.filename}`} onClick={() => setConfirmDeleteFile(a)}><Trash2 className="w-3 h-3 text-danger-500" /></button>
                    </div>
                  ))}
                  {pendingDocs[cat.key].map((f, fi) => (
                    <div key={fi} className="flex items-center gap-1 text-xs text-warning-600">
                      <button type="button" className="underline truncate max-w-[140px]" title={f.name} onClick={() => viewLocalFile(f)}>{f.name}</button>
                      <span className="text-[10px]">pending</span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removePendingDoc(cat.key, fi)}><Trash2 className="w-3 h-3 text-danger-500" /></button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </FormSection>

        <div className={styles.actionsBar}>
          <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/jobcards')}>
            <ArrowLeft className="w-4 h-4" /> Cancel
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
