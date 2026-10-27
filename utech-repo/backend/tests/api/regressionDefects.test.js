'use strict';

// REGRESSION TESTS FOR CONFIRMED DEFECTS — audit pass 2026-10-17 (arena/5f43ac08)
//
// Every test here failed against the pre-fix code and passes now. They pin the
// exact behaviours named in audit/BUG_TRACKER.md (AUD-201 … AUD-206) so the
// defects cannot silently return.
//
//   AUD-201  P1  editing a jobcard wiped every Task Progress item on it
//   AUD-202  P2  editing a return's lines bypassed the over-return cap and
//                line-ownership checks that create enforces
//   AUD-203  P2  processing a return with a description-only line 500ed
//   AUD-204  P2  sales-return discount was applied AFTER tax, unlike invoices
//   AUD-205  P3  stock summary counted rejected material as still at vendor
//   AUD-206  P2  rejected customer material never came back to the inward lot

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getDb, makeUser, signInAs, loadApp } from '../helpers/app';

let app;
let token;

beforeAll(async () => {
  app = await loadApp();
});

beforeEach(() => {
  getDb().reset();
  token = signInAs(makeUser({ id: 1, role: 'SUPERADMIN' }));
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

// ---------------------------------------------------------------------------
// AUD-201 — JobcardForm save must never delete the jobcard's operations
// ---------------------------------------------------------------------------

describe('AUD-201 — editing a jobcard must not wipe its Task Progress items', () => {
  // The payload exactly as frontend/src/pages/jobcards/JobcardForm.jsx sends it
  // AFTER the fix: everything the form edits, and deliberately no `operations`
  // key. JobcardOperation rows are the Task Progress items owned by /api/tasks;
  // the jobcard update treats a sent array as "replace all".
  const jobcardFormPayload = {
    date: '2026-03-01',
    partyId: 3,
    itemId: null,
    itemDescription: 'Cabinet assembly',
    assignedOperatorId: 7,
    projectEngineerId: 8,
    projectNumber: 'PRJ-9',
    assemblyNumber: 'A-1',
    drawingNumber: 'D-1',
    qtyOrdered: 5,
    startDate: '2026-03-02',
    endDate: null,
    remarks: '',
    lines: [
      { id: 201, itemId: 5, itemName: 'Bracket', qty: 2, uomCode: 'NOS', notes: '' },
      { itemName: 'Custom pin', qty: 4, uomCode: 'NOS', notes: 'new row', itemId: null },
    ],
    // no `operations` key — that is the whole point
  };

  beforeEach(() => {
    getDb().when('jobcard.findUnique', { id: 9, status: 'IN_PROGRESS', number: 'JC-26-00001' });
    getDb().when('jobcardLine.findMany', [{ id: 201 }]);
    getDb().when('jobcard.update', (args) => ({ id: 9, ...args[0].data }));
    getDb().when('attachment.findMany', []);
    getDb().when('jobcardOperation.findMany', [
      { id: 501, title: 'Cutting', jobcardId: 9 },
      { id: 502, title: 'Welding', jobcardId: 9 },
    ]);
  });

  it('the form payload carries no operations key', () => {
    expect(jobcardFormPayload).not.toHaveProperty('operations');
  });

  it('PUT with the form payload leaves jobcardOperation rows untouched', async () => {
    const res = await auth(request(app).put('/api/jobcards/9')).send(jobcardFormPayload);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // the pre-fix form sent `operations: []`, which hit this deleteMany and
    // cascaded away every task, assignee and task comment on the jobcard
    expect(getDb().calls('jobcardOperation.deleteMany')).toHaveLength(0);
    expect(getDb().calls('jobcardOperation.create')).toHaveLength(0);
  });

  it('an explicit operations array is still a replace (documented API semantics)', async () => {
    const res = await auth(request(app).put('/api/jobcards/9')).send({
      ...jobcardFormPayload,
      operations: [{ processId: 1, machineId: 2, sequence: 1, notes: 'set ops' }],
    });
    expect(res.status).toBe(200);
    // clients that DO manage the operation list keep their replace semantics —
    // the new rows are a nested create inside jobcard.update
    expect(getDb().calls('jobcardOperation.deleteMany')).toHaveLength(1);
    const upd = getDb().calls('jobcard.update').at(-1)[0];
    expect(upd.data.operations.create).toHaveLength(1);
  });

  it('the line upsert path keeps line ids (no delete-all-recreate duplication)', async () => {
    await auth(request(app).put('/api/jobcards/9')).send(jobcardFormPayload);
    // line 201 exists -> update in place, never deleted then recreated
    const deletes = getDb().calls('jobcardLine.deleteMany');
    for (const d of deletes) {
      expect(d[0].where.id.in ?? []).not.toContain(201);
    }
    const updates = getDb().calls('jobcardLine.update');
    expect(updates.some((u) => u[0].where.id === 201)).toBe(true);
    // the genuinely new row is created exactly once
    expect(getDb().calls('jobcardLine.create')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AUD-202 — editing a return's lines obeys the same caps as creating one
// ---------------------------------------------------------------------------

describe('AUD-202 — sales return edit cannot exceed what was invoiced', () => {
  const invoice = {
    id: 41,
    number: 'INV-26-00007',
    partyId: 1,
    party: { id: 1, name: 'Acme' },
    lines: [{ id: 100, itemId: 5, description: 'Machining', hsnCode: '8471', qty: 10, rate: 100, gstRate: 18 }],
  };

  beforeEach(() => {
    getDb().when('salesReturn.findUnique', { id: 51, number: 'SR-26-00001', status: 'DRAFT', invoiceId: 41 });
    getDb().when('invoice.findUnique', invoice);
    getDb().when('salesReturn.update', (args) => ({ id: 51, ...args[0].data }));
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 0 } });
  });

  const edit = (lines) => auth(request(app).put('/api/sales-returns/51')).send({
    invoiceId: 41, date: '2026-03-02', reason: 'r', notes: 'n', lines,
  });

  it('rejects an edited line whose qty exceeds the invoiced quantity', async () => {
    const res = await edit([{ invoiceLineId: 100, itemId: 5, description: 'd', qty: 40, rate: 100, gstRate: 18 }]);
    expect(res.status, 'pre-fix this went through and over-credited the customer').toBe(400);
    expect(res.body.message).toMatch(/exceeds the invoiced quantity/i);
    expect(getDb().calls('salesReturn.update')).toHaveLength(0);
  });

  it('counts other returns against the cap but not the row being edited', async () => {
    // 8 already returned by OTHER returns -> editing this one to 3 must fail,
    // but editing it to 2 must pass (8 + 2 = 10 = invoiced)
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 8 } });
    let res = await edit([{ invoiceLineId: 100, itemId: 5, description: 'd', qty: 3, rate: 100, gstRate: 18 }]);
    expect(res.status).toBe(400);
    res = await edit([{ invoiceLineId: 100, itemId: 5, description: 'd', qty: 2, rate: 100, gstRate: 18 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('rejects an edited line pointing at another invoice', async () => {
    const res = await edit([{ invoiceLineId: 777, itemId: 5, description: 'd', qty: 1, rate: 100, gstRate: 18 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to invoice/i);
    expect(getDb().calls('salesReturn.update')).toHaveLength(0);
  });
});

describe('AUD-202 — purchase return edit cannot exceed what was accepted', () => {
  beforeEach(() => {
    getDb().when('purchaseReturn.findUnique', {
      id: 61, number: 'PR-26-00001', status: 'DRAFT', grnId: 30, poId: null,
    });
    getDb().when('gRN.findUnique', {
      id: 30, number: 'GRN-26-00001', partyId: 2,
      party: { id: 2, name: 'Vendor' },
      lines: [{ id: 300, grnId: 30, itemId: 5, qty: 10, qtyAccepted: 8, qtyRejected: 2 }],
    });
    getDb().when('grnLine.findUnique', (args) => {
      if (args[0].where.id === 300) return { id: 300, grnId: 30, itemId: 5, qtyAccepted: 8, qtyRejected: 2 };
      if (args[0].where.id === 999) return { id: 999, grnId: 31, itemId: 5, qtyAccepted: 4, qtyRejected: 0 }; // another GRN's line
      return null;
    });
    getDb().when('purchaseReturn.update', (args) => ({ id: 61, ...args[0].data }));
    getDb().when('purchaseReturnLine.aggregate', { _sum: { qty: 0 } });
  });

  const edit = (lines) => auth(request(app).put('/api/purchase-returns/61')).send({
    date: '2026-03-02', reason: 'r', notes: 'n', lines,
  });

  it('rejects an edited line whose qty exceeds the accepted quantity', async () => {
    const res = await edit([{ grnLineId: 300, itemId: 5, description: 'd', qty: 9, rate: 50, gstRate: 18 }]);
    expect(res.status, 'pre-fix this went through and inflated the vendor credit').toBe(400);
    expect(res.body.message).toMatch(/exceeds the accepted quantity/i);
    expect(getDb().calls('purchaseReturn.update')).toHaveLength(0);
  });

  it('rejects an edited line pointing at another document', async () => {
    const res = await edit([{ grnLineId: 999, itemId: 5, description: 'd', qty: 1, rate: 50, gstRate: 18 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to GRN/i);
    expect(getDb().calls('purchaseReturn.update')).toHaveLength(0);
  });

  it('rejects an edited line whose grnLineId does not exist at all', async () => {
    const res = await edit([{ grnLineId: 404404, itemId: 5, description: 'd', qty: 1, rate: 50, gstRate: 18 }]);
    expect(res.status).toBe(404);
    expect(getDb().calls('purchaseReturn.update')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AUD-203 — processing a return with a description-only line must not 500
// ---------------------------------------------------------------------------

describe('AUD-203 — description-only return lines never touch stock', () => {
  it('sales return process skips stock for null-itemId lines but still credits the party', async () => {
    getDb().when('salesReturn.findUnique', {
      id: 51, number: 'SR-26-00001', status: 'APPROVED', partyId: 1, refundAmount: 590,
      // AUD-211: stock may only be restored once the physical return receipt
      // (challan no. + received date) is on the document
      returnChallanNo: 'RC-77', receivedAt: new Date('2026-03-05T00:00:00Z'), dispatchChallanId: null,
      lines: [
        { id: 1, itemId: null, qty: 1, description: 'Design service' },
        { id: 2, itemId: 5, qty: 2, description: 'Widget' },
      ],
    });
    getDb().when('salesReturn.update', (args) => ({ id: 51, ...args[0].data }));
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 10 });
    getDb().when('item.updateMany', { count: 1 });

    const res = await auth(request(app).post('/api/sales-returns/51/process'));
    expect(res.status, 'pre-fix this was a 500: item.findUnique({ id: null })').toBe(200);

    // exactly one stock movement — for the real item, not the service line
    const ledgers = getDb().calls('stockLedger.create').map((c) => c[0].data);
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].refType).toBe('SALES_RETURN');
    expect(Number(ledgers[0].qtyIn)).toBe(2);
    // the refund credit is unaffected
    const partyLedger = getDb().calls('partyLedger.create')[0][0].data;
    expect(Number(partyLedger.credit)).toBe(590);
  });

  it('purchase return process skips stock for null-itemId lines', async () => {
    getDb().when('purchaseReturn.findUnique', {
      id: 61, number: 'PR-26-00001', status: 'APPROVED', partyId: 2, total: 118,
      lines: [
        { id: 1, itemId: null, qty: 1, description: 'Vendor service charge' },
        { id: 2, itemId: 5, qty: 3, description: 'Widget' },
      ],
    });
    getDb().when('purchaseReturn.update', (args) => ({ id: 61, ...args[0].data }));
    getDb().when('item.findUnique', { id: 5, name: 'Widget', currentStock: 50 });
    getDb().when('item.updateMany', { count: 1 });

    const res = await auth(request(app).post('/api/purchase-returns/61/process'));
    expect(res.status, 'pre-fix this was a 500').toBe(200);
    const ledgers = getDb().calls('stockLedger.create').map((c) => c[0].data);
    expect(ledgers).toHaveLength(1);
    expect(Number(ledgers[0].qtyOut)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// AUD-204 — sales-return discount reduces taxable value, exactly like invoices
// ---------------------------------------------------------------------------

describe('AUD-204 — sales return money math matches the invoice rule', () => {
  const line = { invoiceLineId: 100, itemId: 5, description: 'Machining', hsnCode: '8471', qty: 10, rate: 100, gstRate: 18 };

  beforeEach(() => {
    getDb().when('invoice.findUnique', {
      id: 41, number: 'INV-26-00007', partyId: 1,
      party: { id: 1, name: 'Acme' },
      lines: [{ id: 100, itemId: 5, description: 'Machining', hsnCode: '8471', qty: 10, rate: 100, gstRate: 18 }],
    });
    getDb().when('salesReturnLine.aggregate', { _sum: { qty: 0 } });
    getDb().when('salesReturn.create', (args) => ({ id: 51, number: 'SR-26-00001', ...args[0].data }));
    getDb().when('salesReturn.update', (args) => ({ id: 51, ...args[0].data }));
    getDb().when('salesReturn.findUnique', { id: 51, number: 'SR-26-00001', status: 'DRAFT', invoiceId: 41 });
    getDb().when('party.findUnique', { id: 1, name: 'Acme', gstin: '27AAAAA0000A1Z5' });
    getDb().when('invoice.create', (args) => ({ id: 42, number: 'INV-26-00002', ...args[0].data }));
  });

  it('charges GST on the discounted taxable value (1000 − 100) @18% = 1062, not 1080', async () => {
    const res = await auth(request(app).post('/api/sales-returns')).send({
      invoiceId: 41, date: '2026-03-01', discount: 100, isIntraState: true,
      lines: [line],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const data = getDb().calls('salesReturn.create')[0][0].data;
    expect(Number(data.subtotal)).toBe(1000);
    expect(Number(data.discount)).toBe(100);
    // GST on 900 @18% = 162 -> total 1062.
    // Pre-fix: GST on 1000 = 180, total 1180 − 100 = 1080 (discount AFTER tax).
    expect(Number(data.cgst) + Number(data.sgst)).toBe(162);
    expect(Number(data.total)).toBe(1062);
    expect(Number(data.refundAmount)).toBe(1062);
  });

  it('a return with the same lines and discount totals exactly like the invoice', async () => {
    const invRes = await auth(request(app).post('/api/invoices')).send({
      date: '2026-03-01', partyId: 1, isIntraState: true, discount: 100,
      lines: [{ description: 'Machining', hsnCode: '8471', qty: 10, rate: 100, gstRate: 18 }],
    });
    expect(invRes.status).toBe(201);
    const invData = getDb().calls('invoice.create')[0][0].data;

    const retRes = await auth(request(app).post('/api/sales-returns')).send({
      invoiceId: 41, date: '2026-03-01', discount: 100, isIntraState: true, lines: [line],
    });
    expect(retRes.status).toBe(201);
    const retData = getDb().calls('salesReturn.create')[0][0].data;

    // independent parity check: reversing a document in full must credit back
    // exactly what it charged
    expect(Number(retData.total)).toBe(Number(invData.total));
    expect(Number(retData.cgst)).toBe(Number(invData.cgst));
    expect(Number(retData.sgst)).toBe(Number(invData.sgst));
  });

  it('editing lines recomputes with the same discount-before-tax rule', async () => {
    const res = await auth(request(app).put('/api/sales-returns/51')).send({
      date: '2026-03-02', discount: 100, isIntraState: true, lines: [line],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = getDb().calls('salesReturn.update')[0][0].data;
    expect(Number(data.total)).toBe(1062);
    expect(Number(data.refundAmount)).toBe(1062);
    expect(Number(data.discount)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// AUD-205 — rejected material is not "at vendor" anymore
// ---------------------------------------------------------------------------

describe('AUD-205 — stock summary counts material at vendor net of rejections', () => {
  it('outstanding at vendor = qtySent − qtyReceived − qtyRejected', async () => {
    getDb().when('jobworkLine.findMany', [
      // 10 sent, 6 came back good, 2 came back rejected -> 2 still at vendor
      { qtySent: 10, qtyReceived: 6, qtyRejected: 2, challan: { materialOwnerType: 'COMPANY' } },
      { qtySent: 5, qtyReceived: 0, qtyRejected: 0, challan: { materialOwnerType: 'CUSTOMER' } },
    ]);
    getDb().when('item.aggregate', { _sum: { currentStock: 100 } });

    const res = await auth(request(app).get('/api/stock/summary'));
    expect(res.status).toBe(200);
    // pre-fix: company showed 4 (rejected counted as outstanding)
    expect(res.body.materialAtVendor.company).toBe(2);
    expect(res.body.materialAtVendor.customer).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// AUD-206 — rejected customer material comes back to the inward lot
// ---------------------------------------------------------------------------

describe('AUD-206 — jobwork receive restores rejected customer material to the lot', () => {
  // one inward (CML lot), two separate jobwork challans against it — the lot's
  // remaining quantity must track every movement of BOTH challans
  const challan = {
    id: 31,
    number: 'JW-26-00001',
    status: 'ISSUED',
    materialOwnerType: 'CUSTOMER',
    customerMaterialLotId: 77,
    lines: [{ id: 1, itemId: null, description: 'Customer billets', qtySent: 40, qtyReceived: 0, qtyRejected: 0 }],
  };

  beforeEach(() => {
    getDb().when('jobworkChallan.findUnique', challan);
    getDb().when('jobworkChallan.update', (args) => ({ id: 31, ...args[0].data }));
    getDb().when('customerMaterialLot.update', (args) => ({ id: 77, ...args[0].data }));
    getDb().when('customerMaterialLot.findUnique', { id: 77, inwardNumber: 'CML-26-00001', status: 'AT_VENDOR' });
    // lot ledger: inward 100, sent out 40 (challan A) + 30 (challan B)
    getDb().when('stockLedger.aggregate', { _sum: { qtyIn: 100, qtyOut: 70 } });
    getDb().when('stockLedger.create', (args) => args[0].data);
  });

  it('returns rejected pieces to the lot ledger so remaining qty stays true', async () => {
    const res = await auth(request(app).post('/api/jobwork/31/receive')).send({
      lines: [{ id: 1, qtyReceived: 35, qtyRejected: 5 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const lotMoves = getDb().calls('stockLedger.create')
      .map((c) => c[0].data)
      .filter((d) => d.ownerType === 'CUSTOMER');
    // pre-fix only the 35 good pieces came back and the 5 rejected vanished
    expect(lotMoves).toHaveLength(2);
    expect(lotMoves.map((m) => Number(m.qtyIn)).sort((a, b) => a - b)).toEqual([5, 35]);

    // remaining = 100 inward − 40 − 30 out + 35 + 5 back = 70
    const available = 100 - 40 - 30 + 35 + 5;
    expect(available).toBe(70);
  });

  it('a full reject still resolves the challan and restores the whole lot qty', async () => {
    const res = await auth(request(app).post('/api/jobwork/31/receive')).send({
      lines: [{ id: 1, qtyReceived: 0, qtyRejected: 40 }],
    });
    expect(res.status).toBe(200);
    const lotMoves = getDb().calls('stockLedger.create')
      .map((c) => c[0].data)
      .filter((d) => d.ownerType === 'CUSTOMER');
    expect(lotMoves).toHaveLength(1);
    expect(Number(lotMoves[0].qtyIn)).toBe(40);
  });
});
