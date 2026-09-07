'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { audit } = require('../utils/audit');
const env = require('../config/env');
const dayjs = require('dayjs');

/**
 * TALLY EXPORT - MULTI-VERSION SUPPORT
 * 
 * Supports multiple Tally versions with different XML formats:
 * - Tally.ERP 9 (Legacy)
 * - Tally Prime 2.0+
 * - Tally Prime 2.1+
 * 
 * XML format varies by version. Use version parameter to select format.
 * Default version: 'prime2.1'
 */

const TALLY_VERSIONS = {
  'erp9': {
    name: 'Tally.ERP 9',
    namespace: 'UDF',
    ledgerParent: { CUSTOMER: 'Sundry Debtors', VENDOR: 'Sundry Creditors' },
  },
  'prime2.0': {
    name: 'Tally Prime 2.0',
    namespace: 'TALLY',
    ledgerParent: { CUSTOMER: 'Sundry Debtors', VENDOR: 'Sundry Creditors' },
  },
  'prime2.1': {
    name: 'Tally Prime 2.1',
    namespace: 'TALLY',
    ledgerParent: { CUSTOMER: 'Sundry Debtors', VENDOR: 'Sundry Creditors' },
  },
};

function getTallyConfig(version = 'prime2.1') {
  return TALLY_VERSIONS[version] || TALLY_VERSIONS['prime2.1'];
}

// Tally XML is consumed by a parser that treats everything literally — party
// names like "A <B> & Sons" would otherwise break the envelope (or inject
// elements). Escape every piece of user text before interpolation.
function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// syncToTally POSTs whatever it is given to an endpoint — without a guard that
// is a textbook SSRF (internal network probing / credential exfiltration).
// Only http(s) URLs on the private LAN (or the configured Tally server) pass.
function isPrivateLanHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function assertAllowedTallyEndpoint(endpoint) {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (_) {
    throw new HttpError(400, 'Invalid Tally endpoint URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Tally endpoint must use http or https');
  }
  const envHost = env.TALLY_ENDPOINT ? new URL(env.TALLY_ENDPOINT).hostname : null;
  if (!isPrivateLanHost(parsed.hostname) && parsed.hostname !== envHost) {
    throw new HttpError(400, 'Tally sync is restricted to the local network or the configured Tally server');
  }
}

function generateLedgerXml(party, config) {
  const parent = config.ledgerParent[party.type] || 'Sundry Debtors';
  return `
    <LEDGER>
      <NAME>${xmlEscape(party.code)}</NAME>
      <PARENT>${xmlEscape(parent)}</PARENT>
      <ADDRESS>${xmlEscape(party.addressLine1)}</ADDRESS>
      <COUNTRY>${xmlEscape(party.country || 'India')}</COUNTRY>
      ${party.gstin ? `<GSTIN>${xmlEscape(party.gstin)}</GSTIN>` : ''}
      ${party.pan ? `<PANNUMBER>${xmlEscape(party.pan)}</PANNUMBER>` : ''}
      <PINCODE>${xmlEscape(party.pincode)}</PINCODE>
      <STATE>${xmlEscape(party.state)}</STATE>
    </LEDGER>`;
}

function generateStockItemXml(item, config) {
  return `
    <STOCKITEM>
      <NAME>${xmlEscape(item.code)}</NAME>
      <PARENT>Stock Items</PARENT>
      <BASEUNITS>${xmlEscape(item.uom?.code || 'Nos')}</BASEUNITS>
      ${item.hsnCode ? `<HSNCODE>${xmlEscape(item.hsnCode)}</HSNCODE>` : ''}
      <GSTAPPLICABILITY>${Number(item.gstRate) > 0 ? 'Yes' : 'No'}</GSTAPPLICABILITY>
      <GSTRATE>${Number(item.gstRate || 0)}</GSTRATE>
      <RATE>${Number(item.saleRate || 0)}</RATE>
    </STOCKITEM>`;
}

