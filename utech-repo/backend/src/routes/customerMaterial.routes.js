'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/customerMaterial.controller');
const { createLotSchema, updateLotSchema, dispositionSchema } = require('../validators/customerMaterial.schema');

router.use(requireAuth);

router.get('/', requirePermission('customerMaterial.read'), ah(ctrl.list));
router.get('/:id', requirePermission('customerMaterial.read'), ah(ctrl.get));
router.post('/', requirePermission('customerMaterial.create'), validate(createLotSchema), ah(ctrl.create));
router.put('/:id', requirePermission('customerMaterial.update'), validate(updateLotSchema), ah(ctrl.update));
router.post('/:id/consume', requirePermission('customerMaterial.update'), validate(dispositionSchema), ah(ctrl.consume));
router.post('/:id/dispatch-to-customer', requirePermission('customerMaterial.update'), validate(dispositionSchema), ah(ctrl.dispatchToCustomer));
router.post('/:id/return-to-customer', requirePermission('customerMaterial.update'), validate(dispositionSchema), ah(ctrl.returnToCustomer));

module.exports = router;
