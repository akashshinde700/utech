'use strict';
const HttpError = require('./httpError');

// Shared sanity check for line-item payloads on the routes that do not have a
// Zod schema (sales return / purchase return). Without it a missing or
// malformed `lines` field surfaces as "lines is not iterable" → 500, and
// non-positive quantities slip into the tax engine and the stock ledger.
//
// `qtyByKey` names the quantity field (qty / qtySent / qtyOrdered).
function assertLines(lines, { qtyByKey = 'qty', requireKey = null, requireKeyLabel = '' } = {}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(400, 'Add at least one line (lines must be a non-empty array)');
  }
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line || typeof line !== 'object') throw new HttpError(400, `Line ${n} is invalid`);
    if (requireKey && !line[requireKey]) {
      throw new HttpError(400, `Line ${n}: ${requireKeyLabel || requireKey} is required`);
    }
    if (!(Number(line[qtyByKey]) > 0)) {
      throw new HttpError(400, `Line ${n}: quantity must be greater than 0`);
    }
    if (line.rate !== undefined && line.rate !== null && !(Number(line.rate) >= 0)) {
      throw new HttpError(400, `Line ${n}: rate must be 0 or more`);
    }
  });
  return lines;
}

module.exports = { assertLines };
