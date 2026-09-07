import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Pencil, RotateCcw, Package, ClipboardList, AlertTriangle, User, FileText,
  Eye, Download, Upload, Image as ImageIcon, CheckCircle2, ListChecks,
  MessageSquare, Activity as ActivityIcon, Flag, Trash2, Loader2,
} from 'lucide-react';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import PdfThumbnail from '../../components/pdf/PdfThumbnail';
import PdfViewerModal from '../../components/pdf/PdfViewerModal';
import AssignModal from '../../components/assignments/AssignModal';
import ImageLightbox from '../../components/gallery/ImageLightbox';
import ChecklistWidget from '../../components/jobcards/ChecklistWidget';
import WorkUpdatesPanel from '../../components/jobcards/WorkUpdatesPanel';
import ActivityTimeline from '../../components/jobcards/ActivityTimeline';
import { useAuth } from '../../store/auth';
import { date } from '../../lib/format';
import toast from 'react-hot-toast';

const DOC_CATEGORIES = [
  { key: 'ASSEMBLY', label: 'Assembly' },
  { key: 'SUBASSEMBLY', label: 'Subassembly' },
  { key: 'SUBPART', label: 'Subparts' },
];

const WORK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'TESTING', 'COMPLETED'];

function formatBytes(n) {
  if (!n) return '0 KB';
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export default function JobcardView() {
  const { id } = useParams();
  const user = useAuth((s) => s.user);
  const [jc, setJc] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [revertReason, setRevertReason] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [pdfViewer, setPdfViewer] = useState(null);
  const [pdfViewerAssignIntent, setPdfViewerAssignIntent] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const [assignmentsByAttachment, setAssignmentsByAttachment] = useState({});
  const [numPagesByAttachment, setNumPagesByAttachment] = useState({});
  const [completing, setCompleting] = useState(false);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const isAdmin = ['SUPERADMIN', 'MANAGER'].includes(user?.role);
  const isOwner = jc && jc.assignedOperatorId === user?.id;
  const canEditProgress = isAdmin || isOwner;

  // Anyone viewing a project they don't own and isn't admin only got here via
  // the Assignment chain (Department Head, or an operator who received a
  // specific document/pages) — they only ever see the documents (and, within
  // a document, only the pages) that were actually assigned to them. The
  // project owner / admin still sees everything.
  const scoped = !isAdmin && !isOwner;
  function myPagesForAttachment(attachmentId) {
    const rows = (assignmentsByAttachment[attachmentId] || []).filter((r) => r.assignedTo?.id === user?.id);
    if (!rows.length) return undefined; // not assigned to me at all
    if (rows.some((r) => !r.pageNumbers || !r.pageNumbers.length)) return null; // whole doc
    const set = new Set();
    rows.forEach((r) => (r.pageNumbers || []).forEach((p) => set.add(p)));
    return [...set].sort((a, b) => a - b);
  }

  // total pages (client-detected via pdf.js on thumbnail load) vs. how many
  // are done / actively being worked on / just handed out / still free —
  // this is the "kitna baki, kitna hua" breakdown for PE/Dept Head/Plant
  // Head/Admin oversight, not just a plain assigned-vs-not count.
  function pageCoverage(attachmentId) {
    const total = numPagesByAttachment[attachmentId];
    const rows = assignmentsByAttachment[attachmentId] || [];
    const completedSet = new Set();
    const inProgressSet = new Set();
    const assignedSet = new Set(); // handed out but not started (ASSIGNED/REOPENED)
    for (const r of rows) {
      const pages = r.pageNumbers?.length ? r.pageNumbers : (total ? Array.from({ length: total }, (_, i) => i + 1) : []);
      const bucket = r.status === 'COMPLETED' ? completedSet : r.status === 'IN_PROGRESS' ? inProgressSet : assignedSet;
      pages.forEach((p) => bucket.add(p));
    }
    // a page can appear in more than one bucket if it was re-delegated at
    // different stages — completed wins, then in-progress, then assigned
    for (const p of completedSet) { inProgressSet.delete(p); assignedSet.delete(p); }
    for (const p of inProgressSet) assignedSet.delete(p);
    const takenCount = completedSet.size + inProgressSet.size + assignedSet.size;
    const remaining = total
      ? Array.from({ length: total }, (_, i) => i + 1).filter((p) => !completedSet.has(p) && !inProgressSet.has(p) && !assignedSet.has(p))
      : [];
    return {
      total, remaining,
      completedCount: completedSet.size, inProgressCount: inProgressSet.size, assignedCount: assignedSet.size,
      takenCount,
    };
  }

  // { [pageNumber]: "Department (User)" } for every page already handed out —
  // passed into the PDF viewer's select mode so those pages show locked and
  // can't be assigned a second time by accident.
  function takenPagesFor(attachmentId) {
    const total = numPagesByAttachment[attachmentId];
    const rows = assignmentsByAttachment[attachmentId] || [];
    const map = {};
    for (const r of rows) {
      const label = `${r.department?.name || '—'} (${r.assignedTo?.name || '—'})`;
      if (r.pageNumbers?.length) {
        r.pageNumbers.forEach((p) => { map[p] = label; });
      } else if (total) {
        for (let p = 1; p <= total; p++) map[p] = label;
      }
    }
    return map;
  }

  async function load() {
    try {
      const r = await api.get(`/jobcards/${id}`);
      setJc(r.data);
    } catch (err) {
      setLoadError(err.response?.status === 403 ? 'forbidden' : 'not-found');
    }
  }
  async function loadAttachments() {
    try {
      const r = await api.get(`/attachments/JOBCARD/${id}`);
      setAttachments(r.data);
      loadAssignments(r.data);
    } catch {
      // handled by the load() error state above
    }
  }
  useEffect(() => { load(); loadAttachments(); }, [id]);

  // which pages of each PDF have already been assigned, and to which
  // department/user — shown under each card so the chain stays visible.
  async function loadAssignments(list) {
    const pdfIds = list.filter((a) => DOC_CATEGORIES.some((c) => c.key === a.category)).map((a) => a.id);
    if (!pdfIds.length) return;
    try {
      const results = await Promise.all(
        pdfIds.map((aid) => api.get('/assignments', { params: { attachmentId: aid } }).then((r) => [aid, r.data]))
      );
      setAssignmentsByAttachment(Object.fromEntries(results));
    } catch {
      // non-critical — cards just show without the assignment summary
    }
  }

  async function fetchBlobUrl(a) {
    const r = await api.get(`/attachments/file/${a.id}`, { responseType: 'blob' });
    return URL.createObjectURL(new Blob([r.data], { type: a.mimeType }));
  }

  async function downloadFile(a) {
    const url = await fetchBlobUrl(a);
    const link = document.createElement('a');
    link.href = url; link.download = a.filename;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  }

  async function openImage(a) {
    const url = await fetchBlobUrl(a);
    setLightbox({ url, alt: a.filename });
  }

  async function doDeleteAttachment() {
    const a = confirmDeleteFile;
    if (!a) return;
    setDeletingFile(true);
    try {
      await api.delete(`/attachments/file/${a.id}`);
      toast.success('File deleted');
      setAttachments((prev) => prev.filter((x) => x.id !== a.id));
      setConfirmDeleteFile(null);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete file');
    } finally {
      setDeletingFile(false);
    }
  }

  async function uploadGeneralFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('category', 'GENERAL');
    try {
      await api.post(`/attachments/JOBCARD/${id}`, fd);
      toast.success('Uploaded');
      loadAttachments();
    } finally {
      e.target.value = '';
    }
  }

  async function setWorkStatus(workStatus) {
    try {
      const r = await api.patch(`/jobcards/${id}/progress`, { workStatus });
      setJc(r.data);
    } catch {}
  }

  async function markCompleted() {
    setCompleting(true);
    try {
      const r = await api.post(`/jobcards/${id}/complete`);
      setJc(r.data);
      toast.success('Marked as completed');
      setConfirmComplete(false);
    } catch {} finally {
      setCompleting(false);
    }
  }

  if (loadError) return (
    <div className="card p-10 text-center max-w-md mx-auto mt-10">
      <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
      <div className="font-semibold text-slate-800 mb-1">
        {loadError === 'forbidden' ? 'Not your project' : 'Project not found'}
      </div>
      <div className="text-sm text-slate-500 mb-4">
        {loadError === 'forbidden'
          ? 'This project is not assigned to you.'
          : "This project doesn't exist or was removed."}
      </div>
      <Link to="/" className="btn-secondary">Back to dashboard</Link>
    </div>
  );

  if (!jc) return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-10">
      <Loader2 className="w-4 h-4 animate-spin text-brand-500" aria-hidden="true" />
      Loading…
    </div>
  );

  async function doRevert() {
    if (!revertReason.trim()) return;
    try {
      await api.post(`/jobcards/${id}/revert`, { reason: revertReason });
      toast.success('Reverted'); setRevertReason(''); load();
    } catch {}
  }

  const pdfAttachments = attachments.filter((a) => DOC_CATEGORIES.some((c) => c.key === a.category));
  const imageAttachments = attachments.filter((a) => a.mimeType?.startsWith('image/'));
  const generalAttachments = attachments.filter((a) => a.category === 'GENERAL' && !a.mimeType?.startsWith('image/'));
  const notCompleted = jc.status !== 'COMPLETED' && jc.status !== 'CANCELLED';

  return (
    <div>
      <PageHeader
        title={`Project ${jc.number}`}
        subtitle={`${jc.party?.name || '—'} • ${date(jc.date)}`}
        action={isAdmin ? <Link to={`/jobcards/${id}/edit`} className="btn-secondary"><Pencil className="w-4 h-4" /> Edit</Link> : null}
      />

      {lightbox && <ImageLightbox src={lightbox.url} alt={lightbox.alt} onClose={() => { URL.revokeObjectURL(lightbox.url); setLightbox(null); }} />}
      {pdfViewer && (
        <PdfViewerModal
          attachmentId={pdfViewer.id}
          filename={pdfViewer.filename}
          initialSelectMode={pdfViewerAssignIntent}
          allowedPages={scoped ? myPagesForAttachment(pdfViewer.id) : null}
          takenPages={pdfViewerAssignIntent ? takenPagesFor(pdfViewer.id) : null}
          onClose={() => { setPdfViewer(null); setPdfViewerAssignIntent(false); }}
          onDownload={() => downloadFile(pdfViewer)}
          onAssign={(pageNumbers) => { setAssigning({ attachment: pdfViewer, pageNumbers }); setPdfViewer(null); setPdfViewerAssignIntent(false); }}
        />
      )}
      {assigning && (
        <AssignModal
          attachment={assigning.attachment}
          pageNumbers={assigning.pageNumbers}
          onClose={() => setAssigning(null)}
          onSaved={loadAttachments}
        />
      )}
      <ConfirmDialog
        open={!!confirmDeleteFile}
        onClose={() => setConfirmDeleteFile(null)}
        onConfirm={doDeleteAttachment}
        title="Delete file?"
        message={confirmDeleteFile ? `Permanently delete "${confirmDeleteFile.filename}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        loading={deletingFile}
      />
      <ConfirmDialog
        open={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        onConfirm={markCompleted}
        title="Mark this project as completed?"
        message="The jobcard will be marked COMPLETED and progress controls will be locked."
        confirmLabel="Mark Completed"
        loading={completing}
      />

      <div className="card p-6 max-w-6xl space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ClipboardList className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Project Number</span>
            </div>
            <div className="font-bold text-lg text-slate-900">{jc.projectNumber || '—'}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge status={jc.priority}>{jc.priority}</Badge>
            <Badge status={jc.status}>{jc.status}</Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
            <User className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Engineer</span>
            <span className="font-medium text-slate-900 text-sm">{jc.assignedOperator?.name || '—'}</span>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
            <Flag className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Deadline</span>
            <span className="font-medium text-slate-900 text-sm">{date(jc.endDate)}</span>
          </div>
        </div>

        {jc.remarks && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Description</div>
            <div className="text-sm text-slate-700">{jc.remarks}</div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Ordered', value: Number(jc.qtyOrdered), color: 'text-brand-600' },
            { label: 'Produced', value: Number(jc.qtyProduced), color: 'text-success-600' },
            { label: 'Rejected', value: Number(jc.qtyRejected), color: 'text-danger-600' },
          ].map((s) => (
            <div key={s.label} className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500 font-medium uppercase tracking-wider mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-brand-600" />
            <div className="font-semibold text-sm text-slate-800">Materials</div>
          </div>
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead><tr><th className="table-th rounded-tl-lg">Item</th><th className="table-th">Qty</th><th className="table-th">UoM</th><th className="table-th rounded-tr-lg">Notes</th></tr></thead>
              <tbody>
                {jc.lines?.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-sm text-slate-400 text-center">No materials</td></tr>
                ) : (jc.lines || []).map((l) => (
                  <tr key={l.id}><td className="table-td font-medium">{l.item?.name || l.itemName || '—'}</td><td className="table-td">{Number(l.qty)}</td><td className="table-td">{l.uomCode || '—'}</td><td className="table-td">{l.notes || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* project files — PDF gallery, grouped by category with first-page thumbnails */}
        <div className="space-y-5">
          {DOC_CATEGORIES.map((cat) => {
            const catAttachments = pdfAttachments.filter((a) => a.category === cat.key
              && (!scoped || myPagesForAttachment(a.id) !== undefined));
            return (
              <div key={cat.key}>
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-brand-600" />
                  <div className="font-semibold text-sm text-slate-800">{cat.label}</div>
                  <span className="text-xs text-slate-400">({catAttachments.length})</span>
                </div>
                {catAttachments.length === 0 ? (
                  <div className="text-xs text-slate-400">No files</div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {catAttachments.map((a) => (
                      <div key={a.id} className="border border-slate-200 rounded-xl overflow-hidden">
                        <PdfThumbnail
                          attachmentId={a.id}
                          className="w-full h-32 border-b border-slate-100"
                          onLoaded={(n) => setNumPagesByAttachment((prev) => (prev[a.id] === n ? prev : { ...prev, [a.id]: n }))}
                        />
                        <div className="p-2">
                          <div className="text-xs font-medium text-slate-700 truncate" title={a.filename}>{a.filename}</div>
                          <div className="text-[10px] text-slate-400">{date(a.createdAt)} • {formatBytes(a.size)}</div>
                          <div className="flex gap-1 mt-1.5">
                            <button type="button" className="btn-secondary !px-2 !py-0.5 !text-[11px] flex-1" onClick={() => setPdfViewer(a)}><Eye className="w-3 h-3" /> View</button>
                            <button type="button" className="btn-secondary !px-2 !py-0.5 !text-[11px] flex-1" onClick={() => downloadFile(a)}><Download className="w-3 h-3" /></button>
                            {isAdmin && <button type="button" className="btn-danger !px-2 !py-0.5 !text-[11px]" aria-label={`Delete ${a.filename}`} onClick={() => setConfirmDeleteFile(a)}><Trash2 className="w-3 h-3" /></button>}
                          </div>
                          <button type="button" className="btn-secondary !px-2 !py-0.5 !text-[11px] w-full mt-1" onClick={() => { setPdfViewer(a); setPdfViewerAssignIntent(true); }}>
                            <ListChecks className="w-3 h-3" /> Assign
                          </button>

                          {(() => {
                            const { total, completedCount, inProgressCount, assignedCount, remaining } = pageCoverage(a.id);
                            if (!total) return null;
                            const pct = (n) => `${Math.round((n / total) * 100)}%`;
                            return (
                              <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-[10px] text-slate-500">
                                <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 mb-1">
                                  {!!completedCount && <div className="bg-success-500" style={{ width: pct(completedCount) }} title={`${completedCount} completed`} />}
                                  {!!inProgressCount && <div className="bg-brand-500" style={{ width: pct(inProgressCount) }} title={`${inProgressCount} in progress`} />}
                                  {!!assignedCount && <div className="bg-amber-400" style={{ width: pct(assignedCount) }} title={`${assignedCount} not started`} />}
                                </div>
                                <span className="font-semibold text-slate-700">{total}</span> pages ·{' '}
                                <span className="font-semibold text-success-600">{completedCount}</span> done ·{' '}
                                <span className="font-semibold text-brand-600">{inProgressCount}</span> in progress ·{' '}
                                <span className="font-semibold text-amber-600">{assignedCount}</span> not started ·{' '}
                                <span className={`font-semibold ${remaining.length ? 'text-slate-500' : 'text-slate-400'}`}>{remaining.length}</span> unassigned
                                {!!remaining.length && (
                                  <div className="text-slate-400 truncate" title={`Unassigned: ${remaining.join(', ')}`}>
                                    Unassigned: {remaining.join(', ')}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {!!assignmentsByAttachment[a.id]?.length && (
                            <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1">
                              {assignmentsByAttachment[a.id].map((asg) => (
                                <div key={asg.id} className="text-[10px] text-slate-500 leading-tight">
                                  <span className="font-medium text-slate-700">
                                    {asg.pageNumbers?.length ? `Page ${asg.pageNumbers.join(', ')}` : 'Whole doc'}
                                  </span>
                                  {' → '}{asg.department?.name || '—'} ({asg.assignedTo?.name || '—'})
                                  {' '}<span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{asg.status}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* images / reference files */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="w-4 h-4 text-brand-600" />
            <div className="font-semibold text-sm text-slate-800">Images / Reference Files</div>
          </div>
          {imageAttachments.length === 0 ? (
            <div className="text-xs text-slate-400">No images</div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {imageAttachments.map((a) => (
                <ImageThumb key={a.id} attachment={a} onOpen={() => openImage(a)} />
              ))}
            </div>
          )}
        </div>

        {/* generic attach files */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-brand-600" />
              <div className="font-semibold text-sm text-slate-800">Attach Files</div>
            </div>
            {canEditProgress && (
              <label className="btn-secondary !py-1 cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> Upload
                <input type="file" multiple hidden onChange={uploadGeneralFiles} />
              </label>
            )}
          </div>
          {generalAttachments.length === 0 ? (
            <div className="text-xs text-slate-400">No files</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {generalAttachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs bg-slate-50 rounded-lg px-3 py-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate flex-1">{a.filename}</span>
                  <span className="text-slate-400">{formatBytes(a.size)}</span>
                  <button type="button" onClick={() => downloadFile(a)}><Download className="w-3.5 h-3.5 text-brand-600" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* task progress */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="w-4 h-4 text-brand-600" />
              <div className="font-semibold text-sm text-slate-800">Task Progress</div>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {WORK_STATUSES.map((ws) => (
                <button
                  key={ws} type="button" disabled={!canEditProgress}
                  onClick={() => setWorkStatus(ws)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${jc.workStatus === ws ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200'} ${canEditProgress ? '' : 'opacity-70'}`}
                >
                  {ws.replace('_', ' ')}
                </button>
              ))}
            </div>
            <ChecklistWidget jobcardId={id} checklist={jc.checklist} editable={canEditProgress} onUpdated={setJc} />
          </div>

          <div className="border border-slate-200 rounded-xl p-4 flex flex-col justify-center">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Overall Progress</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${jc.progressPercent}%` }} />
              </div>
              <span className="text-lg font-bold text-brand-700">{jc.progressPercent}%</span>
            </div>
            {canEditProgress && notCompleted && (
              <button type="button" className="btn-primary mt-4 w-fit" onClick={() => setConfirmComplete(true)} disabled={completing}>
                <CheckCircle2 className="w-4 h-4" /> {completing ? 'Completing…' : 'Mark as Completed'}
              </button>
            )}
          </div>
        </div>

        {/* work updates & comments */}
        <div className="border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-brand-600" />
            <div className="font-semibold text-sm text-slate-800">Work Updates &amp; Comments</div>
          </div>
          <WorkUpdatesPanel jobcardId={id} editable={canEditProgress} />
        </div>

        {/* activity timeline */}
        <div className="border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <ActivityIcon className="w-4 h-4 text-brand-600" />
            <div className="font-semibold text-sm text-slate-800">Activity Timeline</div>
          </div>
          <ActivityTimeline jobcardId={id} />
        </div>

        {jc.reverts?.length > 0 && (
          <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
            <div className="flex items-center gap-2 mb-2 text-orange-800">
              <AlertTriangle className="w-4 h-4" />
              <div className="font-semibold text-sm">Revert History</div>
            </div>
            <ul className="text-sm space-y-2">
              {jc.reverts.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-orange-700">
                  <span className="text-xs bg-orange-100 px-2 py-0.5 rounded">{date(r.revertedAt)}</span>
                  <span>{r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isAdmin && notCompleted && (
          <div className="border-t border-slate-200 pt-5">
            <div className="flex items-center gap-2 mb-3 text-red-700">
              <RotateCcw className="w-4 h-4" />
              <div className="text-sm font-semibold">Revert this jobcard</div>
            </div>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Reason for revert" value={revertReason} onChange={(e) => setRevertReason(e.target.value)} />
              <button className="btn-danger" onClick={doRevert}><RotateCcw className="w-4 h-4" /> Revert</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageThumb({ attachment, onOpen }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    let objUrl;
    api.get(`/attachments/file/${attachment.id}`, { responseType: 'blob' }).then((r) => {
      if (cancelled) return;
      objUrl = URL.createObjectURL(r.data);
      setUrl(objUrl);
    });
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [attachment.id]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:opacity-80 transition-opacity"
      title={attachment.filename}
    >
      {url ? <img src={url} alt={attachment.filename} className="w-full h-full object-cover" /> : null}
    </button>
  );
}
