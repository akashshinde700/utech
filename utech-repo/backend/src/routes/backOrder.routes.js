'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/backOrder.controller');
const {
  createBackOrderSchema, updateBackOrderSchema, fulfillBackOrderSchema,
} = require('../validators/backOrder.schema');

router.use(requireAuth);

router.get('/', requirePermission('invoice.read'), ah(ctrl.list));
router.get('/:id', requirePermission('invoice.read'), ah(ctrl.get));
router.post('/', requirePermission('invoice.create'), validate(createBackOrderSchema), ah(ctrl.create));
router.put('/:id', requirePermission('invoice.update'), validate(updateBackOrderSchema), ah(ctrl.update));
router.post('/:id/fulfill', requirePermission('invoice.update'), validate(fulfillBackOrderSchema), ah(ctrl.fulfill));
router.delete('/:id', requirePermission('invoice.delete'), ah(ctrl.remove));

module.exports = router;
