'use strict';
// Wraps async route handlers so thrown errors hit the central error handler.
module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
