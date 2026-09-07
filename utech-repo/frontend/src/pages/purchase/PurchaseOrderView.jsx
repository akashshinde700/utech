import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ShoppingCart, ListPlus, FileText, Plus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import FormSection from '../../components/ui/FormSection';
import { inr, date } from '../../lib/format';

export default function PurchaseOrderView() {
  const { id } = useParams();
  const [po, setPo] = useState(null);
  useEffect(() => { api.get(`/purchase-orders/${id}`).then((r) => setPo(r.data)); }, [id]);
  if (!po) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title={`PO ${po.number}`} subtitle={`${po.party?.name ?? '—'} • ${date(po.date)}`}
        action={<Link to={`/grns/new?poId=${po.id}`} className="btn-primary"><Plus className="h-4 w-4" /> Create GRN</Link>} />

      <FormSection icon={ShoppingCart} title="PO Details" description={`Raised on ${date(po.date)} — current status shown below`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">Vendor</div>
            <div className="font-semibold">{po.party?.name ?? '—'}</div>
          </div>
          <Badge status={po.status}>{po.status}</Badge>
        </div>
      </FormSection>

      <FormSection icon={ListPlus} title="Item Lines" description={`${(po.lines || []).length} line${(po.lines || []).length === 1 ? '' : 's'} ordered`}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Item</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Ordered</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Received</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Rate</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(po.lines || []).map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">{l.item?.name}</td>
                  <td className="px-3 py-2">{l.description || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(l.qtyReceived)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(l.rate)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{inr(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-4 max-w-sm rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="font-mono tabular-nums">{inr(po.subtotal)}</span></div>
          <div className="flex justify-between"><span>GST</span><span className="font-mono tabular-nums">{inr(po.gstTotal)}</span></div>
          <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span className="font-mono tabular-nums">{inr(po.total)}</span></div>
        </div>
      </FormSection>

      {po.grns && po.grns.length > 0 && (
        <FormSection icon={FileText} title="Goods Receipts" description={`${po.grns.length} GRN${po.grns.length === 1 ? '' : 's'} booked against this order`}>
          <ul className="text-sm space-y-1">
            {po.grns.map((g) => <li key={g.id}>{g.number} — {date(g.date)} — {g.status}</li>)}
          </ul>
        </FormSection>
      )}
    </div>
  );
}
