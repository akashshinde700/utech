'use strict';
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');

async function list(req, res) {
  const items = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(items);
}

async function unreadCount(req, res) {
  const count = await prisma.notification.count({ where: { userId: req.user.id, isRead: false } });
  res.json({ count });
}

async function markRead(req, res) {
  const id = parseInt(req.params.id, 10);
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n || n.userId !== req.user.id) throw new HttpError(404, 'Notification not found');
  await prisma.notification.update({ where: { id }, data: { isRead: true } });
  res.json({ ok: true });
}

async function markAllRead(req, res) {
  await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
  res.json({ ok: true });
}

module.exports = { list, unreadCount, markRead, markAllRead };
