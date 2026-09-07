'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/expense.controller');

router.use(requireAuth);
router.get('/summary', requirePermission('expense.read'), ah(ctrl.summary));
router.get('/', requirePermission('expense.read'), ah(ctrl.list));
router.get('/:id', requirePermission('expense.read'), ah(ctrl.get));
router.post('/', requirePermission('expense.create'), ah(ctrl.create));
router.put('/:id', requirePermission('expense.update'), ah(ctrl.update));
router.delete('/:id', requirePermission('expense.delete'), ah(ctrl.remove));

module.exports = router;
