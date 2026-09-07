'use strict';
const router = require('express').Router();
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/auth.controller');
const {
  loginSchema, otpRequestSchema, otpVerifySchema, changePasswordSchema,
} = require('../validators/auth.schema');

router.post('/login', validate(loginSchema), ah(ctrl.login));
router.post('/otp/request', validate(otpRequestSchema), ah(ctrl.requestOtp));
router.post('/otp/verify', validate(otpVerifySchema), ah(ctrl.verifyOtp));
router.get('/me', requireAuth, ah(ctrl.me));
router.post('/change-password', requireAuth, validate(changePasswordSchema), ah(ctrl.changePassword));

module.exports = router;
