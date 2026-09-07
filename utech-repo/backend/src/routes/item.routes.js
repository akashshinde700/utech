'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/item.controller');
const { createItemSchema, updateItemSchema } = require('../validators/item.schema');

router.use(requireAuth);

router.get('/lookups', requirePermission('item.read'), ah(ctrl.lookupUomAndCategory));
router.get('/', requirePermission('item.read'), ah(ctrl.list));
router.get('/:id', requirePermission('item.read'), ah(ctrl.get));
router.get('/:id/stock', requirePermission('item.read'), ah(ctrl.stockHistory));
router.post('/', requirePermission('item.create'), validate(createItemSchema), ah(ctrl.create));
router.put('/:id', requirePermission('item.update'), validate(updateItemSchema), ah(ctrl.update));
router.delete('/:id', requirePermission('item.delete'), ah(ctrl.remove));

module.exports = router;
