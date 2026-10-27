import Decimal from 'decimal.js';

// Same decimal precision and ROUND_HALF_UP policy as backend/src/utils/gst.js.
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
// Inputs are strings while being edited; an empty numeric field previews as 0.
const dec = (n) => new Money(n === '' || n == null ? 0 : n);
const paise = (n) => dec(n).toDecimalPlaces(2);

export function calculateInvoiceLineAmount(qty, rate) {
  return dec(qty).times(dec(rate)).toDecimalPlaces(2).toNumber();
}

export function calculateInvoiceTotals(lines, isIntraState, discount = 0) {
  const amounts = lines.map((line) => dec(line.qty).times(dec(line.rate)).toDecimalPlaces(2));
  const subtotal = amounts.reduce((sum, amount) => sum.plus(amount), dec(0));
  const appliedDiscount = Money.min(paise(discount || 0), subtotal);
  const keep = subtotal.gt(0) ? subtotal.minus(appliedDiscount).div(subtotal) : dec(1);
  const gst = amounts.reduce((sum, amount, index) =>
    sum.plus(amount.times(keep).times(dec(lines[index].gstRate || 0)).div(100)), dec(0)).toDecimalPlaces(2);
  const cgst = isIntraState ? gst.div(2).toDecimalPlaces(2) : dec(0);
  const sgst = isIntraState ? gst.minus(cgst) : dec(0);
  const igst = isIntraState ? dec(0) : gst;
  const taxable = subtotal.minus(appliedDiscount);
  const exact = taxable.plus(gst);
  const total = exact.toDecimalPlaces(0);
  return {
    subtotal: subtotal.toNumber(), discount: appliedDiscount.toNumber(), taxable: taxable.toNumber(),
    cgst: cgst.toNumber(), sgst: sgst.toNumber(), igst: igst.toNumber(),
    roundOff: total.minus(exact).toDecimalPlaces(2).toNumber(), total: total.toNumber(),
  };
}
