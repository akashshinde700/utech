'use strict';
const prisma = require('../config/prisma');

/**
 * Write an audit log entry. By default failures are swallowed for legacy callers.
 * Critical callers can pass { required: true } inside their transaction so an
 * audit failure rolls back the business change. Payloads are truncated to 4KB.
 *
 * Pass the transaction client as `db` when calling inside a $transaction:
 * using the global client there asks the pool for a second connection while
 * the first is still held, which can deadlock a small pool (and did: job
 * challans/GRNs sat for 5s and died with "transaction expired").
 */
async function audit(req, action, entity, entityId = null, payload = null, db = prisma, { required = false } = {}) {
  try {
    let payloadStr = null;
    if (payload != null) {
      try {
        payloadStr = JSON.stringify(payload).slice(0, 4096);
      } catch (_) {
        payloadStr = String(payload).slice(0, 4096);
      }
    }
    await db.auditLog.create({
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
    if (required) throw e;
    console.error('[audit] failed:', e.message);
  }
}

module.exports = { audit };
