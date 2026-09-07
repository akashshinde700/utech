'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/dispatch.controller');
const { createDispatchSchema } = require('../validators/jobcard.schema');

router.use(requireAuth);

router.get('/', requirePermission('dispatch.read'), ah(ctrl.list));
router.get('/:id', requirePermission('dispatch.read'), ah(ctrl.get));
router.post('/', requirePermission('dispatch.create'), validate(createDispatchSchema), ah(ctrl.create));
router.post('/:id/status/:status', requirePermission('dispatch.update'), ah(ctrl.markStatus));

module.exports = router;
