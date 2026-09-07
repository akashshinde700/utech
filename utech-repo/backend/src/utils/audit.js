'use strict';
const prisma = require('../config/prisma');

/**
 * Write an audit log entry. Failure is swallowed so that audit cannot break
 * the main request. Truncate payload to 4KB to keep TEXT column light.
 */
async function audit(req, action, entity, entityId = null, payload = null) {
  try {
    let payloadStr = null;
    if (payload != null) {
      try {
        payloadStr = JSON.stringify(payload).slice(0, 4096);
      } catch (_) {
        payloadStr = String(payload).slice(0, 4096);
      }
    }
    await prisma.auditLog.create({
      data: {
        userId: req && req.user ? req.user.id : null,
        action,
        entity,
        entityId: entityId == null ? null : Number(entityId),
        payload: payloadStr,
        ip: req && req.ip ? req.ip : null,
      },
    });
  } catch (e) {
    console.error('[audit] failed:', e.message);
  }
}

module.exports = { audit };
