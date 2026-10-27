import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import Badge from '../../components/ui/Badge';
import { styles } from '../../lib/formStyles';
import { date } from '../../lib/format';

// QC-02 — the printable inspection certificate. Same A4 sheet the quotation
// prints on (print-doc / pd-* in styles.css), so both documents come out of
// the printer identically framed.
const COMPANY = {
  name: 'U-Tech Automation Industries',
  address: 'Gat no. 1403, Sonawane Wasti Rd, Chikhali, Pimpri-Chinchwad, Pune 411062',
  gstin: '',
};

const REF_LABEL = { JOBCARD: 'Project / Job Card', GRN: 'Goods Receipt', DISPATCH: 'Dispatch' };

export default function QualityCertificate() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [qc, setQc] = useState(null);
  const [ref, setRef] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/quality/${id}`)
      .then(async (r) => {
        if (cancelled) return;
        setQc(r.data);
        // the inspected document, for a human-readable reference line
        const url = r.data.refType === 'JOBCARD' ? `/jobcards/${r.data.refId}`
          : r.data.refType === 'GRN' ? `/grns/${r.data.refId}`
            : r.data.refType === 'DISPATCH' ? `/dispatch/${r.data.refId}` : null;
        if (!url) return;
        try {
          const d = await api.get(url);
          if (!cancelled) setRef(d.data);
        } catch { /* reference is optional on the certificate */ }
      })
      .catch(() => !cancelled && setError('Could not load this inspection'));
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-danger-600">{error}</p>
        <button type="button" className={`${styles.secondaryBtn} mt-3`} onClick={() => navigate('/quality')}>Back to inspections</button>
      </div>
    );
  }
  if (!qc) {
    return <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  const lines = qc.lines || [];
  const refNumber = ref?.number || `#${qc.refId}`;

  return (
    <div className="animate-fade-in">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/quality')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <Badge status={qc.result === 'PASS' ? 'PAID' : qc.result === 'FAIL' ? 'OVERDUE' : 'DRAFT'}>{qc.result}</Badge>
          <button type="button" className={styles.primaryBtn} onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {qc.result !== 'PASS' && (
        <div className="no-print mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This inspection is <span className="font-semibold">{qc.result}</span>. A certificate is normally issued only after it passes.
        </div>
      )}

      <div className="overflow-x-auto print:overflow-visible">
        <div className="print-doc bg-white w-[210mm] max-w-none mx-auto print:w-auto">
          <div className="pd-letterhead">
            <div className="pd-company-block">
              <div className="pd-company-name">{COMPANY.name}</div>
              <div className="pd-company-address">{COMPANY.address}</div>
              {COMPANY.gstin && <div className="pd-company-address">GSTIN: {COMPANY.gstin}</div>}
            </div>
          </div>

          <div className="pd-content">
            <div className="pd-title-bar">
              <div className="pd-title">INSPECTION CERTIFICATE</div>
            </div>

            <table className="pd-meta-table">
              <tbody>
                <tr>
                  <td className="pd-meta-cell">
                    <div className="pd-label">Inspected document</div>
                    <div className="pd-party-name">{REF_LABEL[qc.refType] || qc.refType} {refNumber}</div>
                    {ref?.party?.name && <div className="pd-line">{ref.party.name}</div>}
                    {ref?.itemDescription && <div className="pd-line">{ref.itemDescription}</div>}
                    {ref?.drawingNumber && <div className="pd-line">Drawing: {ref.drawingNumber}</div>}
                  </td>
                  <td className="pd-meta-cell pd-meta-cell-right">
                    <table className="pd-kv-table">
                      <tbody>
                        <tr><td className="pd-kv-label">Certificate No.</td><td className="pd-kv-value">{qc.certificateNo || qc.number}</td></tr>
                        <tr><td className="pd-kv-label">Inspection No.</td><td className="pd-kv-value">{qc.number}</td></tr>
                        <tr><td className="pd-kv-label">Date</td><td className="pd-kv-value">{date(qc.date)}</td></tr>
                        <tr><td className="pd-kv-label">Inspector</td><td className="pd-kv-value">{qc.inspectorName || '—'}</td></tr>
                        <tr className="pd-total-row"><td className="pd-kv-label">Result</td><td className="pd-kv-value">{qc.result}</td></tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="pd-items-table">
              <thead>
                <tr>
                  <th className="pd-th pd-col-sr">Sr</th>
                  <th className="pd-th pd-col-desc">Parameter</th>
                  <th className="pd-th pd-col-desc">Specified</th>
                  <th className="pd-th pd-col-desc">Observed</th>
                  <th className="pd-th pd-col-num">Result</th>
                </tr>
              </thead>
              <tbody>
                {lines.length ? lines.map((l, i) => (
                  <tr key={l.id || i}>
                    <td className="pd-td pd-col-sr">{i + 1}</td>
                    <td className="pd-td pd-col-desc">{l.parameter}{l.notes ? <div className="pd-line text-[11px] text-slate-500">{l.notes}</div> : null}</td>
                    <td className="pd-td pd-col-desc">{l.expected || '—'}</td>
                    <td className="pd-td pd-col-desc">{l.actual || '—'}</td>
                    <td className="pd-td pd-col-num">{l.result}</td>
                  </tr>
                )) : (
                  <tr><td className="pd-td pd-col-desc" colSpan={5}>No parameters were recorded for this inspection.</td></tr>
                )}
              </tbody>
            </table>

            {qc.remarks && (
              <div className="mt-3">
                <div className="pd-label">Remarks</div>
                <div className="pd-line whitespace-pre-line">{qc.remarks}</div>
              </div>
            )}

            <div className="mt-4 pd-line">
              This is to certify that the material/work described above has been inspected and found{' '}
              <span className="font-semibold">{qc.result === 'PASS' ? 'ACCEPTABLE' : qc.result}</span>{' '}
              against the parameters listed.
            </div>

            <table className="pd-sign-table w-full mt-10">
              <tbody>
                <tr>
                  <td className="w-1/2 align-bottom">
                    <div className="border-t border-slate-800 pt-1 pd-line">Inspected by{qc.inspectorName ? ` — ${qc.inspectorName}` : ''}</div>
                  </td>
                  <td className="w-1/2 align-bottom text-right">
                    <div className="border-t border-slate-800 pt-1 pd-line">For {COMPANY.name}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
