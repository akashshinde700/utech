'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/salesReturn.controller');

router.use(requireAuth);

router.get('/', requirePermission('invoice.read'), ah(ctrl.list));
router.get('/:id', requirePermission('invoice.read'), ah(ctrl.get));
router.post('/', requirePermission('invoice.create'), ah(ctrl.create));
router.put('/:id', requirePermission('invoice.update'), ah(ctrl.update));
router.post('/:id/approve', requirePermission('invoice.update'), ah(ctrl.approve));
router.post('/:id/process', requirePermission('invoice.update'), ah(ctrl.process));
router.delete('/:id', requirePermission('invoice.delete'), ah(ctrl.remove));

module.exports = router;
