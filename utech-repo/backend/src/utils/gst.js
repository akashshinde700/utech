'use strict';

const Decimal = require('decimal.js');
// Use decimal arithmetic, not binary floats, for products and GST. The 40-digit
// precision also covers products of the schema's DECIMAL(14,3)/(14,2) inputs.
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const dec = (n) => new Money(n == null ? 0 : n);
const paise = (n) => dec(n).toDecimalPlaces(2);

function round2(n) {
  return paise(n).toNumber();
}

function calcLineAmount(qty, rate) {
  // Preserve the helper's existing invalid-input contract; request validators
  // reject such values before they can be written to financial records.
  if (!Number.isFinite(Number(qty)) || !Number.isFinite(Number(rate))) return NaN;
  return dec(qty).times(dec(rate)).toDecimalPlaces(2).toNumber();
}

// Discount is a flat amount allocated proportionally across line values BEFORE
// tax. Round each line to paise, then round the combined GST once, matching
// the existing invoice policy. CGST receives an odd paisa when GST is odd.
function calcTaxes(lines, isIntraState = true, discount = 0) {
  const amounts = lines.map((l) => dec(l.qty).times(dec(l.rate)).toDecimalPlaces(2));
  const subtotal = amounts.reduce((sum, amount) => sum.plus(amount), dec(0));
  const disc = Money.min(paise(discount || 0), subtotal);
  const keep = subtotal.gt(0) ? subtotal.minus(disc).div(subtotal) : dec(1);
  const gst = amounts.reduce((sum, amount, i) =>
    sum.plus(amount.times(keep).times(dec(lines[i].gstRate || 0)).div(100)), dec(0)).toDecimalPlaces(2);
  const cgst = isIntraState ? gst.div(2).toDecimalPlaces(2) : dec(0);
  const sgst = isIntraState ? gst.minus(cgst) : dec(0);
  const igst = isIntraState ? dec(0) : gst;
  const taxable = subtotal.minus(disc);
  const total = taxable.plus(gst);

  return {
    subtotal: subtotal.toNumber(), discount: disc.toNumber(), taxable: taxable.toNumber(),
    cgst: cgst.toNumber(), sgst: sgst.toNumber(), igst: igst.toNumber(),
    tax: gst.toNumber(), total: total.toNumber(),
  };
}

// Round a grand total to the nearest rupee; keep the exact paise difference.
function roundInvoiceTotal(exactTotal) {
  const exact = paise(exactTotal);
  const total = exact.toDecimalPlaces(0);
  return { total: total.toNumber(), roundOff: total.minus(exact).toDecimalPlaces(2).toNumber() };
}

function stateCodeOf(gstin) {
  if (!gstin || typeof gstin !== 'string') return null;
  const m = gstin.trim().slice(0, 2);
  return /^\d{2}$/.test(m) ? m : null;
}

module.exports = { calcLineAmount, calcTaxes, round2, roundInvoiceTotal, stateCodeOf };
