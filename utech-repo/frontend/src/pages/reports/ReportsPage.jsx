import { useState } from 'react';
import { FileSpreadsheet, FileCode2, Download, Loader2 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { styles } from '../../lib/formStyles';
import { downloadFile } from '../../lib/download';
import toast from 'react-hot-toast';

const REPORTS = [
  { key: 'invoices', name: 'Invoices', desc: 'All invoices with GST breakup', endpoint: '/reports/invoices.xlsx', file: 'invoices.xlsx' },
  { key: 'jobcards', name: 'Jobcards', desc: 'Production jobcards summary', endpoint: '/reports/jobcards.xlsx', file: 'jobcards.xlsx' },
  { key: 'items', name: 'Items', desc: 'Item master with stock + pricing', endpoint: '/reports/items.xlsx', file: 'items.xlsx' },
  { key: 'expenses', name: 'Expenses', desc: 'Operational expenses by date/category', endpoint: '/reports/expenses.xlsx', file: 'expenses.xlsx' },
  { key: 'customer-stock', name: 'Customer Stock', desc: 'Customer-owned material lots and status', endpoint: '/reports/customer-stock.xlsx', file: 'customer-stock.xlsx' },
  { key: 'vendor-stock', name: 'Vendor Stock', desc: 'Material currently outstanding at vendors', endpoint: '/reports/vendor-stock.xlsx', file: 'vendor-stock.xlsx' },
  { key: 'stock-ledger', name: 'Stock Ledger', desc: 'Every stock movement, company + customer', endpoint: '/reports/stock-ledger.xlsx', file: 'stock-ledger.xlsx' },
];

// Tally accepts XML masters/vouchers — these are the same endpoints the Tally
// connector uses, surfaced here so the export is reachable without a script.
const TALLY_EXPORTS = [
  { key: 'tally-parties', name: 'Ledgers (Parties)', desc: 'Customers and vendors as Tally ledgers', endpoint: '/tally/export/masters?type=parties', file: 'tally-ledgers.xml' },
  { key: 'tally-items', name: 'Stock Items', desc: 'Active items with UOM and GST details', endpoint: '/tally/export/masters?type=items', file: 'tally-stock-items.xml' },
  { key: 'tally-vouchers', name: 'Sales Vouchers', desc: 'Issued, paid and partially paid invoices', endpoint: '/tally/export/vouchers?type=invoices', file: 'tally-sales-vouchers.xml' },
];

function ReportCard({ report, busy, downloading, onDownload, icon: Icon, tone }) {
  const active = downloading === report.key;
  return (
    <div className="card flex flex-col p-5">
      <div className="flex flex-1 items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-600'}`} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-800">{report.name}</div>
          <div className="mt-0.5 text-xs text-slate-500">{report.desc}</div>
        </div>
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <button
          type="button"
          className={`${styles.secondaryBtn} !h-9 w-full !py-1.5 sm:w-auto`}
          onClick={() => onDownload(report)}
          disabled={busy}
          aria-busy={active}
          aria-label={`Download ${report.name}${tone === 'amber' ? ' for Tally' : ' report'}${report.file.endsWith('.xlsx') ? ' as XLSX' : ' as XML'}`}
        >
          {active ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Preparing…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" aria-hidden="true" /> {report.file.endsWith('.xlsx') ? 'Download .xlsx' : 'Download .xml'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  // key of the report currently downloading (null when idle) — the active
  // button shows a spinner and every button is disabled so downloads queue up
  // one at a time instead of racing
  const [downloading, setDownloading] = useState(null);

  async function handleDownload(report) {
    if (downloading) return;
    setDownloading(report.key);
    try {
      await downloadFile(report.endpoint, report.file);
      toast.success(`${report.name} downloaded`);
    } catch (err) {
      // 401/403 already surfaced by the axios interceptor; anything else gets
      // a readable message instead of a silent no-op
      if (!err.response?.status) toast.error('Download failed — check your connection');
      else if (err.response.status !== 401 && err.response.status !== 403) {
        toast.error(err.response?.data?.message || 'Download failed — check permissions');
      }
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="animate-fade-in space-y-8">
      <div>
        <PageHeader title="Reports & Exports" subtitle="Download data as XLSX" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {REPORTS.map((r) => (
            <ReportCard
              key={r.key}
              report={r}
              icon={FileSpreadsheet}
              busy={downloading != null}
              downloading={downloading}
              onDownload={handleDownload}
            />
          ))}
        </div>
      </div>

      <div>
        <PageHeader title="Tally Export" subtitle="Download XML files to import into Tally (ERP 9 / Prime)" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {TALLY_EXPORTS.map((r) => (
            <ReportCard
              key={r.key}
              report={r}
              icon={FileCode2}
              tone="amber"
              busy={downloading != null}
              downloading={downloading}
              onDownload={handleDownload}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          XML exports use the Tally Prime 2.1 format. Connect a Tally server on your LAN to push data directly.
        </p>
      </div>
    </div>
  );
}
