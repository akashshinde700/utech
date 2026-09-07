'use strict';
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/attachment.controller');

router.use(requireAuth);

// specific /file/:id routes must be registered before the generic /:refType/:refId
// routes below, otherwise GET /file/:id is shadowed (matches /:refType/:refId first,
// with refType="file", and 400s with "Invalid refType")
router.get('/file/:id', ah(ctrl.downloadOne));
router.delete('/file/:id', ah(ctrl.deleteOne));

// upload up to 20 files at a time; total per record capped to 100 in controller
router.post('/:refType/:refId', ctrl.upload.array('files', 20), ah(ctrl.uploadFiles));
router.get('/:refType/:refId', ah(ctrl.listFor));

module.exports = router;
