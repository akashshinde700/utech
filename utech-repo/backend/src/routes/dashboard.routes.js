'use strict';
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/dashboard.controller');

router.use(requireAuth);
router.get('/summary', ah(ctrl.summary));
router.get('/sales-analytics', ah(ctrl.salesAnalytics));

module.exports = router;
