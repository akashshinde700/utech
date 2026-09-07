'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/party.controller');
const { createPartySchema, updatePartySchema } = require('../validators/party.schema');

router.use(requireAuth);

router.get('/', requirePermission('party.read'), ah(ctrl.list));
router.get('/:id', requirePermission('party.read'), ah(ctrl.get));
router.get('/:id/ledger', requirePermission('party.read'), ah(ctrl.ledger));
router.post('/', requirePermission('party.create'), validate(createPartySchema), ah(ctrl.create));
router.put('/:id', requirePermission('party.update'), validate(updatePartySchema), ah(ctrl.update));
router.delete('/:id', requirePermission('party.delete'), ah(ctrl.remove));

module.exports = router;
