'use strict';
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ah = require('../utils/asyncHandler');
const ctrl = require('../controllers/notification.controller');

router.use(requireAuth);

router.get('/', ah(ctrl.list));
router.get('/unread-count', ah(ctrl.unreadCount));
router.post('/:id/read', ah(ctrl.markRead));
router.post('/read-all', ah(ctrl.markAllRead));

module.exports = router;
