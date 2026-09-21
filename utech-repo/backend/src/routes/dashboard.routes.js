'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/dashboard.controller');

router.use(requireAuth);

// Both endpoints return company-wide revenue (30-day sales, 6-month trend,
// top products, overdue receivables) — that is invoice data and must be gated
// like invoice data. Shop-floor roles land on OperatorDashboard, which never
// calls these, so gating here costs them nothing.
router.get('/summary', requirePermission('invoice.read'), ah(ctrl.summary));
router.get('/sales-analytics', requirePermission('invoice.read'), ah(ctrl.salesAnalytics));

module.exports = router;
