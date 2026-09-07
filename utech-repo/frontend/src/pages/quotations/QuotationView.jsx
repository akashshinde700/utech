import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Printer, Pencil, ArrowLeft, Send, CheckCircle2, XCircle, FileText, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Badge from '../../components/ui/Badge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { inr, date } from '../../lib/format';
import { amountInWordsINR } from '../../lib/numberToWords';
import toast from 'react-hot-toast';

const COMPANY = {
  name: 'U-Tech Automation Industries',
  address: 'Gat no. 1403, Sonawane Wasti Rd, Chikhali, Pimpri-Chinchwad, Pune 411062',
  gstin: '', // set the company GSTIN here if available
};

export default function QuotationView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shouldAutoPrint = searchParams.get('print') === '1';
  const [printed, setPrinted] = useState(false);
  const [q, setQ] = useState(null);
  const [headerImageUrl, setHeaderImageUrl] = useState('');
  const [footerImageUrl, setFooterImageUrl] = useState('');
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    api.get(`/quotations/${id}`).then((r) => setQ(r.data));
  }, [id]);

  // data: URIs (not blob: object URLs) — blob: URLs are unreliable inside the
  // browser's print rendering pipeline (a separate process that often can't
  // resolve them), which was showing as a broken-image icon on print.
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // letterhead images people export from Canva/Photoshop often carry blank
  // white/transparent margin baked into the file itself, which shows up as a
  // dead gap above the "Quotation To" box — auto-trim it off client-side so
  // any uploaded image renders edge-to-edge regardless of its own padding.
  function trimImageWhitespace(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, w, h).data;
          const isBg = (x, y) => {
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            return a < 10 || (r > 248 && g > 248 && b > 248);
          };
          const rowIsBg = (y) => { for (let x = 0; x < w; x += 2) if (!isBg(x, y)) return false; return true; };
          const colIsBg = (x) => { for (let y = 0; y < h; y += 2) if (!isBg(x, y)) return false; return true; };
          let top = 0, bottom = h - 1, left = 0, right = w - 1;
          while (top < bottom && rowIsBg(top)) top++;
          while (bottom > top && rowIsBg(bottom)) bottom--;
          while (left < right && colIsBg(left)) left++;
          while (right > left && colIsBg(right)) right--;
          const pad = 6;
          top = Math.max(0, top - pad);
          bottom = Math.min(h - 1, bottom + pad);
          left = Math.max(0, left - pad);
          right = Math.min(w - 1, right + pad);
          const cw = right - left + 1, ch = bottom - top + 1;
          if (cw <= 0 || ch <= 0 || (cw === w && ch === h)) { resolve(dataUrl); return; }
          const out = document.createElement('canvas');
          out.width = cw; out.height = ch;
          out.getContext('2d').drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
          resolve(out.toDataURL('image/png'));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  useEffect(() => {
    if (!q?.headerImageStoredName) { setHeaderImageUrl(''); return; }
    let cancelled = false;
    api.get(`/quotation-templates/image/${q.headerImageStoredName}`, { responseType: 'blob' })
      .then((r) => blobToDataUrl(r.data))
      .then((dataUrl) => trimImageWhitespace(dataUrl))
      .then((dataUrl) => { if (!cancelled) setHeaderImageUrl(dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [q?.headerImageStoredName]);

  useEffect(() => {
    if (!q?.footerImageStoredName) { setFooterImageUrl(''); return; }
    let cancelled = false;
    api.get(`/quotation-templates/image/${q.footerImageStoredName}`, { responseType: 'blob' })
      .then((r) => blobToDataUrl(r.data))
      .then((dataUrl) => trimImageWhitespace(dataUrl))
      .then((dataUrl) => { if (!cancelled) setFooterImageUrl(dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [q?.footerImageStoredName]);

  useEffect(() => {
    if (!shouldAutoPrint || printed || !q) return;
    const waitingOnHeader = q.headerImageStoredName && !headerImageUrl;
    const waitingOnFooter = q.footerImageStoredName && !footerImageUrl;
    if (waitingOnHeader || waitingOnFooter) return;
    setPrinted(true);
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [shouldAutoPrint, printed, q, headerImageUrl, footerImageUrl]);

  async function updateStatus(newStatus) {
    try {
      await api.put(`/quotations/${id}`, { status: newStatus });
      toast.success(`Marked as ${newStatus}`);
      const r = await api.get(`/quotations/${id}`);
      setQ(r.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update the quotation status');
    }
  }

  async function doConvert() {
    setConverting(true);
    try {
      const { data: invoice } = await api.post(`/quotations/${id}/convert`);
      toast.success(`Invoice ${invoice.number} created`);
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to convert to invoice');
      setConverting(false);
      setConvertOpen(false);
    }
  }

  if (!q) return <div className="text-sm text-slate-500">Loading…</div>;

  const hasCustomHeader = headerImageUrl || q.headerText;

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title={`Quotation ${q.number}`}
          subtitle={`To ${q.party?.name} • ${date(q.date)}`}
          action={
            <div className="flex gap-2">
              <Link to="/quotations" className="btn-secondary"><ArrowLeft className="w-4 h-4" /> Back</Link>
              <Link to={`/quotations/${id}/edit`} className="btn-secondary"><Pencil className="w-4 h-4" /> Edit</Link>
              <button className="btn-primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</button>
              {q.status === 'DRAFT' && (
                <button className="btn-secondary" onClick={() => updateStatus('SENT')}><Send className="w-4 h-4" /> Mark as Sent</button>
              )}
              {q.status === 'SENT' && (
                <>
                  <button className="btn-success" onClick={() => updateStatus('APPROVED')}><CheckCircle2 className="w-4 h-4" /> Accept</button>
                  <button className="btn-danger" onClick={() => updateStatus('REJECTED')}><XCircle className="w-4 h-4" /> Reject</button>
                </>
              )}
              {q.status === 'APPROVED' && (
                <button className="btn-success" onClick={() => setConvertOpen(true)}><FileText className="w-4 h-4" /> Convert to Invoice</button>
              )}
            </div>
          }
        />
      </div>

      {/* on a narrow tablet the A4 sheet is wider than the screen — scroll it
          inside its own box instead of the whole page sliding */}
      <div className="overflow-x-auto print:overflow-visible">
      <div className="print-doc bg-white w-[210mm] max-w-none mx-auto print:w-auto">
        {/* letterhead — a full-bleed image repeats as a fixed running header on every printed page;
            plain text/company-name letterhead stays in normal flow (only appears once, at the top) */}
        <div className={`pd-letterhead ${headerImageUrl ? 'pd-letterhead-img' : ''}`}>
          {hasCustomHeader ? (
            <>
              {headerImageUrl && <img src={headerImageUrl} alt="Header" className="pd-header-img" />}
              {q.headerText && <div className="pd-header-text">{q.headerText}</div>}
            </>
          ) : (
            <div className="pd-company-block">
              <div className="pd-company-name">{COMPANY.name}</div>
              <div className="pd-company-address">{COMPANY.address}</div>
              {COMPANY.gstin && <div className="pd-company-address">GSTIN: {COMPANY.gstin}</div>}
            </div>
          )}
        </div>

        <div className="pd-content">
        {/* the header image's own "QUOTATION" ribbon already carries this label — showing our
            own title + status badge again would duplicate it, so skip this bar entirely when
            there's an image letterhead; keep it for the plain-text/company-name fallback */}
        {!headerImageUrl && (
          <div className="pd-title-bar">
            <div className="pd-title">QUOTATION</div>
            <div className="no-print"><Badge status={q.status === 'APPROVED' ? 'PAID' : q.status}>{q.status}</Badge></div>
          </div>
        )}

        {/* meta + party info */}
        <table className="pd-meta-table">
          <tbody>
            <tr>
              <td className="pd-meta-cell">
                <div className="pd-label">Quotation To</div>
                <div className="pd-party-name">{q.party?.name}</div>
                {q.party?.gstin && <div className="pd-line">GSTIN: {q.party.gstin}</div>}
                {q.party?.addressLine1 && <div className="pd-line">{q.party.addressLine1}</div>}
                {q.party?.addressLine2 && <div className="pd-line">{q.party.addressLine2}</div>}
                {(q.party?.city || q.party?.state) && <div className="pd-line">{[q.party?.city, q.party?.state, q.party?.pincode].filter(Boolean).join(', ')}</div>}
                {q.party?.phone && <div className="pd-line">Phone: {q.party.phone}</div>}
              </td>
              <td className="pd-meta-cell pd-meta-cell-right">
                <table className="pd-kv-table">
                  <tbody>
                    <tr><td className="pd-kv-label">Quotation No.</td><td className="pd-kv-value">{q.number}</td></tr>
                    <tr><td className="pd-kv-label">Date</td><td className="pd-kv-value">{date(q.date)}</td></tr>
                    {q.validTill && <tr><td className="pd-kv-label">Valid Until</td><td className="pd-kv-value">{date(q.validTill)}</td></tr>}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* items */}
        <table className="pd-items-table">
          <thead>
            <tr>
              <th className="pd-th pd-col-sr">Sr No</th>
              <th className="pd-th pd-col-desc">Part Name</th>
              <th className="pd-th pd-col-num">Drg No</th>
              <th className="pd-th pd-col-num">Reqrd. Qty</th>
              <th className="pd-th pd-col-num">Rate/each (₹)</th>
              <th className="pd-th pd-col-amt">Total Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {(q.lines || []).map((l, i) => (
              <tr key={l.id}>
                <td className="pd-td pd-col-sr">{i + 1}</td>
                <td className="pd-td pd-col-desc">{l.description}</td>
                <td className="pd-td pd-col-num">{l.drgNo || '—'}</td>
                <td className="pd-td pd-col-num">{Number(l.qty)}</td>
                <td className="pd-td pd-col-num">{Number(l.rate).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="pd-td pd-col-amt">{Number(l.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
            {/* pad a couple of blank rows for a filled-out formal look when few items */}
            {Array.from({ length: Math.max(0, 2 - (q.lines || []).length) }).map((_, i) => (
              <tr key={`blank-${i}`}><td className="pd-td">&nbsp;</td><td className="pd-td"></td><td className="pd-td"></td><td className="pd-td"></td><td className="pd-td"></td><td className="pd-td"></td></tr>
            ))}
          </tbody>
        </table>

        {/* totals */}
        <table className="pd-totals-table">
          <tbody>
            <tr>
              <td className="pd-totals-words">
                <div className="pd-label">Amount in Words</div>
                <div className="pd-words">{amountInWordsINR(q.total)}</div>
              </td>
              <td className="pd-totals-figures">
                <table className="pd-kv-table">
                  <tbody>
                    {Number(q.discount) > 0 && <tr><td className="pd-kv-label">Subtotal</td><td className="pd-kv-value">{inr(q.subtotal)}</td></tr>}
                    {Number(q.discount) > 0 && <tr><td className="pd-kv-label">Discount</td><td className="pd-kv-value">- {inr(q.discount)}</td></tr>}
                    <tr className="pd-total-row"><td className="pd-kv-label">Total</td><td className="pd-kv-value">{inr(q.total)}</td></tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {q.notes && (
          <div className="pd-notes">
            <div className="pd-label">Notes</div>
            <div className="pd-line">{q.notes}</div>
          </div>
        )}

        </div>

        {/* footer — full-bleed image repeats as a fixed running footer on every printed page */}
        {(footerImageUrl || q.footerText) && (
          <div className={`pd-footer ${footerImageUrl ? 'pd-footer-img-wrap' : ''}`}>
            {q.footerText && <div className="pd-footer-text">{q.footerText}</div>}
            {footerImageUrl && <img src={footerImageUrl} alt="Footer" className="pd-footer-img" />}
          </div>
        )}
      </div>
      </div>

      <ConfirmDialog
        open={convertOpen}
        onClose={() => { if (!converting) setConvertOpen(false); }}
        onConfirm={doConvert}
        title="Convert to invoice?"
        message={`A new invoice will be created from quotation ${q.number}.`}
        confirmLabel="Convert"
        loading={converting}
      />
      {converting && (
        <div className="no-print fixed bottom-4 left-1/2 z-[80] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Creating invoice…
          </div>
        </div>
      )}
    </div>
  );
}
