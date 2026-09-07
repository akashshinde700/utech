'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/grn.controller');
const { createGrnSchema, updateGrnSchema, reasonSchema } = require('../validators/purchase.schema');

router.use(requireAuth);
router.get('/', requirePermission('grn.read'), ah(ctrl.list));
router.get('/:id', requirePermission('grn.read'), ah(ctrl.get));
router.post('/', requirePermission('grn.create'), validate(createGrnSchema), ah(ctrl.create));
router.put('/:id', requirePermission('grn.update'), validate(updateGrnSchema), ah(ctrl.update));
// reversing a receipt moves stock back out, so it is gated on grn.delete rather
// than the lighter grn.update right
router.delete('/:id', requirePermission('grn.delete'), validate(reasonSchema), ah(ctrl.cancel));

module.exports = router;
