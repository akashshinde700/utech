'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/purchase.controller');
const {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  reasonSchema,
} = require('../validators/purchase.schema');

router.use(requireAuth);
router.get('/', requirePermission('purchase.read'), ah(ctrl.list));
router.get('/:id', requirePermission('purchase.read'), ah(ctrl.get));
router.post('/', requirePermission('purchase.create'), validate(createPurchaseOrderSchema), ah(ctrl.create));
router.put('/:id', requirePermission('purchase.update'), validate(updatePurchaseOrderSchema), ah(ctrl.update));
router.post('/:id/approve', requirePermission('purchase.update'), ah(ctrl.approve));
router.post('/:id/reject', requirePermission('purchase.update'), validate(reasonSchema), ah(ctrl.reject));
router.delete('/:id', requirePermission('purchase.delete'), validate(reasonSchema), ah(ctrl.cancel));

module.exports = router;
