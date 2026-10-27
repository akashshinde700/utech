'use strict';

import { describe, expect, it } from 'vitest';
const { moveCustomerMaterial } = require('../../src/services/stockService');

// Models two transactions with stale reads unless the service requests an
// exclusive lot-row lock. This is a deterministic unit test of the locking
// protocol, not a substitute for an InnoDB integration test.
function competingTransactions() {
  const movements = [{ qtyIn: 100, qtyOut: 0 }];
  let tail = Promise.resolve();
  let waitingReaders = 0;
  let releaseReaders;
  const bothRead = new Promise((resolve) => { releaseReaders = resolve; });

  async function run(qtyOut) {
    let release;
    let locked = false;
    const tx = {
      async $queryRaw(strings) {
        expect(strings.join('?')).toMatch(/CustomerMaterialLot[\s\S]*FOR UPDATE/i);
        const previous = tail;
        tail = new Promise((resolve) => { release = resolve; });
        await previous;
        locked = true;
        return [{ id: 7 }];
      },
      customerMaterialLot: {
        async findUnique() { return { id: 7, inwardNumber: 'TEST-INWARD', itemId: null }; },
      },
      customerMaterialAllocation: { async aggregate() { return { _sum: { qty: 0, weight: 0 } }; } },
      stockLedger: {
        async aggregate() {
          const qtyIn = movements.reduce((sum, row) => sum + row.qtyIn, 0);
          const qtyOut = movements.reduce((sum, row) => sum + row.qtyOut, 0);
          if (!locked) {
            waitingReaders += 1;
            if (waitingReaders === 2) releaseReaders();
            await bothRead;
          }
          return { _sum: { qtyIn, qtyOut } };
        },
        async create({ data }) {
          movements.push({ qtyIn: Number(data.qtyIn), qtyOut: Number(data.qtyOut) });
          return data;
        },
      },
    };
    try {
      return await moveCustomerMaterial({ tx, lotId: 7, refType: 'CUSTOMER_CONSUMPTION', qtyOut });
    } finally {
      if (release) release();
    }
  }
  return { movements, run };
}

describe('customer-material concurrent movements', () => {
  it('serializes two competing issues so 100 cannot be spent twice', async () => {
    const db = competingTransactions();
    const results = await Promise.allSettled([db.run(60), db.run(60)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.message).toMatch(/Insufficient quantity/);
    expect(db.movements.reduce((sum, r) => sum + r.qtyIn - r.qtyOut, 0)).toBe(40);
  });
});
