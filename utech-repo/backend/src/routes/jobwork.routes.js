'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/jobwork.controller');
const { createJobworkSchema, receiveJobworkSchema } = require('../validators/jobcard.schema');

router.use(requireAuth);

router.get('/', requirePermission('jobwork.read'), ah(ctrl.list));
router.get('/:id', requirePermission('jobwork.read'), ah(ctrl.get));
router.post('/', requirePermission('jobwork.create'), validate(createJobworkSchema), ah(ctrl.create));
router.post('/:id/receive', requirePermission('jobwork.update'), validate(receiveJobworkSchema), ah(ctrl.receive));
router.delete('/:id', requirePermission('jobwork.delete'), ah(ctrl.remove));

module.exports = router;
