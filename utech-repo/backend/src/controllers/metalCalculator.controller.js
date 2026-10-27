'use strict';
const service = require('../services/metalCalculator');

// Stateless reference + calculation endpoints. Nothing is written to the
// database: the calculator deliberately cannot affect stock, invoices or any
// other ledger until a human copies the numbers into that document.
function catalog(_req, res) {
  res.json(service.catalog());
}

function profiles(req, res) {
  res.json(
    service.profiles({
      shape: req.query.shape,
      region: req.query.region,
      family: req.query.family,
      search: req.query.search,
    })
  );
}

function calculate(req, res) {
  res.json(service.calculate(req.body));
}

module.exports = { catalog, profiles, calculate };
