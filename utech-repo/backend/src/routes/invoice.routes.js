'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/invoice.controller');
const {
  createInvoiceSchema, updateInvoiceSchema, paymentSchema,
} = require('../validators/invoice.schema');

router.use(requireAuth);

router.get('/', requirePermission('invoice.read'), ah(ctrl.list));
router.get('/:id', requirePermission('invoice.read'), ah(ctrl.get));
router.get('/:id/pdf', requirePermission('invoice.read'), ah(ctrl.downloadPdf));
router.post('/', requirePermission('invoice.create'), validate(createInvoiceSchema), ah(ctrl.create));
router.put('/:id', requirePermission('invoice.update'), validate(updateInvoiceSchema), ah(ctrl.update));
router.delete('/:id', requirePermission('invoice.delete'), ah(ctrl.remove));
router.post('/:id/payments', requirePermission('invoice.update'), validate(paymentSchema), ah(ctrl.addPayment));

module.exports = router;
