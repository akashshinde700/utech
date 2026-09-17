'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/task.controller');
const {
  createTaskSchema, updateTaskSchema, assignTaskSchema,
  setStatusSchema, setProgressSchema, reworkTaskSchema, taskNoteSchema,
} = require('../validators/task.schema');

router.use(requireAuth);

router.get('/', requirePermission('task.read', 'task.progress'), ah(ctrl.list));
router.get('/dashboard', requirePermission('task.read', 'task.create'), ah(ctrl.dashboard));
router.get('/workload', requirePermission('task.read', 'task.create'), ah(ctrl.workload));
router.get('/:id', requirePermission('task.read', 'task.progress'), ah(ctrl.get));
router.get('/:id/notes', requirePermission('task.read', 'task.progress'), ah(ctrl.listNotes));
router.post('/:id/notes', requirePermission('task.update', 'task.progress'), validate(taskNoteSchema), ah(ctrl.addNote));
router.get('/:id/activity', requirePermission('task.read', 'task.progress'), ah(ctrl.activity));

router.post('/', requirePermission('task.create'), validate(createTaskSchema), ah(ctrl.create));
router.put('/:id', requirePermission('task.update'), validate(updateTaskSchema), ah(ctrl.update));
router.post('/:id/assign', requirePermission('task.update', 'task.create'), validate(assignTaskSchema), ah(ctrl.assign));
router.post('/:id/rework', requirePermission('task.update', 'task.create'), validate(reworkTaskSchema), ah(ctrl.rework));

router.patch('/:id/status', requirePermission('task.update', 'task.progress'), validate(setStatusSchema), ah(ctrl.setStatus));
router.patch('/:id/progress', requirePermission('task.update', 'task.progress'), validate(setProgressSchema), ah(ctrl.setProgress));

module.exports = router;
