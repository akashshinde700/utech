'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/quality.controller');

router.use(requireAuth);
router.get('/', requirePermission('quality.read'), ah(ctrl.list));
router.get('/:id', requirePermission('quality.read'), ah(ctrl.get));
router.post('/', requirePermission('quality.create'), ah(ctrl.create));
router.put('/:id', requirePermission('quality.update'), ah(ctrl.update));
router.delete('/:id', requirePermission('quality.delete'), ah(ctrl.remove));

module.exports = router;
