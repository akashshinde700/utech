import { useEffect, useMemo, useState } from 'react';
import { Plus, Wallet, Trash2, IndianRupee } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';
import FormField from '../../components/ui/FormField';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { styles } from '../../lib/formStyles';
import { required, positiveNumber, validateAll } from '../../lib/validation';
import { inr, date, todayLocal } from '../../lib/format';
import toast from 'react-hot-toast';

const CATEGORIES = ['Material', 'Travel', 'Salary', 'Utility', 'Office', 'Tax', 'Other'];
const PAYMENT_MODES = ['CASH', 'BANK', 'UPI', 'CHEQUE'];

const empty = {
  date: todayLocal(),
  category: 'Material', partyId: '', description: '',
  amount: '', taxAmount: 0, paymentMode: 'BANK', reference: '', notes: '',
};

export default function ExpensesPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
  const [parties, setParties] = useState([]);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [summary, setSummary] = useState([]);
  const [filter, setFilter] = useState({ category: '', from: '', to: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/expenses', { params: { page, ...filter } });
      setData(r.data);
      const s = await api.get('/expenses/summary');
      setSummary(s.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page, filter.category, filter.from, filter.to]);
  useEffect(() => { api.get('/parties', { params: { pageSize: 100 } }).then((r) => setParties(r.data.items)); }, []);

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}`, subtitle: p.phone || undefined })),
    [parties]
  );

  function setField(key, value) {
    setEditing((e) => ({ ...e, [key]: value }));
    setErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key];
      return next;
    });
  }

  function blurField(key) {
    let msg = null;
    if (key === 'description') msg = required(editing.description, 'Description');
    else if (key === 'date') msg = required(editing.date, 'Date');
    else if (key === 'amount') msg = positiveNumber(editing.amount, 'Amount');
    else if (key === 'taxAmount' && String(editing.taxAmount ?? '').trim() !== '' && (!Number.isFinite(Number(editing.taxAmount)) || Number(editing.taxAmount) < 0)) msg = 'Tax must be 0 or more';
    if (msg) setErrors((errs) => ({ ...errs, [key]: msg }));
  }

  function focusFirstError(errs) {
    const key = Object.keys(errs)[0];
    if (!key) return;
    const el = document.getElementById(key);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest' });
  }

  async function save() {
    const { errors: nextErrors, ok } = validateAll(editing, {
      date: (v) => required(v, 'Date'),
      category: (v) => required(v, 'Category'),
      description: (v) => required(v, 'Description'),
      amount: (v) => positiveNumber(v, 'Amount'),
      taxAmount: (v) => {
        const s = String(v ?? '').trim();
        if (s === '') return null;
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) return 'Tax must be 0 or more';
        return null;
      },
    });
    if (!ok) {
      setErrors(nextErrors);
      toast.error('Please fix the highlighted fields');
      focusFirstError(nextErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const payload = {
        ...editing,
        partyId: editing.partyId ? Number(editing.partyId) : null,
        amount: Number(editing.amount),
        taxAmount: Number(editing.taxAmount || 0),
      };
      if (editing.id) await api.put(`/expenses/${editing.id}`, payload);
      else await api.post('/expenses', payload);
      toast.success(editing.id ? 'Expense saved' : 'Expense created'); setEditing(null); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.delete(`/expenses/${deleting.id}`);
      toast.success('Expense deleted'); load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete expense');
    } finally {
      setDeletingBusy(false);
      setDeleting(null);
    }
  }

  const hasFilter = !!(filter.category || filter.from || filter.to);

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Operational expense tracking"
        action={<button className="btn-primary" onClick={() => { setErrors({}); setEditing({ ...empty }); }}><Plus className="w-4 h-4" /> New expense</button>} />

      {summary.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {summary.map((s) => (
            <div key={s.category} className="card p-3">
              <div className="text-xs text-slate-500">{s.category}</div>
              <div className="text-lg font-bold tabular-nums font-mono">{inr(s.total)}</div>
              <div className="text-[11px] text-slate-400">{s.count} entries</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <select className="input max-w-[180px]" aria-label="Filter by category" value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input type="date" className="input max-w-[170px]" aria-label="From date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
        <input type="date" className="input max-w-[170px]" aria-label="To date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
      </div>

      {!loading && !error && data.items.length === 0 && !hasFilter ? (
        <div className="card-flat">
          <EmptyState
            icon={Wallet}
            title="No expenses recorded yet"
            description="Track material, travel and other operational spend here."
            action={{ label: 'New expense', onClick: () => { setErrors({}); setEditing({ ...empty }); }, icon: Plus }}
          />
        </div>
      ) : (
        <DataTable
          rows={data.items}
          loading={loading}
          error={error}
          onRetry={load}
          filtered={hasFilter}
          columns={[
            { key: 'number', title: 'Number' },
            { key: 'date', title: 'Date', render: (r) => date(r.date) },
            { key: 'category', title: 'Category' },
            { key: 'party', title: 'Party', render: (r) => r.party?.name || '—' },
            { key: 'description', title: 'Description' },
            { key: 'amount', title: 'Amount', render: (r) => <span className="block text-right tabular-nums font-mono">{inr(r.amount)}</span> },
            { key: 'paymentMode', title: 'Mode' },
            { key: '__act', title: '', render: (r) => (
              <div className="flex justify-end">
                <button className="btn-danger !px-2 !py-1" aria-label={`Delete expense ${r.number}`} onClick={() => setDeleting(r)}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ) },
          ]}
        />
      )}
      <Pagination pagination={data.pagination} onPage={setPage} />

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit expense' : 'New expense'}
          description="Record operational spend against a category"
          size="lg"
          footer={
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button type="button" className={styles.primaryBtn} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <FormField id="expense-date" label="Date" required error={errors.date}>
            <input
              id="expense-date"
              type="date"
              className={`${styles.input} ${errors.date ? styles.inputError : ''}`}
              aria-invalid={!!errors.date}
              aria-describedby={errors.date ? 'expense-date-error' : undefined}
              value={editing.date}
              onChange={(e) => setField('date', e.target.value)}
              onBlur={() => blurField('date')}
            />
          </FormField>

          <div className={styles.formGrid}>
            <FormField id="category" label="Category" required error={errors.category}>
              <select
                id="category"
                className={styles.input}
                aria-invalid={!!errors.category}
                value={editing.category}
                onChange={(e) => setField('category', e.target.value)}
              >
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField id="paymentMode" label="Payment mode">
              <select id="paymentMode" className={styles.input} value={editing.paymentMode} onChange={(e) => setField('paymentMode', e.target.value)}>
                {PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </FormField>
            <FormField id="partyId" label="Party (optional)" className="sm:col-span-2">
              <SearchableSelect
                id="partyId"
                value={editing.partyId}
                onChange={(v) => setField('partyId', v)}
                options={partyOptions}
                placeholder="Select party…"
              />
            </FormField>
            <FormField
              id="description"
              label="Description"
              required
              error={errors.description}
              className="sm:col-span-2"
            >
              <input
                id="description"
                className={`${styles.input} ${errors.description ? styles.inputError : ''}`}
                aria-invalid={!!errors.description}
                aria-describedby={errors.description ? 'description-error' : undefined}
                value={editing.description}
                onChange={(e) => setField('description', e.target.value)}
                onBlur={() => blurField('description')}
              />
            </FormField>
            <FormField
              id="amount"
              label="Amount"
              required
              error={errors.amount}
            >
              <div className="relative">
                <IndianRupee className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={`${styles.input} pl-9 tabular-nums ${errors.amount ? styles.inputError : ''}`}
                  aria-invalid={!!errors.amount}
                  aria-describedby={errors.amount ? 'amount-error' : undefined}
                  value={editing.amount}
                  onChange={(e) => setField('amount', e.target.value)}
                  onBlur={() => blurField('amount')}
                />
              </div>
            </FormField>
            <FormField id="taxAmount" label="Tax" hint="Optional — GST or other tax component" error={errors.taxAmount}>
              <input
                id="taxAmount"
                type="number"
                step="0.01"
                min="0"
                className={`${styles.input} tabular-nums ${errors.taxAmount ? styles.inputError : ''}`}
                aria-invalid={!!errors.taxAmount}
                value={editing.taxAmount}
                onChange={(e) => setField('taxAmount', e.target.value)}
                onBlur={() => blurField('taxAmount')}
              />
            </FormField>
            <FormField id="reference" label="Reference" className="sm:col-span-2">
              <input id="reference" className={styles.input} value={editing.reference} onChange={(e) => setField('reference', e.target.value)} />
            </FormField>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete expense?"
        message={`Expense ${deleting?.number} will be permanently deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deletingBusy}
      />
    </div>
  );
}
