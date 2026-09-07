'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/machine.controller');

router.use(requireAuth);

router.get('/', requirePermission('machine.read'), ah(ctrl.list));
router.get('/:id', requirePermission('machine.read'), ah(ctrl.get));
router.post('/', requirePermission('machine.create'), ah(ctrl.create));
router.put('/:id', requirePermission('machine.update'), ah(ctrl.update));
router.delete('/:id', requirePermission('machine.delete'), ah(ctrl.remove));

module.exports = router;
