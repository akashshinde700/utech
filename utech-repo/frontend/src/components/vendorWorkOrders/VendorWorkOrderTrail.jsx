import { Link } from 'react-router-dom';
import { Factory, AlertTriangle } from 'lucide-react';
import Badge from '../ui/Badge';
import { date as fmtDate, VWO_STATUS_LABELS, isVwoOverdue } from '../../lib/format';

// Answers, for any scope that left the company: who did we give it to, when did
// it go out, when is it due back, did it come back, and what is the commercial
// document behind it. Rendered from the `vendorWorkOrders` relation that both
// the assignment and the vendor work order APIs already return, so it drops into
// any detail view without another request.
export default function VendorWorkOrderTrail({ workOrders, emptyHint }) {
  if (!workOrders || !workOrders.length) {
    return emptyHint ? <div className="text-xs text-slate-400">{emptyHint}</div> : null;
  }

  return (
    <div className="space-y-2">
      {workOrders.map((v) => {
        const overdue = isVwoOverdue(v);
        return (
          <div
            key={v.id}
            className={`rounded-lg border p-3 ${overdue ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-slate-50/70'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <Factory className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                  <span className="truncate">{v.party?.name || 'Vendor'}</span>
                </div>
                <Link
                  to={`/vendor-work-orders/${v.id}`}
                  className="text-xs text-brand-600 hover:underline font-medium"
                >
                  {v.number}
                </Link>
              </div>
              <Badge status={v.status}>{VWO_STATUS_LABELS[v.status] || v.status}</Badge>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
              <div>
                <div className="text-slate-400">Sent out</div>
                <div className="font-medium text-slate-700">{fmtDate(v.sentDate)}</div>
              </div>
              <div>
                <div className="text-slate-400">Due back</div>
                <div className={`font-medium ${overdue ? 'text-red-600' : 'text-slate-700'}`}>
                  {fmtDate(v.expectedReturnDate)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Returned</div>
                <div className="font-medium text-slate-700">{fmtDate(v.actualReturnDate)}</div>
              </div>
            </div>

            {overdue && (
              <div className="flex items-center gap-1 mt-2 text-[11px] font-medium text-red-600">
                <AlertTriangle className="w-3 h-3" /> Overdue at vendor
              </div>
            )}

            {v.po && (
              <div className="mt-2 pt-2 border-t border-slate-200/70 text-[11px] text-slate-500">
                Purchase order{' '}
                <Link to={`/purchase-orders/${v.po.id}`} className="text-brand-600 hover:underline font-medium">
                  {v.po.number}
                </Link>{' '}
                <span className="text-slate-400">({v.po.status})</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
