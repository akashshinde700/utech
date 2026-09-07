'use strict';
const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/tally.controller');

router.use(requireAuth);

// NOTE: the permission module seeded in prisma/seed.js is `report` (singular).
// These routes previously asked for `reports.read` / `reports.write`, keys that
// are never created, so every non-SUPERADMIN caller was silently 403'd.

// Get supported Tally versions
router.get('/versions', requirePermission('report.read'), ah(ctrl.getVersions));

// Export masters (parties, items, etc.)
// Query params: type=parties|items, version=erp9|prime2.0|prime2.1 (default: prime2.1)
router.get('/export/masters', requirePermission('report.read'), ah(ctrl.exportMasters));

// Export vouchers (invoices, receipts, payments)
// Query params: type=invoices, from=YYYY-MM-DD, to=YYYY-MM-DD, version=erp9|prime2.0|prime2.1 (default: prime2.1)
router.get('/export/vouchers', requirePermission('report.read'), ah(ctrl.exportVouchers));

// Manual sync to Tally — pushes data outward, so it needs a write right
// Body: { endpoint, data, version }
router.post('/sync', requirePermission('report.update'), ah(ctrl.syncToTally));

module.exports = router;
