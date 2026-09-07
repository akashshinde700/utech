'use strict';

// GST + line-amount helpers.
// All numbers are kept as plain JS numbers here; callers convert to Prisma Decimal as needed.

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function calcLineAmount(qty, rate) {
  return round2(Number(qty) * Number(rate));
}

// Compute the tax break-up for a set of lines.
//
//   lines        [{ qty, rate, gstRate }]
//   isIntraState true  -> CGST + SGST (half each);  false -> IGST
//   discount     a flat header discount (₹). Under GST a discount shown on the
//                invoice reduces the *taxable value*, so it is spread across the
//                lines in proportion to their amount and tax is charged on the
//                net — NOT deducted after tax.
//
// Returns { subtotal, discount, taxable, cgst, sgst, igst, tax, total }
//   subtotal = gross of all lines (before discount)
//   taxable  = subtotal - discount   (the value GST is actually charged on)
//   total    = taxable + tax         (before round-off — see roundInvoiceTotal)
function calcTaxes(lines, isIntraState = true, discount = 0) {
  let subtotal = 0;
  for (const l of lines) subtotal += calcLineAmount(l.qty, l.rate);
  subtotal = round2(subtotal);

  const disc = Math.min(round2(Number(discount) || 0), subtotal);
  // proportion of each line's value that survives the discount
  const keep = subtotal > 0 ? (subtotal - disc) / subtotal : 1;

  let totalGst = 0;
  for (const l of lines) {
    const net = calcLineAmount(l.qty, l.rate) * keep;
    totalGst += (net * Number(l.gstRate || 0)) / 100;
  }
  totalGst = round2(totalGst);

  const cgst = isIntraState ? round2(totalGst / 2) : 0;
  const sgst = isIntraState ? round2(totalGst - cgst) : 0; // absorbs the odd paisa
  const igst = isIntraState ? 0 : totalGst;
  const tax = round2(cgst + sgst + igst);
  const taxable = round2(subtotal - disc);
  const total = round2(taxable + tax);

  return { subtotal, discount: disc, taxable, cgst, sgst, igst, tax, total };
}

// Round a grand total to the nearest rupee (standard on Indian tax invoices).
// Returns { total: <rounded>, roundOff: <rounded - exact>, in [-0.5, 0.5] }.
function roundInvoiceTotal(exactTotal) {
  const exact = round2(exactTotal);
  const total = Math.round(exact);
  return { total, roundOff: round2(total - exact) };
}

// GSTIN state code (first 2 chars) — used to decide intra vs inter-state.
function stateCodeOf(gstin) {
  if (!gstin || typeof gstin !== 'string') return null;
  const m = gstin.trim().slice(0, 2);
  return /^\d{2}$/.test(m) ? m : null;
}

module.exports = { calcLineAmount, calcTaxes, round2, roundInvoiceTotal, stateCodeOf };
