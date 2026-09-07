import { useEffect, useState } from 'react';
import { Send, Check, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import FormField from '../ui/FormField';
import SearchableSelect from '../ui/SearchableSelect';
import { styles } from '../../lib/formStyles';

// Opened either from a "Project Files" card (whole document, pageNumbers=null)
// or from PdfViewerModal's page-select mode (pageNumbers = selected pages).
// Chain: Department(s) -> Assigned User per department — a Project Engineer
// can hand the same document/pages to several departments at once, each
// getting its own Assignment record and its own assignee.
export default function AssignModal({ attachment, pageNumbers, onClose, onSaved }) {
  const [departments, setDepartments] = useState([]);
  const [selected, setSelected] = useState({}); // { [departmentId]: assignedToId ('' = not chosen yet) }
  const [eligibleUsersByDept, setEligibleUsersByDept] = useState({});
  const [form, setForm] = useState({ instructions: '', priority: 'MEDIUM', dueDate: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/departments', { params: { pageSize: 200 } }).then((r) => setDepartments(r.data.items));
  }, []);

  function toggleDept(deptId) {
    setSelected((prev) => {
      const next = { ...prev };
      if (deptId in next) {
        delete next[deptId];
      } else {
        next[deptId] = '';
        if (!eligibleUsersByDept[deptId]) {
          api.get('/assignments/eligible-users', { params: { departmentId: deptId } })
            .then((r) => setEligibleUsersByDept((m) => ({ ...m, [deptId]: r.data })));
        }
      }
      return next;
    });
  }

  async function save() {
    const deptIds = Object.keys(selected);
    if (!deptIds.length) { toast.error('Please select at least one department'); return; }
    if (deptIds.some((id) => !selected[id])) { toast.error('Please select an assigned user for every selected department'); return; }
    setSaving(true);
    try {
      await Promise.all(deptIds.map((deptId) => api.post('/assignments', {
        attachmentId: attachment.id,
        assignedToId: Number(selected[deptId]),
        pageNumbers: pageNumbers && pageNumbers.length ? pageNumbers : null,
        departmentId: Number(deptId),
        instructions: form.instructions || null,
        priority: form.priority,
        dueDate: form.dueDate || null,
      })));
      toast.success(deptIds.length > 1 ? `Work assigned to ${deptIds.length} departments` : 'Work assigned successfully');
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to assign work');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign Work"
      description={`${attachment.filename}${pageNumbers && pageNumbers.length ? ` — page(s) ${pageNumbers.join(', ')}` : ' — whole document'}`}
      size="md"
      footer={
        <>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" />}
            {saving ? 'Assigning…' : 'Assign Work'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField
          id="assign-departments"
          label="Departments"
          hint="Select one or more departments — each gets its own assignee."
          required
        >
          <div className="space-y-1.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
            {departments.map((d) => {
              const checked = d.id in selected;
              return (
                <div key={d.id} className={`rounded-lg border transition-colors ${checked ? 'border-brand-200 bg-brand-50/50' : 'border-transparent hover:border-slate-200'}`}>
                  <label className="flex items-center gap-2 cursor-pointer px-1.5 py-1.5">
                    <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${checked ? 'bg-brand-600 border-brand-600' : 'border-slate-300 bg-white'}`}>
                      {checked && <Check className="w-3 h-3 text-white" aria-hidden="true" />}
                    </span>
                    <input type="checkbox" className="hidden" checked={checked} onChange={() => toggleDept(d.id)} />
                    <span className="text-sm font-medium text-slate-700">{d.name}</span>
                  </label>
                  {checked && (
                    <div className="px-1.5 pb-1.5 pl-8">
                      {!eligibleUsersByDept[d.id] ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading users…
                        </div>
                      ) : eligibleUsersByDept[d.id].length === 0 ? (
                        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-2">
                          No users found in this department.
                        </div>
                      ) : (
                        <SearchableSelect
                          id={`assign-user-${d.id}`}
                          value={selected[d.id]}
                          onChange={(v) => setSelected((prev) => ({ ...prev, [d.id]: v }))}
                          options={eligibleUsersByDept[d.id].map((u) => ({
                            value: u.id,
                            label: u.name,
                            subtitle: u.role?.name || undefined,
                          }))}
                          placeholder="— select user —"
                          loading={!eligibleUsersByDept[d.id]}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </FormField>

        <div className={styles.formGrid}>
          <FormField id="assign-priority" label="Priority">
            <select
              id="assign-priority"
              className={styles.input}
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </FormField>
          <FormField id="assign-dueDate" label="Due date">
            <input
              id="assign-dueDate"
              type="date"
              className={styles.input}
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </FormField>
        </div>
        <FormField id="assign-instructions" label="Instructions">
          <textarea
            id="assign-instructions"
            rows={3}
            className={styles.textarea}
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </FormField>
      </div>
    </Modal>
  );
}
