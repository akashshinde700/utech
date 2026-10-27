'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/salesReturn.controller');
const {
  createSalesReturnSchema, updateSalesReturnSchema, recordReceiptSchema, processSalesReturnSchema,
} = require('../validators/salesReturn.schema');

router.use(requireAuth);

router.get('/', requirePermission('invoice.read'), ah(ctrl.list));
router.get('/:id', requirePermission('invoice.read'), ah(ctrl.get));
router.post('/', requirePermission('invoice.create'), validate(createSalesReturnSchema), ah(ctrl.create));
router.put('/:id', requirePermission('invoice.update'), validate(updateSalesReturnSchema), ah(ctrl.update));
router.post('/:id/approve', requirePermission('invoice.update'), ah(ctrl.approve));
// recording the physical return receipt (challan no. + received date) is the
// gate that lets process() put stock back
router.post('/:id/receipt', requirePermission('invoice.update'), validate(recordReceiptSchema), ah(ctrl.recordReceipt));
router.post('/:id/process', requirePermission('invoice.update'), validate(processSalesReturnSchema), ah(ctrl.process));
router.delete('/:id', requirePermission('invoice.delete'), ah(ctrl.remove));

module.exports = router;
