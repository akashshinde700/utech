'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/quality.controller');
const { createQualityCheckSchema, updateQualityCheckSchema } = require('../validators/quality.schema');

router.use(requireAuth);
router.get('/', requirePermission('quality.read'), ah(ctrl.list));
router.get('/:id', requirePermission('quality.read'), ah(ctrl.get));
router.post('/', requirePermission('quality.create'), validate(createQualityCheckSchema), ah(ctrl.create));
router.put('/:id', requirePermission('quality.update'), validate(updateQualityCheckSchema), ah(ctrl.update));
router.delete('/:id', requirePermission('quality.delete'), ah(ctrl.remove));

module.exports = router;
