'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { parseListQuery, paginated } = require('../utils/pagination');
const { nextNumber } = require('../utils/numbering');
const { audit } = require('../utils/audit');

const INCLUDE = { lines: true };

// A quality check is a CERTIFICATE: it must point at a document that really
// exists, and its certificate number must identify exactly one certificate.
// Neither was enforced before — a check could reference JOBCARD #999999 (which
// nobody can open) and two PASS certificates could carry the same number, which
// is precisely what an auditor looks for.
const REF_DELEGATES = {
  GRN: 'gRN',
  JOBCARD: 'jobcard',
  DISPATCH: 'dispatchChallan',
  TASK: 'jobcardOperation',
};

async function assertReferenceExists(db, refType, refId) {
  const delegate = REF_DELEGATES[refType];
  if (!delegate) throw new HttpError(400, `Unsupported reference type: ${refType}`);
  const row = await db[delegate].findUnique({ where: { id: Number(refId) }, select: { id: true } });
  if (!row) throw new HttpError(400, `No ${refType} with id ${refId} exists — record the quality check against a real document`);
}

// Case/whitespace-insensitive uniqueness. A database unique index would be
// better, but existing installations may already hold duplicates that must be
// reviewed rather than deleted by a migration; until then this is the guard.
async function normaliseCertificateNo(db, value, excludeId = null) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const certificateNo = String(value).trim();
  if (!certificateNo) return null;
  const rows = await db.qualityCheck.findMany({
    where: { certificateNo: { not: null } },
    select: { id: true, number: true, certificateNo: true },
  });
  const clash = rows.find((r) => r.id !== excludeId
    && r.certificateNo
    && String(r.certificateNo).trim().toLowerCase() === certificateNo.toLowerCase());
  if (clash) {
    throw new HttpError(409, `Certificate number "${certificateNo}" is already used by quality check ${clash.number}`);
  }
  return certificateNo;
}

async function list(req, res) {
  const { skip, take, page, pageSize, sortBy, sortDir, search } = parseListQuery(req.query, [
    'date', 'createdAt', 'number',
  ]);
  const where = {};
  if (req.query.refType) where.refType = req.query.refType;
  if (req.query.result) where.result = req.query.result;
  if (search) where.OR = [{ number: { contains: search } }, { certificateNo: { contains: search } }];
  const [items, total] = await Promise.all([
    prisma.qualityCheck.findMany({ where, skip, take, orderBy: { [sortBy]: sortDir } }),
    prisma.qualityCheck.count({ where }),
  ]);
  res.json(paginated(items, total, page, pageSize));
}

async function get(req, res) {
  const id = parseInt(req.params.id, 10);
  const qc = await prisma.qualityCheck.findUnique({ where: { id }, include: INCLUDE });
  if (!qc) throw new HttpError(404, 'Quality check not found');
  res.json(qc);
}

async function create(req, res) {
  const { lines = [], ...rest } = req.body;
  if (!rest.refId || !Number.isInteger(Number(rest.refId)) || Number(rest.refId) <= 0) {
    throw new HttpError(400, 'A valid Ref ID is required');
  }
  await assertReferenceExists(prisma, rest.refType, rest.refId);
  const certificateNo = await normaliseCertificateNo(prisma, rest.certificateNo);
  const number = await nextNumber('qualityCheck', 'qc');
  const qc = await prisma.qualityCheck.create({
    data: {
      ...rest,
      certificateNo,
      date: new Date(rest.date),
      number,
      lines: { create: lines },
    },
    include: INCLUDE,
  });
  audit(req, 'create', 'QualityCheck', qc.id, { number, refType: rest.refType, refId: rest.refId });
  res.status(201).json(qc);
}

async function update(req, res) {
  const id = parseInt(req.params.id, 10);
  const { lines, ...rest } = req.body;
  // explicit whitelist — a generic edit must never reach id/number/refType/
  // refId (the check would silently detach it from the document it inspects)
  const editable = {};
  for (const key of ['date', 'result', 'inspectorName', 'remarks', 'certificateNo']) {
    if (rest[key] !== undefined) editable[key] = rest[key];
  }
  if (editable.date) editable.date = new Date(editable.date);
  if (editable.certificateNo !== undefined) {
    editable.certificateNo = await normaliseCertificateNo(prisma, editable.certificateNo, id);
  }
  const qc = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.qualityCheckLine.deleteMany({ where: { qcId: id } });
    }
    return tx.qualityCheck.update({
      where: { id },
      data: { ...editable, ...(lines ? { lines: { create: lines } } : {}) },
      include: INCLUDE,
    });
  });
  audit(req, 'update', 'QualityCheck', id);
  res.json(qc);
}

async function remove(req, res) {
  const id = parseInt(req.params.id, 10);
  await prisma.qualityCheck.delete({ where: { id } });
  audit(req, 'delete', 'QualityCheck', id);
  res.json({ ok: true });
}

module.exports = { list, get, create, update, remove };
