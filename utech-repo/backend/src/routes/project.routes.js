'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/project.controller');

router.use(requireAuth);
router.get('/', requirePermission('project.read'), ah(ctrl.list));
router.get('/:id', requirePermission('project.read'), ah(ctrl.get));
router.post('/', requirePermission('project.create'), ah(ctrl.create));
router.put('/:id', requirePermission('project.update'), ah(ctrl.update));
router.delete('/:id', requirePermission('project.delete'), ah(ctrl.remove));

router.get('/:id/items', requirePermission('project.read'), ah(ctrl.listItems));
router.post('/:id/items', requirePermission('project.update'), ah(ctrl.addItem));
router.delete('/:id/items/:itemId', requirePermission('project.update'), ah(ctrl.removeItem));

router.get('/:id/tasks', requirePermission('project.read'), ah(ctrl.listTasks));
router.post('/:id/tasks', requirePermission('project.update'), ah(ctrl.createTask));
router.put('/:id/tasks/:taskId', requirePermission('project.update'), ah(ctrl.updateTask));
router.delete('/:id/tasks/:taskId', requirePermission('project.update'), ah(ctrl.deleteTask));

module.exports = router;
