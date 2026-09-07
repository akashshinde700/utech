'use strict';
const env = require('../config/env');

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
    return res.status(400).json({
      error: 'ValidationError',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
  }

  // Prisma known errors
  if (err && err.code && typeof err.code === 'string' && err.code.startsWith('P')) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'DuplicateError',
        target: err.meta && err.meta.target,
        message: 'A record with this value already exists.',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'NotFound', message: err.meta && err.meta.cause });
    }
  }

  if (err && err.statusCode) {
    return res.status(err.statusCode).json({ error: err.name || 'Error', message: err.message });
  }

  return res.status(500).json({ error: 'InternalError', message: 'Something went wrong.' });
};
