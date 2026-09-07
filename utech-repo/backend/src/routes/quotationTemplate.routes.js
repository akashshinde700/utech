'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/quotationTemplate.controller');

router.use(requireAuth);

// Templates are the letterhead/footer of every quotation that leaves the
// company, so they are gated on the quotation module's own rights. Previously
// these four endpoints were open to any authenticated user — an operator could
// delete the company letterhead.
router.post('/upload-image', requirePermission('quotation.update', 'quotation.create'), ctrl.upload.single('file'), ah(ctrl.uploadImage));
router.get('/image/:storedName', requirePermission('quotation.read'), ah(ctrl.serveImage));

router.get('/', requirePermission('quotation.read'), ah(ctrl.list));
router.post('/', requirePermission('quotation.create'), ah(ctrl.create));
router.put('/:id', requirePermission('quotation.update'), ah(ctrl.update));
router.delete('/:id', requirePermission('quotation.delete'), ah(ctrl.remove));

module.exports = router;
