'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/quotation.controller');
const { createQuotationSchema, updateQuotationSchema } = require('../validators/quotation.schema');

router.use(requireAuth);

router.get('/', requirePermission('quotation.read'), ah(ctrl.list));
router.get('/:id', requirePermission('quotation.read'), ah(ctrl.get));
router.post('/', requirePermission('quotation.create'), validate(createQuotationSchema), ah(ctrl.create));
router.put('/:id', requirePermission('quotation.update'), validate(updateQuotationSchema), ah(ctrl.update));
router.post('/:id/convert', requirePermission('quotation.update'), ah(ctrl.convertToInvoice));
router.delete('/:id', requirePermission('quotation.delete'), ah(ctrl.remove));

module.exports = router;
