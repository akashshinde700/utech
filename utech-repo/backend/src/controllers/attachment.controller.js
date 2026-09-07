'use strict';
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const prisma = require('../config/prisma');
const env = require('../config/env');
const HttpError = require('../utils/httpError');
const { audit } = require('../utils/audit');

const ALLOWED_REF_TYPES = new Set([
  'JOBCARD', 'INVOICE', 'DISPATCH', 'JOBWORK', 'GRN', 'QUALITY', 'PROJECT', 'ASSIGNMENT',
]);
const MAX_PER_RECORD = 100;

// refType → the module permissions that govern list/download ('read') and
// upload/delete ('update') on that document class. SUPERADMIN bypasses with
// the same convention requirePermission() uses.
const REF_PERMISSIONS = {
  JOBCARD: { read: 'jobcard.read', update: 'jobcard.update' },
  INVOICE: { read: 'invoice.read', update: 'invoice.update' },
  DISPATCH: { read: 'dispatch.read', update: 'dispatch.update' },
  JOBWORK: { read: 'jobwork.read', update: 'jobwork.update' },
  GRN: { read: 'grn.read', update: 'grn.update' },
  QUALITY: { read: 'quality.read', update: 'quality.update' },
  PROJECT: { read: 'project.read', update: 'project.update' },
  ASSIGNMENT: { read: 'assignment.read', update: 'assignment.update' },
};

function assertRefPermission(req, refType, action) {
  const perms = REF_PERMISSIONS[refType];
  if (!perms) throw new HttpError(400, 'Invalid refType');
  if (req.user && req.user.role === 'SUPERADMIN') return;
  if (!req.user || !req.user.permissions.includes(perms[action])) {
    throw new HttpError(403, `Missing permission: ${perms[action]}`);
  }
}

// extension → allowed mimetypes: a file must pass BOTH checks, so a renamed
// .exe or a text file posing as an image is rejected at the multer layer
const ALLOWED_FILE_TYPES = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/csv'],
};

// server-derived content type for downloads — never the client-supplied mime
const MIME_BY_EXT = Object.fromEntries(
  Object.entries(ALLOWED_FILE_TYPES).map(([ext, mimes]) => [ext, mimes[0]])
);

// ensure upload dir exists
const baseDir = path.resolve(env.UPLOAD_DIR);
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, baseDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const allowedMimes = ALLOWED_FILE_TYPES[ext];
    if (!allowedMimes || !allowedMimes.includes(mime)) {
      return cb(new HttpError(400, `File type not allowed (${ext || 'no extension'} / ${mime || 'unknown mime'})`));
    }
    return cb(null, true);
  },
});

// operators may only touch attachments on jobcards assigned to them — either
// directly (assignedOperatorId) or, since work can also be handed to an
// operator document-by-document, via the Assignment chain. Every other
// refType/role is left exactly as open as it is today (out of scope here).
async function assertJobcardOwnership(req, refType, jobcardId) {
  if (refType !== 'JOBCARD' || !req.user || req.user.role !== 'OPERATOR') return;
  const jc = await prisma.jobcard.findUnique({ where: { id: jobcardId }, select: { assignedOperatorId: true } });
  if (!jc) throw new HttpError(404, 'Jobcard not found');
  if (jc.assignedOperatorId === req.user.id) return;
  const count = await prisma.assignment.count({
    where: { assignedToId: req.user.id, attachment: { refType: 'JOBCARD', refId: jobcardId } },
  });
  if (count === 0) throw new HttpError(403, 'This project is not assigned to you');
}

// deliverables/reference files under refType=ASSIGNMENT are only visible to the
// assignment's participants (assigner, assignee) — everyone else 403s,
// regardless of their jobcard.read permission
async function assertAssignmentAccess(req, refType, assignmentId) {
  if (refType !== 'ASSIGNMENT' || !req.user) return;
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { assignedById: true, assignedToId: true },
  });
  if (!a) throw new HttpError(404, 'Assignment not found');
  if (req.user.hierarchyLevel != null && req.user.hierarchyLevel <= 2) return; // Admin/Plant Head/Superadmin oversight
  const uid = req.user.id;
  if (a.assignedById !== uid && a.assignedToId !== uid) {
    throw new HttpError(403, 'This assignment is not visible to you');
  }
}

