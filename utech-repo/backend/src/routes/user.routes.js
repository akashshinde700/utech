'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/user.controller');
const { createUserSchema, updateUserSchema } = require('../validators/user.schema');

router.use(requireAuth);

router.get('/', requirePermission('user.read'), ah(ctrl.list));
router.get('/reporting-candidates', requirePermission('user.read'), ah(ctrl.reportingCandidates));
router.get('/:id', requirePermission('user.read'), ah(ctrl.get));
router.post('/', requirePermission('user.create'), validate(createUserSchema), ah(ctrl.create));
router.put('/:id', requirePermission('user.update'), validate(updateUserSchema), ah(ctrl.update));
router.delete('/:id', requirePermission('user.delete'), ah(ctrl.remove));

module.exports = router;
