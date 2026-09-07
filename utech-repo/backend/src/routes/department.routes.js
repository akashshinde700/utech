'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/department.controller');
const { createDepartmentSchema, updateDepartmentSchema } = require('../validators/department.schema');

router.use(requireAuth);

router.get('/', requirePermission('department.read'), ah(ctrl.list));
router.get('/:id', requirePermission('department.read'), ah(ctrl.get));
router.post('/', requirePermission('department.create'), validate(createDepartmentSchema), ah(ctrl.create));
router.put('/:id', requirePermission('department.update'), validate(updateDepartmentSchema), ah(ctrl.update));
router.delete('/:id', requirePermission('department.delete'), ah(ctrl.remove));

module.exports = router;
