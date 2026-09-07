import { useEffect, useRef, useState } from 'react';
import { ClipboardList, Play, Send, RotateCcw, X, Upload, CheckCircle2, Eye, Info } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import PdfViewerModal from '../../components/pdf/PdfViewerModal';
import { date as fmtDate, datetime as fmtDateTime } from '../../lib/format';
import toast from 'react-hot-toast';

const STATUS_BADGE = {
  ASSIGNED: 'DRAFT', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'PAID', REOPENED: 'ON_HOLD', CANCELLED: 'CANCELLED',
};

function docLabel(a) {
  const pages = a.pageNumbers && a.pageNumbers.length ? ` (p. ${a.pageNumbers.join(',')})` : '';
  return `${a.attachment?.filename || '—'}${pages}`;
}

function StatCards({ stats }) {
  if (!stats) return null;
  const cards = [
    { label: 'Total', value: stats.total },
    { label: 'Pending', value: stats.assigned },
    { label: 'In Progress', value: stats.inProgress },
    { label: 'Completed', value: stats.completed },
    { label: 'Reopened', value: stats.reopened },
    { label: 'Overdue', value: stats.overdue },
    { label: 'Completion %', value: `${stats.completionPercentage}%` },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl border border-slate-200/80 p-3 text-center shadow-sm">
          <div className="text-xl font-bold text-slate-900">{c.value}</div>
          <div className="text-[11px] text-slate-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function AssignmentsPage() {
  const user = useAuth((s) => s.user);
  const isElevated = (user?.hierarchyLevel != null && user.hierarchyLevel <= 2) || user?.role === 'Project Engineer';
  const [tab, setTab] = useState('to-me');
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [reopening, setReopening] = useState(null);
  const [starting, setStarting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [detailsFor, setDetailsFor] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputs = useRef({});

  useEffect(() => {
    if (isElevated) api.get('/departments', { params: { pageSize: 200 } }).then((r) => setDepartments(r.data.items));
  }, [isElevated]);

  async function load() {
    setLoading(true);
    setError(null);
    const params = tab === 'to-me' ? { assignedToId: 'me' } : tab === 'by-me' ? { assignedById: 'me' } : {};
    if (departmentFilter) params.departmentId = departmentFilter;
    try {
      const [itemsRes, statsRes] = await Promise.all([
        api.get('/assignments', { params }),
        api.get('/assignments/stats', { params: departmentFilter ? { departmentId: departmentFilter } : {} }),
      ]);
      setItems(itemsRes.data);
      setStats(statsRes.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load assignments');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [tab, departmentFilter]);

  async function act(id, action, body) {
    try {
      await api.post(`/assignments/${id}/${action}`, body || {});
      toast.success('Updated');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed');
    }
  }

  async function cancel(id) {
    if (!confirm('Cancel this assignment?')) return;
    try {
      await api.delete(`/assignments/${id}`);
      toast.success('Cancelled');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel');
    }
  }

  async function submitStart() {
    try {
      await api.post(`/assignments/${starting.id}/start`, { startNotes: starting.notes || '' });
      toast.success('Started');
      setStarting(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to start');
    }
  }

  async function submitComplete() {
    try {
      const file = fileInputs.current[completing.id]?.files?.[0];
      if (file) {
        const fd = new FormData();
        fd.append('files', file);
        await api.post(`/attachments/ASSIGNMENT/${completing.id}`, fd);
      }
      await api.post(`/assignments/${completing.id}/complete`, { completionRemarks: completing.remarks || '' });
      toast.success('Marked as completed');
      setCompleting(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to complete');
    }
  }

  async function submitReopen() {
    await act(reopening.id, 'reopen', { reason: reopening.reason || '' });
    setReopening(null);
  }

  const toMeColumns = [
    { key: 'doc', title: 'Document', render: (r) => docLabel(r) },
    { key: 'department', title: 'Department', render: (r) => r.department?.name || '—' },
    { key: 'subCategory', title: 'Department Role', render: (r) => r.departmentSubCategory?.name || '—' },
    { key: 'assignedBy', title: 'Assigned By', render: (r) => r.assignedBy?.name || '—' },
    { key: 'priority', title: 'Priority' },
    { key: 'dueDate', title: 'Due', render: (r) => fmtDate(r.dueDate) },
    { key: 'status', title: 'Status', render: (r) => <Badge status={STATUS_BADGE[r.status]}>{r.status.replace('_', ' ')}</Badge> },
    { key: '__act', title: '', width: 330, render: (r) => (
      <div className="flex gap-1.5 justify-end items-center">
        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setDetailsFor(r)}><Info className="w-3.5 h-3.5" /> Details</button>
        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setViewing(r)}><Eye className="w-3.5 h-3.5" /> View</button>
        {(r.status === 'ASSIGNED' || r.status === 'REOPENED') && <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setStarting({ id: r.id, notes: '' })}><Play className="w-3.5 h-3.5" /> Start Work</button>}
        {r.status === 'IN_PROGRESS' && <button className="btn-primary !px-2 !py-1 text-xs" onClick={() => setCompleting({ id: r.id, remarks: '' })}><CheckCircle2 className="w-3.5 h-3.5" /> Mark as Complete</button>}
      </div>
    ) },
  ];

  const byMeColumns = [
    { key: 'doc', title: 'Document', render: (r) => docLabel(r) },
    { key: 'department', title: 'Department', render: (r) => r.department?.name || '—' },
    { key: 'subCategory', title: 'Department Role', render: (r) => r.departmentSubCategory?.name || '—' },
    { key: 'assignedTo', title: 'Assigned To', render: (r) => r.assignedTo?.name || '—' },
    { key: 'sentOn', title: 'Sent On', render: (r) => fmtDate(r.startedAt) },
    { key: 'dueDate', title: 'Due Back', render: (r) => fmtDate(r.dueDate) },
    { key: 'receivedBack', title: 'Received Back', render: (r) => fmtDate(r.completedAt) },
    { key: 'status', title: 'Status', render: (r) => <Badge status={STATUS_BADGE[r.status]}>{r.status.replace('_', ' ')}</Badge> },
    { key: '__act', title: '', width: 310, render: (r) => (
      <div className="flex gap-1.5 justify-end items-center">
        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setDetailsFor(r)}><Info className="w-3.5 h-3.5" /> Details</button>
        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setViewing(r)}><Eye className="w-3.5 h-3.5" /> View</button>
        {r.status === 'COMPLETED' && <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setReopening({ id: r.id, reason: '' })}><RotateCcw className="w-3.5 h-3.5" /> Reopen</button>}
        {r.status === 'ASSIGNED' && <button className="btn-danger !px-2 !py-1 text-xs" onClick={() => cancel(r.id)}>Cancel</button>}
      </div>
    ) },
  ];

  const allColumns = [
    { key: 'doc', title: 'Document', render: (r) => docLabel(r) },
    { key: 'department', title: 'Department', render: (r) => r.department?.name || '—' },
    { key: 'subCategory', title: 'Department Role', render: (r) => r.departmentSubCategory?.name || '—' },
    { key: 'assignedTo', title: 'Sent To', render: (r) => r.assignedTo?.name || '—' },
    { key: 'assignedBy', title: 'Assigned By', render: (r) => r.assignedBy?.name || '—' },
    { key: 'sentOn', title: 'Sent On', render: (r) => fmtDate(r.startedAt) },
    { key: 'dueDate', title: 'Due Back', render: (r) => fmtDate(r.dueDate) },
    { key: 'priority', title: 'Priority' },
    { key: 'status', title: 'Status', render: (r) => <Badge status={STATUS_BADGE[r.status]}>{r.status.replace('_', ' ')}</Badge> },
    { key: 'completedAt', title: 'Received Back', render: (r) => fmtDateTime(r.completedAt) },
    { key: '__act', title: '', width: 110, render: (r) => (
      <div className="flex gap-1.5 justify-end items-center">
        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setDetailsFor(r)}><Info className="w-3.5 h-3.5" /> Details</button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Assignments" subtitle="Document/page-level work delegation" />

      <StatCards stats={stats} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === 'to-me' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`} onClick={() => setTab('to-me')}>Assigned to me</button>
        <button className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === 'by-me' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`} onClick={() => setTab('by-me')}>Assigned by me</button>
        {isElevated && (
          <button className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === 'all' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`} onClick={() => setTab('all')}>All Assignments</button>
        )}
        {isElevated && (
          <select className="input max-w-[220px] ml-auto" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>

      <DataTable columns={tab === 'to-me' ? toMeColumns : tab === 'by-me' ? byMeColumns : allColumns} rows={items} loading={loading} error={error} onRetry={load} />

      {viewing && (
        <PdfViewerModal
          attachmentId={viewing.attachment?.id}
          filename={viewing.attachment?.filename}
          allowedPages={viewing.pageNumbers && viewing.pageNumbers.length ? viewing.pageNumbers : null}
          onClose={() => setViewing(null)}
        />
      )}

      {detailsFor && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm grid place-items-center z-50 animate-fade-in">
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <div className="text-lg font-bold text-slate-900 flex items-center gap-2"><Info className="w-5 h-5 text-brand-600" /> Assignment Details</div>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setDetailsFor(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3 text-sm">
              <div><span className="text-slate-500">Document:</span> <span className="font-medium">{docLabel(detailsFor)}</span></div>
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-slate-500">Department:</span> <span className="font-medium">{detailsFor.department?.name || '—'}</span></div>
                <div><span className="text-slate-500">Department Role:</span> <span className="font-medium">{detailsFor.departmentSubCategory?.name || '—'}</span></div>
                <div><span className="text-slate-500">Assigned By:</span> <span className="font-medium">{detailsFor.assignedBy?.name || '—'}</span></div>
                <div><span className="text-slate-500">Assigned To:</span> <span className="font-medium">{detailsFor.assignedTo?.name || '—'}</span></div>
                <div><span className="text-slate-500">Priority:</span> <span className="font-medium">{detailsFor.priority}</span></div>
                <div><span className="text-slate-500">Due:</span> <span className="font-medium">{fmtDate(detailsFor.dueDate)}</span></div>
              </div>
              <div><span className="text-slate-500">Status:</span> <Badge status={STATUS_BADGE[detailsFor.status]}>{detailsFor.status.replace('_', ' ')}</Badge></div>
              {detailsFor.instructions && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-slate-500 mb-1">Instructions</div>
                  <div className="bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{detailsFor.instructions}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs text-slate-500">
                <div>Assigned: {fmtDateTime(detailsFor.assignedAt)}</div>
                <div>Sent out (Started): {fmtDateTime(detailsFor.startedAt)}</div>
                <div>Received back (Completed): {fmtDateTime(detailsFor.completedAt)}</div>
                <div>Completed By: {detailsFor.completedBy?.name || '—'}</div>
              </div>
              {detailsFor.startNotes && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-slate-500 mb-1 font-medium">Sent To / Start Notes</div>
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 whitespace-pre-wrap">{detailsFor.startNotes}</div>
                </div>
              )}
              {detailsFor.completionRemarks && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-slate-500 mb-1 font-medium">Completion Remarks</div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 whitespace-pre-wrap">{detailsFor.completionRemarks}</div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn-secondary" onClick={() => setDetailsFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {starting && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm grid place-items-center z-50 animate-fade-in">
          <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <div className="text-lg font-bold text-slate-900 flex items-center gap-2"><Play className="w-5 h-5 text-brand-600" /> Start Work</div>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setStarting(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div><label className="label">Sent To / Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                <textarea className="input" rows={3} placeholder="e.g. Sent to Shree Engineering Works, Pune via WhatsApp" value={starting.notes} onChange={(e) => setStarting({ ...starting, notes: e.target.value })} />
                <div className="text-xs text-slate-400 mt-1">Useful if this is going out to an external vendor — note who it's sent to.</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn-secondary" onClick={() => setStarting(null)}>Cancel</button>
              <button className="btn-primary" onClick={submitStart}><Play className="w-4 h-4" /> Confirm Start</button>
            </div>
          </div>
        </div>
      )}

      {completing && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm grid place-items-center z-50 animate-fade-in">
          <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <div className="text-lg font-bold text-slate-900 flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-brand-600" /> Mark as Complete</div>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setCompleting(null)}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-600 mb-4">Are you sure you want to mark this assigned PDF work as completed?</p>
            <div className="space-y-4">
              <div><label className="label">Completion Remarks</label>
                <textarea className="input" rows={3} value={completing.remarks} onChange={(e) => setCompleting({ ...completing, remarks: e.target.value })} /></div>
              <div><label className="label">Output file (optional)</label>
                <input type="file" ref={(el) => { fileInputs.current[completing.id] = el; }} className="input" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn-secondary" onClick={() => setCompleting(null)}>Cancel</button>
              <button className="btn-primary" onClick={submitComplete}><Send className="w-4 h-4" /> Confirm Complete</button>
            </div>
          </div>
        </div>
      )}

      {reopening && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm grid place-items-center z-50 animate-fade-in">
          <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <div className="text-lg font-bold text-slate-900 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-brand-600" /> Reopen Work</div>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setReopening(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div><label className="label">Reason</label>
                <textarea className="input" rows={3} value={reopening.reason} onChange={(e) => setReopening({ ...reopening, reason: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn-secondary" onClick={() => setReopening(null)}>Cancel</button>
              <button className="btn-primary" onClick={submitReopen}><Upload className="w-4 h-4" /> Reopen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
