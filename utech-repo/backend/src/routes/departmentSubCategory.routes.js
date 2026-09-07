'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/departmentSubCategory.controller');
const { createSubCategorySchema, updateSubCategorySchema } = require('../validators/departmentSubCategory.schema');

router.use(requireAuth);

router.get('/', requirePermission('departmentSubcategory.read'), ah(ctrl.list));
router.get('/:id', requirePermission('departmentSubcategory.read'), ah(ctrl.get));
router.post('/', requirePermission('departmentSubcategory.create'), validate(createSubCategorySchema), ah(ctrl.create));
router.put('/:id', requirePermission('departmentSubcategory.update'), validate(updateSubCategorySchema), ah(ctrl.update));
router.delete('/:id', requirePermission('departmentSubcategory.delete'), ah(ctrl.remove));

module.exports = router;
