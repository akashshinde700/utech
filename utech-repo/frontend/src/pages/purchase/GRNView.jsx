import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, PackageCheck, ListPlus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import FormSection from '../../components/ui/FormSection';
import { inr, date } from '../../lib/format';

export default function GRNView() {
  const { id } = useParams();
  const [grn, setGrn] = useState(null);
  useEffect(() => { api.get(`/grns/${id}`).then((r) => setGrn(r.data)); }, [id]);
  if (!grn) return <div className="text-sm text-slate-500">Loading…</div>;

  const total = grn.lines.reduce((sum, l) => sum + (l.rate ? Number(l.qtyAccepted) * Number(l.rate) : 0), 0);

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title={`GRN ${grn.number}`}
        subtitle={`${grn.party?.name || '—'} • ${date(grn.date)}`}
        action={<Link to="/grns" className="btn-secondary"><ArrowLeft className="h-4 w-4" /> Back</Link>}
      />

      <FormSection icon={PackageCheck} title="Receipt Details" description={`Received on ${date(grn.date)}`}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
          <div><div className="text-xs text-slate-500">Vendor</div><div className="font-semibold text-slate-800">{grn.party?.name || '—'}</div></div>
          <div><div className="text-xs text-slate-500">PO</div><div className="font-semibold text-slate-800">{grn.po?.number || '—'}</div></div>
          <div><div className="text-xs text-slate-500">Vehicle No</div><div className="font-semibold text-slate-800">{grn.vehicleNo || '—'}</div></div>
          <div><div className="mb-0.5 text-xs text-slate-500">Status</div><Badge status={grn.status}>{grn.status}</Badge></div>
        </div>
        {grn.notes && (
          <div className="mt-4 border-t border-slate-100 pt-3"><div className="text-xs text-slate-500">Notes</div><div className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{grn.notes}</div></div>
        )}
      </FormSection>

      <FormSection icon={ListPlus} title="Item Lines" description={`${grn.lines.length} line${grn.lines.length === 1 ? '' : 's'} received`}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Item</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Qty</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Accepted</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grn.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">{l.item?.name || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qtyAccepted)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qtyRejected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.rate ? inr(l.rate) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{l.rate ? inr(Number(l.qtyAccepted) * Number(l.rate)) : '—'}</td>
                  <td className="px-3 py-2">{l.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="ml-auto mt-4 max-w-sm rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
            <div className="flex justify-between font-bold"><span>Total (accepted)</span><span className="font-mono tabular-nums">{inr(total)}</span></div>
          </div>
        )}
      </FormSection>
    </div>
  );
}
