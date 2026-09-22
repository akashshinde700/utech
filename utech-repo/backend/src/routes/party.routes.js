'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/party.controller');
const { createPartySchema, updatePartySchema } = require('../validators/party.schema');

router.use(requireAuth);

router.get('/', requirePermission('customerParty.read', 'vendorParty.read'), ah(ctrl.list));
// lookups for the party form's auto-fill — before /:id so they don't get eaten by it
router.get('/lookup/ifsc/:code', ah(ctrl.ifscLookup));
router.get('/lookup/gstin/:gstin', ah(ctrl.gstinLookup));
router.get('/:id', requirePermission('customerParty.read', 'vendorParty.read'), ah(ctrl.get));
router.get('/:id/ledger', requirePermission('customerParty.read', 'vendorParty.read'), ah(ctrl.ledger));
router.post('/', requirePermission('customerParty.create', 'vendorParty.create'), validate(createPartySchema), ah(ctrl.create));
router.put('/:id', requirePermission('customerParty.update', 'vendorParty.update'), validate(updatePartySchema), ah(ctrl.update));
router.delete('/:id', requirePermission('customerParty.delete', 'vendorParty.delete'), ah(ctrl.remove));

module.exports = router;
