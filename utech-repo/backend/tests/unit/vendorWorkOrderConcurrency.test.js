'use strict';

// Controlled two-transaction interleaving; simulates a row lock, not MySQL.
import { expect, it } from 'vitest';

it('serializes concurrent attempts to send one vendor work order', async () => {
  const state = { id: 1, number: 'VWO-TEST', partyId: 1, status: 'DRAFT', lines: [], party: { name: 'Vendor' } };
  let updates = 0;
  let lockTail = Promise.resolve();
  let observed = 0;
  let releaseReaders;
  const bothRead = new Promise((resolve) => { releaseReaders = resolve; });
  const db = {
    vendorWorkOrder: { findUnique: async () => ({ ...state }) },
    auditLog: { create: async () => ({}) },
    user: { findMany: async () => [] },
    notification: { createMany: async () => ({ count: 0 }) },
    $transaction: async (fn) => {
      let unlock = null;
      const tx = {
        $queryRaw: async () => {
          let release;
          const hold = new Promise((resolve) => { release = resolve; });
          const previous = lockTail;
          lockTail = hold;
          await previous;
          unlock = release;
          return [{ id: 1 }];
        },
        vendorWorkOrder: {
          findUnique: async () => {
            const snapshot = { ...state };
            // Without a row lock force both transactions to read DRAFT before
            // either writes, exposing a double-send race deterministically.
            if (!unlock) {
              observed += 1;
              if (observed === 2) releaseReaders();
              await bothRead;
            }
            return snapshot;
          },
          update: async ({ data }) => {
            updates += 1;
            Object.assign(state, data);
            return { ...state };
          },
        },
      };
      try { return await fn(tx); } finally { if (unlock) unlock(); }
    },
  };
  global.__prisma = db;
  const controller = require('../../src/controllers/vendorWorkOrder.controller');
  const req = { params: { id: '1' }, body: {}, user: { id: 1, role: 'SUPERADMIN' } };
  const res = () => ({ json: () => {} });
  const results = await Promise.allSettled([controller.send(req, res()), controller.send(req, res())]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect(updates).toBe(1);
});
