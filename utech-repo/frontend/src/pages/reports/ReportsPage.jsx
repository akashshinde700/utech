import { useState } from 'react';
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { styles } from '../../lib/formStyles';
import toast from 'react-hot-toast';

const REPORTS = [
  { name: 'Invoices', desc: 'All invoices with GST breakup', endpoint: '/api/reports/invoices.xlsx' },
  { name: 'Jobcards', desc: 'Production jobcards summary', endpoint: '/api/reports/jobcards.xlsx' },
  { name: 'Items', desc: 'Item master with stock + pricing', endpoint: '/api/reports/items.xlsx' },
  { name: 'Expenses', desc: 'Operational expenses by date/category', endpoint: '/api/reports/expenses.xlsx' },
  { name: 'Customer Stock', desc: 'Customer-owned material lots and status', endpoint: '/api/reports/customer-stock.xlsx' },
  { name: 'Vendor Stock', desc: 'Material currently outstanding at vendors', endpoint: '/api/reports/vendor-stock.xlsx' },
  { name: 'Stock Ledger', desc: 'Every stock movement, company + customer', endpoint: '/api/reports/stock-ledger.xlsx' },
];

async function download(report) {
  try {
    const token = localStorage.getItem('utech.token');
    const res = await fetch(report.endpoint, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.name.toLowerCase()}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${report.name} downloaded`);
  } catch {
    toast.error('Download failed — check permissions');
  }
}

export default function ReportsPage() {
  // name of the report currently downloading (null when idle) — the active
  // button shows a spinner and every button is disabled so downloads queue up
  // one at a time instead of racing
  const [downloading, setDownloading] = useState(null);

  async function handleDownload(report) {
    setDownloading(report.name);
    try {
      await download(report);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Reports & Exports" subtitle="Download data as XLSX" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <div key={r.name} className="card p-5 flex flex-col">
            <div className="flex items-start gap-3 flex-1">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600" aria-hidden="true">
                <FileSpreadsheet className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800">{r.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{r.desc}</div>
              </div>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <button
                type="button"
                className={`${styles.secondaryBtn} !py-1.5 !h-9 w-full sm:w-auto`}
                onClick={() => handleDownload(r)}
                disabled={downloading != null}
                aria-busy={downloading === r.name}
                aria-label={`Download ${r.name} report as XLSX`}
              >
                {downloading === r.name ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Preparing…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" aria-hidden="true" /> Download .xlsx
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
