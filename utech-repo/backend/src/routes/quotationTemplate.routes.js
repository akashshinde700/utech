'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/quotationTemplate.controller');
const { createTemplateSchema, updateTemplateSchema } = require('../validators/quotationTemplate.schema');

router.use(requireAuth);

// Templates are the letterhead/footer of every quotation that leaves the
// company, so they are gated on the quotation module's own rights. Previously
// these four endpoints were open to any authenticated user — an operator could
// delete the company letterhead.
router.post('/upload-image', requirePermission('customerQuotation.update', 'vendorQuotation.update', 'customerQuotation.create', 'vendorQuotation.create'), ctrl.upload.single('file'), ah(ctrl.uploadImage));
router.get('/image/:storedName', requirePermission('customerQuotation.read', 'vendorQuotation.read'), ah(ctrl.serveImage));

router.get('/', requirePermission('customerQuotation.read', 'vendorQuotation.read'), ah(ctrl.list));
router.post('/', requirePermission('customerQuotation.create', 'vendorQuotation.create'), validate(createTemplateSchema), ah(ctrl.create));
router.put('/:id', requirePermission('customerQuotation.update', 'vendorQuotation.update'), validate(updateTemplateSchema), ah(ctrl.update));
router.delete('/:id', requirePermission('customerQuotation.delete', 'vendorQuotation.delete'), ah(ctrl.remove));

module.exports = router;
