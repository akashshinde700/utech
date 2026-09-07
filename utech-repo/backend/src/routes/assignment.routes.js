'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/assignment.controller');
const { createAssignmentSchema, completeAssignmentSchema, reopenAssignmentSchema } = require('../validators/assignment.schema');

router.use(requireAuth);

router.get('/', requirePermission('assignment.read'), ah(ctrl.list));
router.get('/eligible-users', requirePermission('assignment.create'), ah(ctrl.eligibleUsers));
router.get('/stats', requirePermission('assignment.read'), ah(ctrl.stats));
router.get('/:id', requirePermission('assignment.read'), ah(ctrl.get));
router.get('/:id/activity', requirePermission('assignment.read'), ah(ctrl.activity));
router.post('/', requirePermission('assignment.create'), validate(createAssignmentSchema), ah(ctrl.create));
router.post('/:id/start', requirePermission('assignment.update'), ah(ctrl.start));
router.post('/:id/complete', requirePermission('assignment.update'), validate(completeAssignmentSchema), ah(ctrl.complete));
router.post('/:id/reopen', requirePermission('assignment.update'), validate(reopenAssignmentSchema), ah(ctrl.reopen));
// cancel is a soft status transition (status -> CANCELLED, guarded by the
// controller's own assignedById-ownership check), so it's gated the same way
// as start/complete/reopen — not assignment.delete, which stays reserved for
// a true hard-delete this route doesn't perform.
router.delete('/:id', requirePermission('assignment.update'), ah(ctrl.cancel));

module.exports = router;
