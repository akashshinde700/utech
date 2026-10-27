'use strict';
const env = require('../config/env');

// "lines.0.qty" -> "Line 1 quantity"; "partyId" -> "party id". Used to turn a
// Zod path into something a person can act on, because a bare
// { error: 'ValidationError' } toast tells the user nothing.
const WORD_ALIASES = {
  qty: 'quantity', qtySent: 'quantity sent', qtyOrdered: 'quantity ordered',
  qtyProduced: 'quantity produced', qtyRejected: 'quantity rejected',
  qtyConsumed: 'quantity consumed', qtyPlanned: 'quantity planned',
  partyId: 'party', itemId: 'item', uomId: 'unit', gstRate: 'GST rate',
  hsnCode: 'HSN code', dueDate: 'due date', startDate: 'start date',
  endDate: 'end date', expectedDate: 'expected date', plannedStartAt: 'planned start',
  invoiceLineId: 'invoice line', grnLineId: 'GRN line', jobcardId: 'jobcard',
  processId: 'process', departmentId: 'department', assignedToId: 'assignee',
};

function prettifyPath(path = []) {
  const words = [];
  for (const segment of path) {
    if (/^\d+$/.test(String(segment))) {
      // "lines.0.qty" -> "line 1 quantity": the container word is redundant
      // once the index is spelled out as "line N"
      if (words.length && words[words.length - 1] !== 'line') words.pop();
      words.push(`line ${Number(segment) + 1}`);
      continue;
    }
    words.push(WORD_ALIASES[segment] || String(segment).replace(/([A-Z])/g, ' $1').toLowerCase());
  }
  return words.join(' ').trim();
}

// Centralized error handler. Translates known Prisma + Zod errors into clean JSON.
module.exports = function errorHandler(err, _req, res, _next) {
  if (process.env.NODE_ENV !== 'test') console.error('[error]', err.message);

  // Multer (file upload) errors — thrown by the upload middleware itself,
  // before the route handler runs, so they'd otherwise fall through to a
  // generic 500 with no useful message.
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'FileTooLarge',
        message: `File is too large — maximum allowed size is ${env.MAX_UPLOAD_MB}MB.`,
      });
    }
    return res.status(400).json({ error: 'UploadError', message: err.message });
  }

  // Zod
  if (err && err.name === 'ZodError') {
    // Zod v4 dropped the `.errors` alias in favour of `.issues`; read both so a
    // library bump can never turn every validation failure into a 500.
    const issues = err.issues || err.errors || [];
    const details = issues.map((e) => ({
      path: e.path.join('.'),
      label: prettifyPath(e.path),
      message: e.message,
    }));
    const summary = details
      .slice(0, 3)
      .map((d) => (d.label ? `${d.label}: ${d.message}` : d.message))
      .join('; ');
    return res.status(400).json({
      error: 'ValidationError',
      message: summary || 'Some of the submitted values are invalid.',
      details,
    });
  }

  // A field the client sent with the wrong type/shape. Without this the user
  // gets an opaque 500 instead of a fixable message.
  if (err && err.name === 'PrismaClientValidationError') {
    return res.status(400).json({
      error: 'InvalidData',
      message: 'Some of the submitted values have the wrong type or are missing.',
    });
  }

  // Prisma known errors
  if (err && err.code && typeof err.code === 'string' && err.code.startsWith('P')) {
    // Drivers surface unique violations as P2002 (MySQL) or P2010 + 23505
    // (PostgreSQL). Treat both as a duplicate so the UI can show a real message.
    const uniqueViolation = err.code === 'P2002'
      || (err.code === 'P2010' && (err.meta && err.meta.code === '23505'
        || /duplicate key|unique constraint/i.test(String(err.message))));
    if (uniqueViolation) {
      return res.status(409).json({
        error: 'DuplicateError',
        target: err.meta && err.meta.target,
        message: 'A record with this value already exists.',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'NotFound', message: err.meta && err.meta.cause });
    }
    // foreign-key / required-relation failures are user-correctable
    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'InvalidReference', message: 'A linked record does not exist any more.' });
    }
  }

  if (err && err.statusCode) {
    return res.status(err.statusCode).json({ error: err.name || 'Error', message: err.message });
  }

  return res.status(500).json({ error: 'InternalError', message: 'Something went wrong.' });
};
