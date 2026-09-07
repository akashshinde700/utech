import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Factory, CheckCircle2, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import Pagination from '../../components/ui/Pagination';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { styles } from '../../lib/formStyles';
import { date } from '../../lib/format';
import toast from 'react-hot-toast';

// vendor-facing labels over the same underlying JobworkStatus enum — no
// values renamed at the schema level, this is presentation only.
const STATUS_LABELS = {
  ISSUED: 'At Vendor',
  PARTIAL_RECEIVED: 'Partially Returned',
  RECEIVED: 'Returned',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export default function JobworkPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], pagination: null });
  const [receiving, setReceiving] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/jobwork', { params: { page } });
      setData(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load jobwork challans');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [page]);

  async function openReceive(row) {
    const { data } = await api.get(`/jobwork/${row.id}`);
    setReceiving({
      ...data,
      lines: (data.lines || []).map((l) => ({ ...l, qtyReceiveNow: '', qtyRejectNow: '' })),
    });
  }

  const lineOutstanding = (l) => Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected);
  // live inline error: received + rejected can never exceed what is still
  // outstanding at the vendor (same rule the submit guard enforces)
  const lineOver = (l) =>
    Number(l.qtyReceiveNow || 0) + Number(l.qtyRejectNow || 0) > lineOutstanding(l);

  async function doReceive() {
    // quantity going back can never exceed what is still outstanding at the
    // vendor (sent − already received − already rejected)
    const overLines = receiving.lines.filter((l) => {
      const outstanding = Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected);
      const now = Number(l.qtyReceiveNow || 0) + Number(l.qtyRejectNow || 0);
      return now > outstanding;
    });
    if (overLines.length) {
      const l = overLines[0];
      const outstanding = Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected);
      toast.error(`"${l.item?.name || l.description || 'Line'}" only has ${outstanding} outstanding — received + rejected can't exceed that`);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/jobwork/${receiving.id}/receive`, {
        lines: receiving.lines
          .filter((l) => Number(l.qtyReceiveNow) > 0 || Number(l.qtyRejectNow) > 0)
          .map((l) => ({ id: l.id, qtyReceived: Number(l.qtyReceiveNow) || 0, qtyRejected: Number(l.qtyRejectNow) || 0 })),
      });
      toast.success('Received'); setReceiving(null); load();
    } catch {} finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Jobwork Challans" action={<Link to="/jobwork/new" className="btn-primary"><Plus className="w-4 h-4" /> New jobwork</Link>} />

      <div className="mb-4 flex items-center gap-1.5 text-xs text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200/80 shadow-sm w-fit">
        <Factory className="w-3.5 h-3.5" />
        {data.pagination?.total ?? 0} challans
      </div>

      <DataTable
        loading={loading}
        error={error}
        onRetry={load}
        rows={data.items}
        emptyTitle="No jobwork challans yet"
        emptyDescription="Send material out to a vendor for processing with a jobwork challan."
        emptyAction={{ label: 'New jobwork', onClick: () => navigate('/jobwork/new'), icon: Plus }}
        columns={[
          { key: 'number', title: 'Number' },
          { key: 'date', title: 'Date', render: (r) => date(r.date) },
          { key: 'party', title: 'Vendor', render: (r) => r.party?.name },
          { key: 'materialOwnerType', title: 'Material', render: (r) => (
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${r.materialOwnerType === 'CUSTOMER' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
              {r.materialOwnerType === 'CUSTOMER' ? 'Customer' : 'Company'}
            </span>
          ) },
          { key: 'status', title: 'Status', render: (r) => <Badge status={r.status}>{STATUS_LABELS[r.status] || r.status}</Badge> },
          { key: '__act', title: '', render: (r) => (
            r.status !== 'RECEIVED' && r.status !== 'REJECTED' && r.status !== 'CANCELLED'
              ? <button className="btn-secondary !px-2 !py-1" onClick={() => openReceive(r)}><CheckCircle2 className="w-3.5 h-3.5" /> Receive</button>
              : null
          )},
        ]}
      />
      <Pagination pagination={data.pagination} onPage={setPage} />

      <Modal
        open={!!receiving}
        onClose={() => setReceiving(null)}
        title="Receive Challan"
        description={receiving?.number}
        size="lg"
        footer={
          <>
            <button type="button" className={styles.secondaryBtn} onClick={() => setReceiving(null)} disabled={saving}>Cancel</button>
            <button type="button" className={styles.primaryBtn} onClick={doReceive} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Receive'}
            </button>
          </>
        }
      >
        {receiving && (
          <div className="overflow-x-auto scroll-x-hint">
            <table className="min-w-full">
              <thead><tr>
                <th className="table-th rounded-tl-lg">Item</th>
                <th className="table-th text-right">Sent</th>
                <th className="table-th text-right">Already received</th>
                <th className="table-th text-right">Receive now</th>
                <th className="table-th text-right rounded-tr-lg">Reject now</th>
              </tr></thead>
              <tbody>
                {receiving.lines.map((l, i) => {
                  const outstanding = Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected);
                  const over = lineOver(l);
                  return (
                    <tr key={l.id} className={i % 2 === 1 ? 'bg-slate-50/30' : ''}>
                      <td className="table-td font-medium">{l.item?.name || l.description || '—'}</td>
                      <td className="table-td text-right">{Number(l.qtySent)}</td>
                      <td className="table-td text-right">{Number(l.qtyReceived)}</td>
                      <td className="table-td text-right">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          max={outstanding}
                          aria-label={`Line ${i + 1} — quantity received now`}
                          className={`${styles.input} !h-9 text-right w-24 tabular-nums ${over ? styles.inputError : ''}`}
                          aria-invalid={over}
                          value={l.qtyReceiveNow}
                          onChange={(e) => {
                            const ls = [...receiving.lines]; ls[i] = { ...l, qtyReceiveNow: e.target.value };
                            setReceiving({ ...receiving, lines: ls });
                          }} />
                        {over && <p role="alert" className={`${styles.errorText} justify-end`}>Max {outstanding} outstanding</p>}
                      </td>
                      <td className="table-td text-right">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          max={outstanding}
                          aria-label={`Line ${i + 1} — quantity rejected now`}
                          className={`${styles.input} !h-9 text-right w-24 tabular-nums ${over ? styles.inputError : ''}`}
                          aria-invalid={over}
                          value={l.qtyRejectNow}
                          onChange={(e) => {
                            const ls = [...receiving.lines]; ls[i] = { ...l, qtyRejectNow: e.target.value };
                            setReceiving({ ...receiving, lines: ls });
                          }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
