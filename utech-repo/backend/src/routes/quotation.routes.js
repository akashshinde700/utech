'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/quotation.controller');
const { createQuotationSchema, updateQuotationSchema } = require('../validators/quotation.schema');

router.use(requireAuth);

router.get('/', requirePermission('customerQuotation.read', 'vendorQuotation.read'), ah(ctrl.list));
router.get('/:id', requirePermission('customerQuotation.read', 'vendorQuotation.read'), ah(ctrl.get));
router.post('/', requirePermission('customerQuotation.create', 'vendorQuotation.create'), validate(createQuotationSchema), ah(ctrl.create));
router.put('/:id', requirePermission('customerQuotation.update', 'vendorQuotation.update'), validate(updateQuotationSchema), ah(ctrl.update));
router.post('/:id/convert', requirePermission('customerQuotation.update', 'vendorQuotation.update'), ah(ctrl.convertToInvoice));
router.delete('/:id', requirePermission('customerQuotation.delete', 'vendorQuotation.delete'), ah(ctrl.remove));

module.exports = router;
