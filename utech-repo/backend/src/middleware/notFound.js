'use strict';
module.exports = function notFound(req, res) {
  res.status(404).json({ error: 'NotFound', path: req.originalUrl });
};
