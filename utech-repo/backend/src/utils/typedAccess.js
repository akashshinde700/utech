'use strict';
const HttpError = require('./httpError');

// Parties and quotations each come in a customer and a vendor flavour with
// separate permission sets (customerParty.* / vendorParty.*,
// customerQuotation.* / vendorQuotation.*). Routes only check that the caller
// holds *one* of the pair; these helpers decide per record.

const can = (req, key) => req.user.role === 'SUPERADMIN' || (req.user.permissions || []).includes(key);

// Party types readable/writable for `action`. A BOTH party is visible with
// either read permission, but writing it needs both sides.
function partyTypesFor(req, action) {
  const c = can(req, `customerParty.${action}`);
  const v = can(req, `vendorParty.${action}`);
  if (action === 'read') {
    return [...(c ? ['CUSTOMER'] : []), ...(v ? ['VENDOR'] : []), ...(c || v ? ['BOTH'] : [])];
  }
  return [...(c ? ['CUSTOMER'] : []), ...(v ? ['VENDOR'] : []), ...(c && v ? ['BOTH'] : [])];
}

function assertPartyType(req, action, type) {
  if (partyTypesFor(req, action).includes(type)) return;
  const label = type === 'BOTH' ? 'customer + vendor' : type.toLowerCase();
  throw new HttpError(403, `You don't have permission to ${action} ${label} parties`);
}

function quotationTypesFor(req, action) {
  return [
    ...(can(req, `customerQuotation.${action}`) ? ['CUSTOMER'] : []),
    ...(can(req, `vendorQuotation.${action}`) ? ['VENDOR'] : []),
  ];
}

function assertQuotationType(req, action, type) {
  if (quotationTypesFor(req, action).includes(type)) return;
  throw new HttpError(403, `You don't have permission to ${action} ${type.toLowerCase()} quotations`);
}

module.exports = { can, partyTypesFor, assertPartyType, quotationTypesFor, assertQuotationType };
