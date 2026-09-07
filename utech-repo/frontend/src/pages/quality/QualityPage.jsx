import { useEffect, useState } from 'react';
import { Plus, ShieldCheck, Trash2, ClipboardCheck, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FormSection from '../../components/ui/FormSection';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import EmptyState from '../../components/ui/EmptyState';
import { styles } from '../../lib/formStyles';
import { required, validateAll } from '../../lib/validation';
import { date, todayLocal } from '../../lib/format';
import toast from 'react-hot-toast';

// where each refType's options come from — same endpoints the section pages use
const REF_SOURCES = {
  JOBCARD: '/jobcards',
  GRN: '/grns',
  DISPATCH: '/dispatch',
};

const emptyLine = () => ({ parameter: '', expected: '', actual: '', result: 'PASS', notes: '' });

const empty = {
  date: todayLocal(),
  refType: 'JOBCARD', refId: '', result: 'PENDING',
  inspectorName: '', remarks: '', certificateNo: '',
  lines: [emptyLine()],
};

export default function QualityPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ref picker options — loaded when the dialog opens or the ref type changes
  const [refOptions, setRefOptions] = useState([]);
  const [refsLoading, setRefsLoading] = useState(false);
  const dialogOpen = !!editing;
  const refType = editing?.refType || 'JOBCARD';

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/quality', { params: { page } });
      setData(r.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load quality records');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page]);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const url = REF_SOURCES[refType];
    if (!url) { setRefOptions([]); return undefined; }
    let dead = false;
    setRefsLoading(true);
    api.get(url, { params: { pageSize: 100 } })
      .then((r) => {
        if (dead) return;
        setRefOptions((r.data.items || []).map((it) => ({
          value: it.id,
          label: it.number,
          subtitle: [it.party?.name, it.status].filter(Boolean).join(' • ') || undefined,
        })));
      })
      .catch(() => { if (!dead) setRefOptions([]); })
      .finally(() => { if (!dead) setRefsLoading(false); });
    return () => { dead = true; };
  }, [dialogOpen, refType]);

  function editField(k, v) {
    setEditing((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  }

  function setLine(i, patch) {
    setEditing((f) => {
      const ls = [...f.lines];
      ls[i] = { ...ls[i], ...patch };
      return { ...f, lines: ls };
    });
  }

  async function save() {
    const { errors: all, ok } = validateAll(editing, {
      refId: (v) => required(v, 'Reference'),
    });
    if (!ok) {
      setErrors(all);
      toast.error('Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      await api.post('/quality', {
        ...editing,
        refId: Number(editing.refId),
        lines: editing.lines.filter((l) => l.parameter),
      });
      toast.success('Saved successfully');
      setEditing(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to save quality record');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const qc = confirmDelete;
    if (!qc) return;
    setDeleting(true);
    try {
      await api.delete(`/quality/${qc.id}`);
      toast.success('Deleted successfully');
      setConfirmDelete(null);
      load();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Quality Inspections"
        action={<button className="btn-primary" onClick={() => { setErrors({}); setEditing({ ...empty }); }}><Plus className="w-4 h-4" /> New inspection</button>} />

      <DataTable
        rows={data.items}
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No quality inspections"
        emptyDescription="Record an inspection against a jobcard, GRN or dispatch."
        emptyAction={{ label: 'New inspection', onClick: () => { setErrors({}); setEditing({ ...empty }); }, icon: Plus }}
        columns={[
          { key: 'number', title: 'Number' },
          { key: 'date', title: 'Date', render: (r) => date(r.date) },
          { key: 'refType', title: 'Ref Type' },
          { key: 'refId', title: 'Ref ID' },
          { key: 'result', title: 'Result', render: (r) =>
            r.result === 'PASS' ? <Badge status="PAID">PASS</Badge>
            : r.result === 'FAIL' ? <Badge status="OVERDUE">FAIL</Badge>
            : <Badge status="DRAFT">PENDING</Badge> },
          { key: 'certificateNo', title: 'Cert No' },
          { key: 'inspectorName', title: 'Inspector' },
          { key: '__act', title: '', render: (r) => (
            <button
              type="button"
              aria-label={`Delete ${r.number}`}
              className={`${styles.ghostBtn} !px-2 !py-1 text-danger-500 hover:bg-danger-50 hover:text-danger-600`}
              onClick={() => setConfirmDelete(r)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) },
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />

      {editing && (
        <Modal
          open={dialogOpen}
          onClose={() => setEditing(null)}
          title="Quality Inspection"
          description="Pick what was inspected, then record measured parameters"
          size="xl"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
        <div className="space-y-5">
          <FormSection icon={ShieldCheck} title="Inspection Details" description="Reference must be an existing jobcard, GRN or dispatch">
            <div className={styles.formGrid3}>
              <FormField id="qc-date" label="Date" htmlFor="qc-date">
                <input id="qc-date" type="date" className={styles.input} value={editing.date} onChange={(e) => editField('date', e.target.value)} />
              </FormField>
              <FormField id="qc-refType" label="Ref Type" hint="Switching type clears the reference" htmlFor="qc-refType">
                <select
                  id="qc-refType" className={styles.input} value={editing.refType}
                  onChange={(e) => setEditing((f) => ({ ...f, refType: e.target.value, refId: '' }))}
                >
                  <option>JOBCARD</option><option>GRN</option><option>DISPATCH</option>
                </select>
              </FormField>
              <FormField id="qc-refId" label="Reference" required error={errors.refId} htmlFor="qc-refId">
                <SearchableSelect
                  id="qc-refId"
                  value={editing.refId}
                  onChange={(v) => editField('refId', v)}
                  options={refOptions}
                  placeholder={`Select ${refType === 'JOBCARD' ? 'jobcard' : refType.toLowerCase()}…`}
                  error={errors.refId}
                  loading={refsLoading}
                  emptyText="No matches found"
                />
              </FormField>
              <FormField id="qc-result" label="Result" htmlFor="qc-result">
                <select id="qc-result" className={styles.input} value={editing.result} onChange={(e) => editField('result', e.target.value)}>
                  <option>PENDING</option><option>PASS</option><option>FAIL</option>
                </select>
              </FormField>
              <FormField id="qc-inspector" label="Inspector" htmlFor="qc-inspector">
                <input id="qc-inspector" className={styles.input} value={editing.inspectorName} onChange={(e) => editField('inspectorName', e.target.value)} />
              </FormField>
              <FormField id="qc-certificateNo" label="Certificate No" htmlFor="qc-certificateNo">
                <input id="qc-certificateNo" className={styles.input} value={editing.certificateNo} onChange={(e) => editField('certificateNo', e.target.value)} />
              </FormField>
              <FormField id="qc-remarks" label="Remarks" htmlFor="qc-remarks" className="sm:col-span-2 lg:col-span-3">
                <textarea id="qc-remarks" rows={2} className={styles.textarea} value={editing.remarks} onChange={(e) => editField('remarks', e.target.value)} />
              </FormField>
            </div>
          </FormSection>

          <FormSection
            icon={ClipboardCheck}
            title="Inspection Parameters"
            description="Rows without a parameter are dropped on save"
            actions={
              <button type="button" className={styles.secondaryBtn} onClick={() => setEditing({ ...editing, lines: [...editing.lines, emptyLine()] })}>
                <Plus className="h-4 w-4" /> Add
              </button>
            }
          >
            {editing.lines.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title="No parameters"
                description="Add a row for each measured parameter."
                action={{ label: 'Add parameter', onClick: () => setEditing({ ...editing, lines: [...editing.lines, emptyLine()] }), icon: Plus }}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/50">
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Parameter</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Expected</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Actual</th>
                      <th className="w-28 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Result</th>
                      <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editing.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-2 py-2">
                          <input aria-label={`Parameter ${i + 1}`} className={styles.input} value={l.parameter} onChange={(e) => setLine(i, { parameter: e.target.value })} />
                        </td>
                        <td className="px-2 py-2">
                          <input aria-label={`Parameter ${i + 1} expected`} className={styles.input} value={l.expected} onChange={(e) => setLine(i, { expected: e.target.value })} />
                        </td>
                        <td className="px-2 py-2">
                          <input aria-label={`Parameter ${i + 1} actual`} className={styles.input} value={l.actual} onChange={(e) => setLine(i, { actual: e.target.value })} />
                        </td>
                        <td className="px-2 py-2">
                          <select aria-label={`Parameter ${i + 1} result`} className={styles.input} value={l.result} onChange={(e) => setLine(i, { result: e.target.value })}>
                            <option>PASS</option><option>FAIL</option>
                          </select>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            aria-label={`Remove parameter ${i + 1}`}
                            className={`${styles.ghostBtn} !px-2 text-danger-500 hover:bg-danger-50 hover:text-danger-600`}
                            onClick={() => setEditing({ ...editing, lines: editing.lines.filter((_, ix) => ix !== i) })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FormSection>
        </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        title="Delete this inspection?"
        message={`Quality record ${confirmDelete?.number || ''} will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
      />
    </div>
  );
}
