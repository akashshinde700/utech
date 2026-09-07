'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/jobcard.controller');
const {
  createJobcardSchema, updateJobcardSchema, revertSchema, progressSchema, noteSchema,
} = require('../validators/jobcard.schema');

router.use(requireAuth);

router.get('/', requirePermission('jobcard.read'), ah(ctrl.list));
router.get('/:id', requirePermission('jobcard.read'), ah(ctrl.get));
router.post('/', requirePermission('jobcard.create'), validate(createJobcardSchema), ah(ctrl.create));
router.put('/:id', requirePermission('jobcard.update'), validate(updateJobcardSchema), ah(ctrl.update));
router.post('/:id/revert', requirePermission('jobcard.update'), validate(revertSchema), ah(ctrl.revert));
router.delete('/:id', requirePermission('jobcard.delete'), ah(ctrl.remove));

router.patch('/:id/progress', requirePermission('jobcard.progress'), validate(progressSchema), ah(ctrl.updateProgress));
router.post('/:id/complete', requirePermission('jobcard.progress'), ah(ctrl.complete));
router.get('/:id/notes', requirePermission('jobcard.read'), ah(ctrl.listNotes));
router.post('/:id/notes', requirePermission('jobcard.read'), validate(noteSchema), ah(ctrl.addNote));
router.get('/:id/activity', requirePermission('jobcard.read'), ah(ctrl.activity));

module.exports = router;
