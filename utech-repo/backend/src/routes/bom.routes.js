'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/bom.controller');

router.use(requireAuth);

router.get('/', requirePermission('item.read'), ah(ctrl.list));
router.get('/:id', requirePermission('item.read'), ah(ctrl.get));
router.post('/', requirePermission('item.create'), ah(ctrl.create));
router.put('/:id', requirePermission('item.update'), ah(ctrl.update));
router.delete('/:id', requirePermission('item.delete'), ah(ctrl.remove));

module.exports = router;
