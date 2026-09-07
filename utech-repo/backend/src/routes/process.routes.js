'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/process.controller');

router.use(requireAuth);
router.get('/', requirePermission('process.read'), ah(ctrl.list));
router.get('/:id', requirePermission('process.read'), ah(ctrl.get));
router.post('/', requirePermission('process.create'), ah(ctrl.create));
router.put('/:id', requirePermission('process.update'), ah(ctrl.update));
router.delete('/:id', requirePermission('process.delete'), ah(ctrl.remove));

module.exports = router;
