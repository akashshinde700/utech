'use strict';
const prisma = require('../config/prisma');

/**
 * Create an in-app notification for every active user whose role name is in
 * `roleNames`. Failure is swallowed, mirroring audit() — notifications must
 * never break the action that triggered them.
 */
async function notifyUsers(roleNames, { type, title, body = null, refType = null, refId = null }) {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true, role: { name: { in: roleNames } } },
      select: { id: true },
    });
    if (!users.length) return;
    await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id,
        type,
        title,
        body,
        refType,
        refId: refId == null ? null : Number(refId),
      })),
    });
  } catch (e) {
    console.error('[notify] failed:', e.message);
  }
}

module.exports = { notifyUsers };
