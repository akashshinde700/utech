'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/report.controller');

router.use(requireAuth);

router.get('/invoices.xlsx', requirePermission('report.read'), ah(ctrl.invoices));
router.get('/jobcards.xlsx', requirePermission('report.read'), ah(ctrl.jobcards));
router.get('/items.xlsx', requirePermission('report.read'), ah(ctrl.items));
router.get('/expenses.xlsx', requirePermission('report.read'), ah(ctrl.expenses));
router.get('/party-ledger/:partyId.xlsx', requirePermission('report.read'), ah(ctrl.partyLedger));
router.get('/customer-stock.xlsx', requirePermission('report.read'), ah(ctrl.customerStock));
router.get('/vendor-stock.xlsx', requirePermission('report.read'), ah(ctrl.vendorStock));
router.get('/stock-ledger.xlsx', requirePermission('report.read'), ah(ctrl.stockLedgerReport));

module.exports = router;
