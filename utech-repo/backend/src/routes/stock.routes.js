'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/stock.controller');
const { stockAdjustSchema } = require('../validators/stock.schema');

router.use(requireAuth);

router.get('/summary', requirePermission('stock.read'), ah(ctrl.summary));
router.get('/ledger', requirePermission('stock.read'), ah(ctrl.ledger));
router.post('/adjust', requirePermission('stock.adjust'), validate(stockAdjustSchema), ah(ctrl.adjust));

module.exports = router;
