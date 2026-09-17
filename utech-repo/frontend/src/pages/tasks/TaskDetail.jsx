import { useEffect, useRef, useState } from 'react';
import {
  Loader2, User, Calendar, Clock, MessageSquare, Paperclip, Activity as ActivityIcon,
  Check, Play, Pause, CheckCircle2, XCircle, RotateCcw, Ban, UserPlus, Wrench, Upload, Trash2, Download,
} from 'lucide-react';
import api from '../../lib/api';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Badge from '../../components/ui/Badge';
import ActivityTimeline from '../../components/jobcards/ActivityTimeline';
import { styles } from '../../lib/formStyles';
import { date, datetime } from '../../lib/format';
import { hasPermission } from '../../lib/permissions';
import { useAuth } from '../../store/auth';
import toast from 'react-hot-toast';

const TABS = ['Details', 'Comments', 'Attachments', 'Activity'];

function ActionButton({ icon: Icon, label, onClick, variant = 'secondary', busy }) {
  const cls = variant === 'primary' ? styles.primaryBtn : variant === 'danger' ? 'btn-danger' : styles.secondaryBtn;
  return (
    <button type="button" className={`${cls} text-sm`} onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />} {label}
    </button>
  );
}

export default function TaskDetail({ taskId, onClose, onChanged }) {
  const user = useAuth((s) => s.user);
  const isManager = hasPermission(user, 'task.update');
  const fileInputRef = useRef(null);

  const [task, setTask] = useState(null);
  const [tab, setTab] = useState('Details');
  const [busy, setBusy] = useState(false);

  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [reasonFor, setReasonFor] = useState(null); // status string awaiting a reason
  const [reasonText, setReasonText] = useState('');
  const [progressInput, setProgressInput] = useState(0);

  const [assigning, setAssigning] = useState(false);
  const [assignUsers, setAssignUsers] = useState([]);
  const [assignTo, setAssignTo] = useState('');

  const [reworking, setReworking] = useState(false);
  const [reworkReason, setReworkReason] = useState('');
  const [reworkTo, setReworkTo] = useState('');

  async function load() {
    const r = await api.get(`/tasks/${taskId}`);
    setTask(r.data);
    setProgressInput(r.data.progressPercent);
  }
  async function loadNotes() { const r = await api.get(`/tasks/${taskId}/notes`); setNotes(r.data); }
  async function loadAttachments() { const r = await api.get(`/attachments/TASK/${taskId}`); setAttachments(r.data); }
  useEffect(() => { load(); loadNotes(); loadAttachments(); }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) {
    return (
      <Modal open onClose={onClose} title="Loading task…" size="lg">
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      </Modal>
    );
  }

  const isAssignee = task.assignedTo?.id === user.id;
  const s = task.status;

  function notifyChanged() { onChanged?.(); load(); }

  async function setStatus(status, reason) {
    setBusy(true);
    try {
      await api.patch(`/tasks/${taskId}/status`, { status, reason: reason || undefined });
      toast.success('Task updated');
      setReasonFor(null); setReasonText('');
      notifyChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update task');
    } finally {
      setBusy(false);
    }
  }

  function requestReason(status) { setReasonFor(status); setReasonText(''); }
  function confirmReason() {
    if (!reasonText.trim()) { toast.error('A reason is required'); return; }
    setStatus(reasonFor, reasonText.trim());
  }

  async function saveProgress() {
    setBusy(true);
    try {
      await api.patch(`/tasks/${taskId}/progress`, { progressPercent: Number(progressInput) });
      toast.success('Progress updated');
      notifyChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update progress');
    } finally {
      setBusy(false);
    }
  }

  async function openAssign() {
    setAssigning(true);
    setAssignTo('');
    const r = await api.get('/users', { params: { departmentId: task.department?.id, isActive: true, pageSize: 200 } });
    setAssignUsers(r.data.items);
  }
  async function doAssign() {
    if (!assignTo) { toast.error('Select an employee'); return; }
    setBusy(true);
    try {
      await api.post(`/tasks/${taskId}/assign`, { assignedToId: Number(assignTo) });
      toast.success('Task assigned');
      setAssigning(false);
      notifyChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to assign');
    } finally {
      setBusy(false);
    }
  }

  async function openRework() {
    setReworking(true);
    setReworkReason(''); setReworkTo('');
    const r = await api.get('/users', { params: { departmentId: task.department?.id, isActive: true, pageSize: 200 } });
    setAssignUsers(r.data.items);
  }
  async function doRework() {
    if (!reworkReason.trim()) { toast.error('Reason is required'); return; }
    setBusy(true);
    try {
      await api.post(`/tasks/${taskId}/rework`, { reworkReason: reworkReason.trim(), assignedToId: reworkTo ? Number(reworkTo) : null });
      toast.success('Rework task created');
      setReworking(false);
      notifyChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create rework task');
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!newNote.trim()) return;
    try {
      await api.post(`/tasks/${taskId}/notes`, { kind: 'COMMENT', body: newNote.trim() });
      setNewNote('');
      loadNotes();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add comment');
    }
  }

  async function onUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      await api.post(`/attachments/TASK/${taskId}`, fd);
      toast.success('Uploaded');
      loadAttachments();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }
  async function downloadFile(a) {
    const r = await api.get(`/attachments/file/${a.id}`, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    window.open(url, '_blank');
  }
  async function deleteFile(a) {
    try {
      await api.delete(`/attachments/file/${a.id}`);
      toast.success('Deleted');
      loadAttachments();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  }

  const actions = [];
  if (s === 'NOT_STARTED' && isManager) actions.push(<ActionButton key="assign" icon={UserPlus} label="Assign" onClick={openAssign} variant="primary" />);
  if (s === 'ASSIGNED') {
    if (isAssignee) {
      actions.push(<ActionButton key="accept" icon={Check} label="Accept" onClick={() => setStatus('ACCEPTED')} variant="primary" busy={busy} />);
      actions.push(<ActionButton key="reject" icon={XCircle} label="Reject" onClick={() => requestReason('REJECTED')} variant="danger" />);
    }
    if (isManager) actions.push(<ActionButton key="reassign" icon={UserPlus} label="Reassign" onClick={openAssign} />);
  }
  if (s === 'ACCEPTED' && isAssignee) actions.push(<ActionButton key="start" icon={Play} label="Start" onClick={() => setStatus('IN_PROGRESS')} variant="primary" busy={busy} />);
  if ((s === 'IN_PROGRESS' || s === 'REOPENED') && isAssignee) {
    actions.push(<ActionButton key="hold" icon={Pause} label="Put On Hold" onClick={() => requestReason('ON_HOLD')} />);
    actions.push(<ActionButton key="complete" icon={CheckCircle2} label="Mark Completed" onClick={() => setStatus('COMPLETED')} variant="primary" busy={busy} />);
  }
  if (s === 'ON_HOLD' && isAssignee) actions.push(<ActionButton key="resume" icon={Play} label="Resume" onClick={() => setStatus('IN_PROGRESS')} variant="primary" busy={busy} />);
  if (['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(s) && isManager) {
    actions.push(<ActionButton key="reassign2" icon={UserPlus} label="Reassign" onClick={openAssign} />);
    actions.push(<ActionButton key="cancel" icon={Ban} label="Cancel" onClick={() => requestReason('CANCELLED')} variant="danger" />);
  }
  if (s === 'COMPLETED' && isManager) {
    actions.push(<ActionButton key="reopen" icon={RotateCcw} label="Reopen" onClick={() => requestReason('REOPENED')} />);
    actions.push(<ActionButton key="rework" icon={Wrench} label="Create Rework Task" onClick={openRework} variant="primary" />);
  }
  if (s === 'REJECTED' && isManager) actions.push(<ActionButton key="reassign3" icon={UserPlus} label="Reassign" onClick={openAssign} variant="primary" />);

  return (
    <Modal open onClose={onClose} title={task.displayTitle} description={`${task.jobcard.number}${task.jobcard.project ? ` · ${task.jobcard.project.name}` : ''}`} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={task.overdue ? 'OVERDUE' : task.status}>{task.overdue ? 'OVERDUE' : task.status.replace(/_/g, ' ')}</Badge>
          <Badge status={task.priority}>{task.priority}</Badge>
          {task.department && <span className="text-xs text-slate-500">{task.department.name}</span>}
          {task.process && <span className="text-xs text-slate-400">· {task.process.name}{task.process.stage ? ` (${task.process.stage})` : ''}</span>}
          {task.parentOperation && <span className="text-xs text-amber-600">· Rework of task #{task.parentOperation.id}</span>}
        </div>

        {actions.length > 0 && <div className="flex flex-wrap gap-2 pb-1">{actions}</div>}

        {reasonFor && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-amber-800">Reason required to set status to {reasonFor.replace(/_/g, ' ')}</div>
            <textarea className={styles.textarea} rows={2} value={reasonText} onChange={(e) => setReasonText(e.target.value)} autoFocus />
            <div className="flex gap-2 justify-end">
              <button type="button" className={styles.ghostBtn} onClick={() => setReasonFor(null)}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={confirmReason} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Confirm</button>
            </div>
          </div>
        )}

        {assigning && (
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-brand-800">Assign to</div>
            <SearchableSelect value={assignTo} onChange={setAssignTo} options={assignUsers.map((u) => ({ value: u.id, label: u.name, subtitle: u.email }))} placeholder="Select employee…" />
            <div className="flex gap-2 justify-end">
              <button type="button" className={styles.ghostBtn} onClick={() => setAssigning(false)}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={doAssign} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Assign</button>
            </div>
          </div>
        )}

        {reworking && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <div className="text-xs font-semibold text-amber-800">Rework — new task linked to this one</div>
            <textarea className={styles.textarea} rows={2} placeholder="Reason (e.g. dimension out of tolerance)" value={reworkReason} onChange={(e) => setReworkReason(e.target.value)} />
            <SearchableSelect value={reworkTo} onChange={setReworkTo} options={assignUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Assign to… (optional)" />
            <div className="flex gap-2 justify-end">
              <button type="button" className={styles.ghostBtn} onClick={() => setReworking(false)}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={doRework} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Create Rework Task</button>
            </div>
          </div>
        )}

        {['ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'].includes(s) && isAssignee && (
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-600 mb-2">Progress — {progressInput}%</div>
            <div className="flex items-center gap-3">
              <input type="range" min="0" max="100" step="5" className="flex-1" value={progressInput} onChange={(e) => setProgressInput(e.target.value)} />
              <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={saveProgress} disabled={busy || Number(progressInput) === task.progressPercent}>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-slate-100">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? 'border-brand-500 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t === 'Comments' && notes.length > 0 ? `${t} (${notes.length})` : t === 'Attachments' && attachments.length > 0 ? `${t} (${attachments.length})` : t}
            </button>
          ))}
        </div>

        {tab === 'Details' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div><div className="text-xs text-slate-500 flex items-center gap-1"><User className="w-3 h-3" /> Assigned To</div><div className="font-medium">{task.assignedTo?.name || '—'}</div></div>
            <div><div className="text-xs text-slate-500 flex items-center gap-1"><User className="w-3 h-3" /> Assigned By</div><div className="font-medium">{task.assignedBy?.name || '—'}</div></div>
            <div><div className="text-xs text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> Planned Start</div><div className="font-medium">{date(task.plannedStartAt)}</div></div>
            <div><div className="text-xs text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> Due Date</div><div className={`font-medium ${task.overdue ? 'text-danger-600' : ''}`}>{date(task.dueDate)}</div></div>
            <div><div className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Estimated Hrs</div><div className="font-medium">{task.estimatedHours ? Number(task.estimatedHours) : '—'}</div></div>
            <div><div className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Actual Hrs</div><div className="font-medium">{task.actualHours ? Number(task.actualHours) : '—'}</div></div>
            {task.machine && <div><div className="text-xs text-slate-500">Machine</div><div className="font-medium">{task.machine.name}</div></div>}
            {task.dependsOnOperation && <div className="col-span-2 sm:col-span-3"><div className="text-xs text-slate-500">Depends On</div><div className="font-medium">{task.dependsOnOperation.title || task.dependsOnOperation.process?.name} <Badge status={task.dependsOnOperation.status}>{task.dependsOnOperation.status.replace(/_/g, ' ')}</Badge></div></div>}
            {task.notes && <div className="col-span-2 sm:col-span-3"><div className="text-xs text-slate-500">Description / Instructions</div><div className="whitespace-pre-line">{task.notes}</div></div>}
            {task.reworkReason && <div className="col-span-2 sm:col-span-3"><div className="text-xs text-amber-600 font-semibold">Rework Reason</div><div>{task.reworkReason}</div></div>}
            {task.reworkTasks?.length > 0 && (
              <div className="col-span-2 sm:col-span-3">
                <div className="text-xs text-slate-500 mb-1">Rework Tasks</div>
                {task.reworkTasks.map((rt) => <div key={rt.id} className="flex items-center gap-2 text-xs"><Badge status={rt.status}>{rt.status.replace(/_/g, ' ')}</Badge> {rt.title}</div>)}
              </div>
            )}
          </div>
        )}

        {tab === 'Comments' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input className={styles.input} placeholder="Add a comment or work update…" value={newNote} onChange={(e) => setNewNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
              <button type="button" className="btn-secondary !px-3" onClick={addNote}><MessageSquare className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {notes.length === 0 && <div className="text-xs text-slate-400 py-4 text-center">No comments yet.</div>}
              {notes.map((n) => (
                <div key={n.id} className="rounded-lg bg-slate-50 border border-slate-100 p-2.5 text-sm">
                  <div className="flex justify-between text-xs text-slate-400 mb-0.5"><span>{n.author?.name || 'System'}</span><span>{datetime(n.createdAt)}</span></div>
                  {n.body}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'Attachments' && (
          <div className="space-y-3">
            <label className="btn-secondary text-sm cursor-pointer w-fit">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload files
              <input ref={fileInputRef} type="file" multiple hidden onChange={onUpload} />
            </label>
            <div className="space-y-1.5">
              {attachments.length === 0 && <div className="text-xs text-slate-400 py-4 text-center">No attachments yet.</div>}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <button type="button" className="flex items-center gap-2 text-brand-600 hover:underline truncate" onClick={() => downloadFile(a)}>
                    <Paperclip className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{a.filename}</span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" className="btn-icon" aria-label={`Download ${a.filename}`} onClick={() => downloadFile(a)}><Download className="w-3.5 h-3.5" /></button>
                    <button type="button" className="btn-icon text-danger-600" aria-label={`Delete ${a.filename}`} onClick={() => deleteFile(a)}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'Activity' && (
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1"><ActivityIcon className="w-3.5 h-3.5" /> Full history</div>
        )}
        {tab === 'Activity' && <ActivityTimeline endpoint={`/tasks/${taskId}/activity`} />}
      </div>
    </Modal>
  );
}
