'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/production.controller');
const { completeBatchSchema } = require('../validators/production.schema');

router.use(requireAuth);

// Shift management
router.get('/shifts', requirePermission('jobcard.read'), ah(ctrl.listShifts));
router.post('/shifts', requirePermission('jobcard.create'), ah(ctrl.createShift));
router.put('/shifts/:id', requirePermission('jobcard.update'), ah(ctrl.updateShift));

// Production batch management
router.get('/batches', requirePermission('jobcard.read'), ah(ctrl.listBatches));
router.get('/batches/:id', requirePermission('jobcard.read'), ah(ctrl.getBatch));
router.post('/batches', requirePermission('jobcard.create'), ah(ctrl.createBatch));
router.put('/batches/:id', requirePermission('jobcard.update'), ah(ctrl.updateBatch));
router.post('/batches/:id/start', requirePermission('jobcard.update'), ah(ctrl.startBatch));
router.post('/batches/:id/complete', requirePermission('jobcard.update'), validate(completeBatchSchema), ah(ctrl.completeBatch));
router.post('/batches/:id/materials', requirePermission('jobcard.update'), ah(ctrl.updateMaterialConsumption));
router.delete('/batches/:id', requirePermission('jobcard.delete'), ah(ctrl.cancelBatch));

module.exports = router;
