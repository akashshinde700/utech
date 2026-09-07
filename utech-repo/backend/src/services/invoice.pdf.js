'use strict';
// Invoice PDF (pdfkit). Single-origin, no external assets. Not a designed
// template, but carries what a GST tax invoice legally needs: both GSTINs,
// place of supply, taxable value, tax break-up, round-off, total in words.

const PDFDocument = require('pdfkit');
const { amountInWordsINR } = require('../utils/numberToWords');
const { stateCodeOf } = require('../utils/gst');

const COMPANY = {
  name: process.env.COMPANY_NAME || 'U-Tech Automation Industries',
  gstin: process.env.COMPANY_GSTIN || '',
  address:
    process.env.COMPANY_ADDRESS ||
    'Gat no. 1403, Sonawane Wasti Rd, Chikhali, Pimpri-Chinchwad, Pune 411062',
  state: process.env.COMPANY_STATE || 'Maharashtra',
  stateCode: (process.env.COMPANY_STATE_CODE || '27').trim(),
  bank: process.env.COMPANY_BANK || '',
};

function fmtINR(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const d = (x) => (x ? new Date(x).toLocaleDateString('en-IN') : '-');

function streamInvoicePdf(invoice, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
  doc.pipe(res);

  const L = 40;
  const R = 555;
  const party = invoice.party || {};
  const partyStateCode = stateCodeOf(party.gstin);
  const isIntra = Number(invoice.cgst) > 0 || (!Number(invoice.igst) && partyStateCode === COMPANY.stateCode);

  // ---- header --------------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(11).text(COMPANY.name, { align: 'center' });
  doc.font('Helvetica').fontSize(8.5).text(COMPANY.address, { align: 'center' });
  const idline = [
    COMPANY.gstin ? `GSTIN: ${COMPANY.gstin}` : null,
    `State: ${COMPANY.state} (${COMPANY.stateCode})`,
  ].filter(Boolean).join('    ');
  doc.text(idline, { align: 'center' });
  doc.moveDown(0.8);
  doc.moveTo(L, doc.y).lineTo(R, doc.y).stroke();
  doc.moveDown(0.6);

  // ---- meta + bill-to -----------------------------------------------------
  const top = doc.y;
  doc.font('Helvetica').fontSize(9);
  doc.text(`Invoice #: ${invoice.number}`, L, top);
  doc.text(`Invoice Date: ${d(invoice.date)}`, L, top + 13);
  doc.text(`Due Date: ${d(invoice.dueDate)}`, L, top + 26);
  doc.text(`Place of Supply: ${party.state || COMPANY.state}${partyStateCode ? ` (${partyStateCode})` : ''}`, L, top + 39);

  doc.font('Helvetica-Bold').fontSize(9).text('Bill To', 320, top);
  doc.font('Helvetica-Bold').fontSize(10).text(party.name || '-', 320, top + 12, { width: R - 320 });
  doc.font('Helvetica').fontSize(9);
  let by = doc.y;
  if (party.gstin) { doc.text(`GSTIN: ${party.gstin}`, 320, by, { width: R - 320 }); by = doc.y; }
  const addr = [party.addressLine1, party.addressLine2, [party.city, party.state, party.pincode].filter(Boolean).join(', ')]
    .filter(Boolean).join('\n');
  if (addr) { doc.text(addr, 320, by, { width: R - 320 }); }

  doc.moveDown(1.5);
  let y = Math.max(doc.y, top + 70);

  // ---- line items -------------------------------------------------------
  const cols = [
    { x: L,   w: 24,  label: '#',    align: 'left' },
    { x: 64,  w: 196, label: 'Description', align: 'left' },
    { x: 262, w: 44,  label: 'HSN',  align: 'left' },
    { x: 306, w: 44,  label: 'Qty',  align: 'right' },
    { x: 350, w: 60,  label: 'Rate', align: 'right' },
    { x: 410, w: 38,  label: 'GST%', align: 'right' },
    { x: 448, w: 107, label: 'Amount', align: 'right' },
  ];
  doc.font('Helvetica-Bold').fontSize(8.5);
  cols.forEach((c) => doc.text(c.label, c.x, y, { width: c.w, align: c.align }));
  y += 12;
  doc.moveTo(L, y).lineTo(R, y).stroke();
  y += 5;
  doc.font('Helvetica').fontSize(8.5);
  invoice.lines.forEach((l, i) => {
    const h = Math.max(
      doc.heightOfString(l.description || '-', { width: cols[1].w }),
      11
    );
    if (y + h > 720) { doc.addPage(); y = 50; }
    doc.text(String(i + 1), cols[0].x, y, { width: cols[0].w });
    doc.text(l.description || '-', cols[1].x, y, { width: cols[1].w });
    doc.text(l.hsnCode || '-', cols[2].x, y, { width: cols[2].w });
    doc.text(String(Number(l.qty)), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text(fmtINR(l.rate), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text(String(Number(l.gstRate)), cols[5].x, y, { width: cols[5].w, align: 'right' });
    doc.text(fmtINR(l.amount), cols[6].x, y, { width: cols[6].w, align: 'right' });
    y += h + 4;
  });
  doc.moveTo(L, y).lineTo(R, y).stroke();
  y += 8;

  // ---- totals ---------------------------------------------------------
  const lblX = 350, valX = 448, valW = 107;
  const row = (label, value, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9);
    doc.text(label, lblX, y, { width: valX - lblX - 6, align: 'right' });
    doc.text(value, valX, y, { width: valW, align: 'right' });
    y += bold ? 15 : 13;
  };
  row('Subtotal', fmtINR(invoice.subtotal));
  if (Number(invoice.discount) > 0) row('Discount', '- ' + fmtINR(invoice.discount));
  const taxable = Number(invoice.subtotal) - Number(invoice.discount || 0);
  if (Number(invoice.discount) > 0) row('Taxable Value', fmtINR(taxable));
  if (Number(invoice.cgst) > 0) { row('CGST', fmtINR(invoice.cgst)); row('SGST', fmtINR(invoice.sgst)); }
  if (Number(invoice.igst) > 0) row('IGST', fmtINR(invoice.igst));
  if (Number(invoice.roundOff) !== 0) {
    row('Round Off', (Number(invoice.roundOff) >= 0 ? '+ ' : '- ') + fmtINR(Math.abs(Number(invoice.roundOff))));
  }
  doc.moveTo(lblX, y).lineTo(R, y).stroke();
  y += 4;
  row('Grand Total', fmtINR(invoice.total), true);
  if (Number(invoice.amountPaid) > 0) {
    row('Paid', fmtINR(invoice.amountPaid));
    row('Balance Due', fmtINR(Number(invoice.total) - Number(invoice.amountPaid)));
  }
  y += 4;

  // ---- words + tax note ------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(8.5).text('Amount in words: ', L, y, { continued: true })
    .font('Helvetica').text(amountInWordsINR(invoice.total));
  y = doc.y + 3;
  doc.font('Helvetica-Oblique').fontSize(7.5)
    .text(`Tax charged on ${isIntra ? 'intra-state (CGST + SGST)' : 'inter-state (IGST)'} basis.`, L, y);
  y = doc.y + 8;

  if (COMPANY.bank) {
    doc.font('Helvetica-Bold').fontSize(8).text('Bank Details: ', L, y, { continued: true })
      .font('Helvetica').text(COMPANY.bank, { width: 300 });
    y = doc.y + 6;
  }
  if (invoice.termsText) {
    doc.font('Helvetica-Bold').fontSize(8).text('Terms & Conditions', L, y);
    doc.font('Helvetica').fontSize(7.5).text(invoice.termsText, L, doc.y + 2, { width: 320 });
  }

  // ---- signature ----------------------------------------------------
  doc.font('Helvetica').fontSize(9).text(`For ${COMPANY.name}`, 360, Math.max(doc.y + 24, y + 24), { width: 195, align: 'right' });
  doc.text('Authorised Signatory', 360, doc.y + 34, { width: 195, align: 'right' });

  doc.end();
}

module.exports = { streamInvoicePdf };
