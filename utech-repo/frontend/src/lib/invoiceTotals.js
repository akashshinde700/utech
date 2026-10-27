// Matches backend/src/utils/gst.js: line amounts are rounded to paise BEFORE
// discount allocation and tax. Keep this separate so the on-screen preview can
// be checked against the server for fractional quantities and mixed GST rates.
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function calculateInvoiceTotals(lines, isIntraState, discount = 0) {
  const amounts = lines.map((line) => round2(Number(line.qty || 0) * Number(line.rate || 0)));
  const subtotal = round2(amounts.reduce((sum, amount) => sum + amount, 0));
  const appliedDiscount = Math.min(round2(Number(discount) || 0), subtotal);
  const keep = subtotal > 0 ? (subtotal - appliedDiscount) / subtotal : 1;
  const gst = round2(lines.reduce((sum, line, index) =>
    sum + (amounts[index] * keep * Number(line.gstRate || 0)) / 100, 0));
  const cgst = isIntraState ? round2(gst / 2) : 0;
  const sgst = isIntraState ? round2(gst - cgst) : 0;
  const igst = isIntraState ? 0 : gst;
  const taxable = round2(subtotal - appliedDiscount);
  const exact = round2(taxable + cgst + sgst + igst);
  const total = Math.round(exact);
  return { subtotal, discount: appliedDiscount, taxable, cgst, sgst, igst, roundOff: round2(total - exact), total };
}
