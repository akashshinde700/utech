'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/vendorWorkOrder.controller');
const {
  createVendorWorkOrderSchema,
  updateVendorWorkOrderSchema,
  sendVendorWorkOrderSchema,
  receiveVendorWorkOrderSchema,
  raisePurchaseOrderSchema,
  closeVendorWorkOrderSchema,
} = require('../validators/vendorWorkOrder.schema');

router.use(requireAuth);

router.get('/', requirePermission('vendorWorkOrder.read'), ah(ctrl.list));
router.get('/stats', requirePermission('vendorWorkOrder.read'), ah(ctrl.stats));
router.get('/:id', requirePermission('vendorWorkOrder.read'), ah(ctrl.get));
router.get('/:id/activity', requirePermission('vendorWorkOrder.read'), ah(ctrl.activity));
router.post('/', requirePermission('vendorWorkOrder.create'), validate(createVendorWorkOrderSchema), ah(ctrl.create));
router.put('/:id', requirePermission('vendorWorkOrder.update'), validate(updateVendorWorkOrderSchema), ah(ctrl.update));
router.post('/:id/send', requirePermission('vendorWorkOrder.update'), validate(sendVendorWorkOrderSchema), ah(ctrl.send));
router.post('/:id/receive', requirePermission('vendorWorkOrder.update'), validate(receiveVendorWorkOrderSchema), ah(ctrl.receive));
// raising the PO writes into the purchase module, so it needs BOTH that
// module's create right AND the work order's own update right (stacked
// middlewares — requirePermission is any-of when given multiple keys)
router.post('/:id/purchase-order',
  requirePermission('purchase.create'),
  requirePermission('vendorWorkOrder.update'),
  validate(raisePurchaseOrderSchema),
  ah(ctrl.raisePurchaseOrder));
router.post('/:id/short-close', requirePermission('vendorWorkOrder.update'), validate(closeVendorWorkOrderSchema), ah(ctrl.shortClose));
// cancel is a status transition guarded by the controller, matching how
// assignment cancel is gated on update rather than delete
router.delete('/:id', requirePermission('vendorWorkOrder.update'), validate(closeVendorWorkOrderSchema), ah(ctrl.cancel));

module.exports = router;
