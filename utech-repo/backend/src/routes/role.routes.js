'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/role.controller');
const { createRoleSchema, updateRoleSchema } = require('../validators/role.schema');

router.use(requireAuth);

router.get('/permissions/all', requirePermission('role.read'), ah(ctrl.listPermissions));
router.get('/', requirePermission('role.read'), ah(ctrl.list));
router.get('/:id', requirePermission('role.read'), ah(ctrl.get));
router.post('/', requirePermission('role.create'), validate(createRoleSchema), ah(ctrl.create));
router.put('/:id', requirePermission('role.update'), validate(updateRoleSchema), ah(ctrl.update));
router.delete('/:id', requirePermission('role.delete'), ah(ctrl.remove));

module.exports = router;
