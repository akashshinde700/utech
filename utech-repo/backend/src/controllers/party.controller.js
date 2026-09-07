'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextCode } = require('../utils/numbering');
const { audit } = require('../utils/audit');

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'createdAt', 'name', 'code',
  ]);
  const where = {};
  // A party saved as BOTH is a customer *and* a vendor, so a ?type=VENDOR
  // filter has to match it too — otherwise every vendor dropdown in the app
  // (purchase order, GRN, jobwork, purchase return) silently hides them.
  if (req.query.type) {
    where.type = req.query.type === 'BOTH' ? 'BOTH' : { in: [req.query.type, 'BOTH'] };
  }
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
  res.json(party);
}

async function create(req, res) {
  const code = await nextCode('party', 'party');
  const party = await prisma.party.create({ data: { ...req.body, code } });
  await audit(req, 'create', 'Party', party.id, { code: party.code, name: party.name });
  res.status(201).json(party);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const party = await prisma.party.update({ where: { id }, data: req.body });
  await audit(req, 'update', 'Party', id, { code: party.code, name: party.name });
  res.json(party);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await prisma.party.update({ where: { id }, data: { isActive: false } });
  await audit(req, 'deactivate', 'Party', id);
  res.json({ ok: true });
}

async function ledger(req, res) {
  const id = parseInt(req.params.id, 10);
  const party = await prisma.party.findUnique({
    where: { id }, select: { id: true, openingBalance: true },
  });
  if (!party) throw new HttpError(404, 'Party not found');
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

module.exports = { list, get, create, update, remove, ledger };