function generateVoucherXml(invoice, config) {
  const lines = invoice.lines.map(line => `
        <ALLINVENTORYENTRIES>
          <STOCKITEMNAME>${xmlEscape(line.item?.code)}</STOCKITEMNAME>
          <RATE>${Number(line.rate || 0)}</RATE>
          <QUANTITY>${Number(line.qty || 0)}</QUANTITY>
          <AMOUNT>${Number(line.amount || 0)}</AMOUNT>
        </ALLINVENTORYENTRIES>`).join('');

  return `
  <VOUCHER>
    <DATE>${dayjs(invoice.date).format('YYYY-MM-DD')}</DATE>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <PARTYLEDGERNAME>${xmlEscape(invoice.party?.code)}</PARTYLEDGERNAME>
    <NARRATION>${xmlEscape(invoice.notes)}</NARRATION>
    <ALLINVENTORYENTRIES.LIST>${lines}
    </ALLINVENTORYENTRIES.LIST>
    <LEDGERENTRIES.LIST>
      <LEDGERENTRIES>
        <LEDGERNAME>${xmlEscape(invoice.party?.code)}</LEDGERNAME>
        <ISDEBIT>No</ISDEBIT>
        <AMOUNT>${Number(invoice.total || 0)}</AMOUNT>
      </LEDGERENTRIES>
    </LEDGERENTRIES.LIST>
  </VOUCHER>`;
}

async function exportMasters(req, res) {
  const { type, version = 'prime2.1' } = req.query;
  const config = getTallyConfig(version);
  
  let data = [];
  let xml = '';
  
  if (type === 'parties') {
    data = await prisma.party.findMany({
      where: { isActive: true },
    });
    xml = data.map(party => generateLedgerXml(party, config)).join('\n');
  } else if (type === 'items') {
    data = await prisma.item.findMany({
      where: { isActive: true },
      include: { uom: { select: { code: true } } },
    });
    xml = data.map(item => generateStockItemXml(item, config)).join('\n');
  } else {
    throw new HttpError(400, 'Invalid type. Use: parties, items');
  }

  const fullXml = `<TALLYMESSAGE xmlns="${config.namespace}">${xml}</TALLYMESSAGE>`;

  await audit(req, 'tallyExport', type, null, { count: data.length, version });
  
  res.set('Content-Type', 'application/xml');
  res.send(fullXml);
}

async function exportVouchers(req, res) {
  const { type, from, to, version = 'prime2.1' } = req.query;
  const config = getTallyConfig(version);
  
  let data = [];
  let xml = '';
  
  if (type === 'invoices') {
    data = await prisma.invoice.findMany({
      where: {
        date: from || to ? {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        } : undefined,
        status: { in: ['ISSUED', 'PAID', 'PARTIALLY_PAID'] },
      },
      include: {
        party: { select: { code: true, name: true, gstin: true } },
        lines: { include: { item: { select: { code: true, name: true, hsnCode: true, gstRate: true } } } },
      },
    });
    xml = data.map(invoice => generateVoucherXml(invoice, config)).join('\n');
  } else {
    throw new HttpError(400, 'Invalid type. Use: invoices');
  }

  const fullXml = `<TALLYMESSAGE xmlns="${config.namespace}">${xml}</TALLYMESSAGE>`;

  await audit(req, 'tallyExport', type, null, { count: data.length, from, to, version });
  
  res.set('Content-Type', 'application/xml');
  res.send(fullXml);
}

async function syncToTally(req, res) {
  const { endpoint, data, version = 'prime2.1' } = req.body;

  // Tally accepts XML via HTTP at default port 9000 — but never POST to an
  // arbitrary user-supplied URL: allow only private-LAN http(s) hosts or the
  // configured Tally server (SSRF guard)
  const axios = require('axios');

  try {
    const config = getTallyConfig(version);
    const tallyEndpoint = endpoint || env.TALLY_ENDPOINT;
    assertAllowedTallyEndpoint(tallyEndpoint);

    const response = await axios.post(tallyEndpoint, data, {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 30000,
    });
    
    await audit(req, 'tallySync', 'Manual', null, { endpoint: tallyEndpoint, version, success: true });
    
    res.json({
      success: true,
      message: 'Data synced to Tally',
      version: config.name,
      endpoint: tallyEndpoint,
      tallyResponse: response.data,
    });
  } catch (error) {
    await audit(req, 'tallySync', 'Manual', null, { endpoint, version, success: false, error: error.message });

    // validation errors (bad URL, SSRF guard) carry their own status — only
    // genuine connectivity/Tally failures fall back to the generic 500
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({
        success: false,
        message: 'Failed to sync to Tally',
        error: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to sync to Tally',
      error: error.message,
      note: 'Ensure Tally is running and HTTP ODBC is enabled',
    });
  }
}

async function getVersions(req, res) {
  res.json({
    supportedVersions: Object.keys(TALLY_VERSIONS).map(key => ({
      code: key,
      name: TALLY_VERSIONS[key].name,
      namespace: TALLY_VERSIONS[key].namespace,
    })),
    default: 'prime2.1',
  });
}

module.exports = { exportMasters, exportVouchers, syncToTally, getVersions };