// --- handlers ---

async function uploadFiles(req, res) {
  const { refType, refId } = req.params;
  if (!ALLOWED_REF_TYPES.has(refType)) throw new HttpError(400, 'Invalid refType');
  assertRefPermission(req, refType, 'update');
  const recordRefId = parseInt(refId, 10);
  try {
    await assertJobcardOwnership(req, refType, recordRefId);
    await assertAssignmentAccess(req, refType, recordRefId);
  } catch (e) {
    for (const f of req.files || []) try { fs.unlinkSync(f.path); } catch (_) { /* ignore */ }
    throw e;
  }
  let lineId = req.body.lineId ? parseInt(req.body.lineId, 10) : null;
  const category = req.body.category || null;
  if (lineId && refType === 'JOBCARD') {
    const line = await prisma.jobcardLine.findUnique({ where: { id: lineId } });
    if (!line || line.jobcardId !== recordRefId) {
      for (const f of req.files) try { fs.unlinkSync(f.path); } catch (_) { /* ignore */ }
      throw new HttpError(400, 'Invalid lineId for this jobcard');
    }
  }

  // enforce per-record limit
  const existing = await prisma.attachment.count({ where: { refType, refId: recordRefId } });
  const incoming = req.files ? req.files.length : 0;
  if (existing + incoming > MAX_PER_RECORD) {
    // cleanup uploaded files
    for (const f of req.files) try { fs.unlinkSync(f.path); } catch (_) { /* ignore */ }
    throw new HttpError(400, `Per-record attachment limit (${MAX_PER_RECORD}) exceeded`);
  }

  const created = await prisma.$transaction(
    req.files.map((f) =>
      prisma.attachment.create({
        data: {
          refType, refId: recordRefId, lineId, category,
          filename: f.originalname,
          storedName: f.filename,
          mimeType: f.mimetype,
          size: f.size,
          uploadedById: req.user ? req.user.id : null,
        },
      })
    )
  );
  audit(req, 'upload', `Attachment:${refType}`, recordRefId, { count: created.length });
  res.status(201).json(created);
}

async function listFor(req, res) {
  const { refType, refId } = req.params;
  if (!ALLOWED_REF_TYPES.has(refType)) throw new HttpError(400, 'Invalid refType');
  assertRefPermission(req, refType, 'read');
  await assertJobcardOwnership(req, refType, parseInt(refId, 10));
  await assertAssignmentAccess(req, refType, parseInt(refId, 10));
  const items = await prisma.attachment.findMany({
    where: { refType, refId: parseInt(refId, 10) },
    orderBy: { createdAt: 'desc' },
  });
  res.json(items);
}

async function downloadOne(req, res) {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, 'Attachment not found');
  assertRefPermission(req, a.refType, 'read');
  await assertJobcardOwnership(req, a.refType, a.refId);
  await assertAssignmentAccess(req, a.refType, a.refId);
  const filePath = path.join(baseDir, a.storedName);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'File missing on disk');
  const ext = path.extname(a.storedName || '').toLowerCase();
  res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
  // attachment disposition + a sanitized, server-derived filename — the
  // stored original name is user input and must never be trusted
  const safeName = path.basename(a.filename || 'download')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 120) || 'download';
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    // client aborts / disk errors must not crash the process mid-stream
    console.error('[attachment] stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error', message: 'Failed to stream attachment' });
    else res.destroy();
  });
  stream.pipe(res);
}

async function deleteOne(req, res) {
  const id = parseInt(req.params.id, 10);
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, 'Attachment not found');
  assertRefPermission(req, a.refType, 'update');
  await assertJobcardOwnership(req, a.refType, a.refId);
  await assertAssignmentAccess(req, a.refType, a.refId);

  await prisma.attachment.delete({ where: { id } });
  try { fs.unlinkSync(path.join(baseDir, a.storedName)); } catch (_) { /* file may already be gone */ }
  audit(req, 'delete', `Attachment:${a.refType}`, a.refId, { filename: a.filename });
  res.json({ ok: true });
}

module.exports = { upload, uploadFiles, listFor, downloadOne, deleteOne };
