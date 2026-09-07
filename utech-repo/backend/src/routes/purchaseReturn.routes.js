'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/purchaseReturn.controller');

router.use(requireAuth);

router.get('/', requirePermission('purchase.read'), ah(ctrl.list));
router.get('/:id', requirePermission('purchase.read'), ah(ctrl.get));
router.post('/', requirePermission('purchase.create'), ah(ctrl.create));
router.put('/:id', requirePermission('purchase.update'), ah(ctrl.update));
router.post('/:id/approve', requirePermission('purchase.update'), ah(ctrl.approve));
router.post('/:id/process', requirePermission('purchase.update'), ah(ctrl.process));
router.delete('/:id', requirePermission('purchase.delete'), ah(ctrl.remove));

module.exports = router;
