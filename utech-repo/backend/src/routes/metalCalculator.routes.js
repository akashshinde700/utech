'use strict';
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/metalCalculator.controller');
const { calculateSchema } = require('../validators/metalCalculator.schema');

// Every signed-in user may open the calculator — it is a read-only reference
// tool (no writes, no money movement), so it needs no business permission key.
router.use(requireAuth);

router.get('/catalog', ah(ctrl.catalog));
router.get('/profiles', ah(ctrl.profiles));
router.post('/calculate', validate(calculateSchema), ah(ctrl.calculate));

module.exports = router;
