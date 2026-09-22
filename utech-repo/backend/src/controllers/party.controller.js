'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextCode } = require('../utils/numbering');
const { audit } = require('../utils/audit');
const { deriveFromGstin } = require('../utils/gstin');
const { partyTypesFor, assertPartyType } = require('../utils/typedAccess');

// Fill stateCode / state / pan from the GSTIN when they weren't supplied.
// GSTIN is the source of truth for the GST state code, so it always wins there.
function applyGstinDerivations(data) {
  if (!data.gstin) return data;
  const d = deriveFromGstin(data.gstin);
  if (!d.stateCode) return data;
  data.stateCode = d.stateCode;
  if (!data.state && d.state) data.state = d.state;
  if (!data.pan && d.pan) data.pan = d.pan;
  return data;
}

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name', 'code',
  ]);
  const where = {};
  // A party saved as BOTH is a customer *and* a vendor, so a ?type=VENDOR
  // filter has to match it too — otherwise every vendor dropdown in the app
  // (purchase order, GRN, jobwork, purchase return) silently hides them.
  // The result is then cut down to the types the caller may read.
  const readable = partyTypesFor(req, 'read');
  const wanted = req.query.type
    ? (req.query.type === 'BOTH' ? ['BOTH'] : [req.query.type, 'BOTH'])
    : ['CUSTOMER', 'VENDOR', 'BOTH'];
  where.type = { in: wanted.filter((t) => readable.includes(t)) };
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
      { gstin: { contains: search } },
      { phone: { contains: search } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.party.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir } }),
    prisma.party.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) throw new HttpError(404, 'Party not found');
  assertPartyType(req, 'read', party.type);
  res.json(party);
}

async function create(req, res) {
  assertPartyType(req, 'create', req.body.type || 'CUSTOMER');
  const code = await nextCode('party', 'party');
  const data = applyGstinDerivations({ ...req.body, code });
  const party = await prisma.party.create({ data });
  await audit(req, 'create', 'Party', party.id, { code: party.code, name: party.name });
  res.status(201).json(party);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.party.findUnique({ where: { id }, select: { type: true } });
  if (!existing) throw new HttpError(404, 'Party not found');
  // editing needs rights over what the party is now and what it becomes
  assertPartyType(req, 'update', existing.type);
  if (req.body.type && req.body.type !== existing.type) assertPartyType(req, 'update', req.body.type);
  const party = await prisma.party.update({ where: { id }, data: applyGstinDerivations({ ...req.body }) });
  await audit(req, 'update', 'Party', id, { code: party.code, name: party.name });
  res.json(party);
}

// IFSC -> bank + branch, via the free public Razorpay IFSC dataset (no key).
// Used by the party form to auto-fill the bank name once an IFSC is typed.
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
async function ifscLookup(req, res) {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!IFSC_RE.test(code)) throw new HttpError(400, 'Invalid IFSC code');
  try {
    const ac = AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined;
    const r = await fetch(`https://ifsc.razorpay.com/${code}`, { signal: ac });
    if (r.status === 404) throw new HttpError(404, 'IFSC not found');
    if (!r.ok) throw new HttpError(502, 'IFSC lookup service unavailable');
    const j = await r.json();
    res.json({
      ifsc: code,
      bankName: j.BANK || null,
      branch: j.BRANCH || null,
      address: j.ADDRESS || null,
      city: j.CITY || null,
      state: j.STATE || null,
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Could not reach the IFSC lookup service');
  }
}

// GSTIN -> what we can derive locally (state code, state name, PAN). No external
// call; a real legal-name/address lookup would need a paid GST API + key.
async function gstinLookup(req, res) {
  const d = deriveFromGstin(req.params.gstin);
  if (!d.stateCode) throw new HttpError(400, 'Invalid GSTIN');
  res.json(d);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.party.findUnique({ where: { id }, select: { type: true } });
  if (!existing) throw new HttpError(404, 'Party not found');
  assertPartyType(req, 'delete', existing.type);
  await prisma.party.update({ where: { id }, data: { isActive: false } });
  await audit(req, 'deactivate', 'Party', id);
  res.json({ ok: true });
}

async function ledger(req, res) {
  const id = parseInt(req.params.id, 10);
  const party = await prisma.party.findUnique({
    where: { id }, select: { id: true, openingBalance: true, type: true },
  });
  if (!party) throw new HttpError(404, 'Party not found');
  assertPartyType(req, 'read', party.type);
  const entries = await prisma.partyLedger.findMany({
    where: { partyId: id },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  // the ledger opens at the party's opening balance, not zero
  const opening = Number(party.openingBalance || 0);
  let balance = opening;
  const rows = entries.map((e) => {
    balance += Number(e.debit) - Number(e.credit);
    return { ...e, runningBalance: balance };
  });
  res.json({ openingBalance: opening, entries: rows, closingBalance: balance });
}

module.exports = { list, get, create, update, remove, ledger, ifscLookup, gstinLookup };
