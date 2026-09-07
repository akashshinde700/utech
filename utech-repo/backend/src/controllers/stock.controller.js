'use strict';
const dayjs = require('dayjs');
const prisma = require('../config/prisma');
const HttpError = require('../utils/httpError');
const { audit } = require('../utils/audit');
const stockService = require('../services/stockService');

const ACTIVE_CUSTOMER_STATUSES = ['RECEIVED', 'IN_PROCESS', 'AT_VENDOR'];

// Centralized monitoring layer — reads across both inventories, never writes
// to either (writes only ever happen via moveCompanyStock/moveCustomerMaterial,
// called from the owning controllers, or the adjust() endpoint below which
// itself just calls moveCompanyStock).
async function summary(_req, res) {
  const startOfDay = dayjs().startOf('day').toDate();

  const [
    companyItemCount,
    companyStockValue,
    finishedGoodsCount,
    customerActiveLots,
    materialAtVendorLines,
    productionInProgress,
    customerInProcessLots,
    lowStockItems,
    todayGrnCount,
    todayCustomerInwardCount,
    todayDispatchCount,
    todayVendorDispatchCount,
  ] = await Promise.all([
    prisma.item.count({ where: { isActive: true } }),
    prisma.item.aggregate({ where: { isActive: true }, _sum: { currentStock: true } }),
    prisma.item.count({ where: { isActive: true, type: 'FINISHED' } }),
    prisma.customerMaterialLot.count({ where: { status: { in: ACTIVE_CUSTOMER_STATUSES } } }),
    prisma.jobworkLine.findMany({
      where: { challan: { status: { in: ['ISSUED', 'PARTIAL_RECEIVED'] } } },
      select: { qtySent: true, qtyReceived: true, challan: { select: { materialOwnerType: true } } },
    }),
    prisma.productionBatch.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.customerMaterialLot.count({ where: { status: 'IN_PROCESS' } }),
    stockService.getLowStockItems(prisma, { take: 10 }),
    prisma.gRN.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.customerMaterialLot.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.dispatchChallan.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.jobworkChallan.count({ where: { createdAt: { gte: startOfDay } } }),
  ]);

  // stock value = Σ currentStock × purchaseRate over active items (item master is
  // small; a qty×rate roll-up can't be done in a single Prisma aggregate)
  const valuationRows = await prisma.item.findMany({
    where: { isActive: true },
    select: { currentStock: true, purchaseRate: true },
  });
  const companyStockValue2 = valuationRows.reduce(
    (sum, it) => sum + Number(it.currentStock) * Number(it.purchaseRate || 0),
    0
  );

  const materialAtVendor = materialAtVendorLines.reduce(
    (acc, l) => {
      const outstanding = Number(l.qtySent) - Number(l.qtyReceived);
      if (l.challan.materialOwnerType === 'CUSTOMER') acc.customer += outstanding;
      else acc.company += outstanding;
      return acc;
    },
    { company: 0, customer: 0 }
  );

  res.json({
    companyInventory: {
      activeItems: companyItemCount,
      totalStockQty: Number(companyStockValue._sum.currentStock || 0),
      stockValue: companyStockValue2,
      finishedGoods: finishedGoodsCount,
      lowStockCount: lowStockItems.length,
    },
    customerInventory: {
      activeLots: customerActiveLots,
      inProcess: customerInProcessLots,
      atVendor: materialAtVendor.customer,
    },
    materialAtVendor,
    materialInProcess: productionInProgress + customerInProcessLots,
    lowStockItems,
    todayInward: todayGrnCount + todayCustomerInwardCount,
    todayOutward: todayDispatchCount + todayVendorDispatchCount,
    // No allocation/reservation flow exists anywhere in the app today (no sales
    // order holds, no stock commitments) — "available" is simply currentStock;
    // "reserved" is a placeholder until a real reservation flow is designed.
    reservedStock: 0,
  });
}

async function ledger(req, res) {
  const where = {};
  if (req.query.ownerType) where.ownerType = req.query.ownerType;
  if (req.query.itemId) where.itemId = parseInt(req.query.itemId, 10);
  if (req.query.customerMaterialLotId) where.customerMaterialLotId = parseInt(req.query.customerMaterialLotId, 10);
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  const rows = await prisma.stockLedger.findMany({
    where,
    include: {
      item: { select: { id: true, name: true, code: true } },
      customerMaterialLot: { select: { id: true, inwardNumber: true, materialDescription: true } },
    },
    orderBy: { date: 'desc' },
    take: 500,
  });
  res.json(rows);
}

// Manual adjustment — company stock only (customer material is corrected via
// its own lot edit/disposition endpoints, never a blind quantity override).
async function adjust(req, res) {
  const { itemId, qty, notes } = req.body;
  if (!itemId || !qty || Number(qty) === 0) throw new HttpError(400, 'itemId and a non-zero qty are required');
  const n = Number(qty);
  const ledgerRow = await prisma.$transaction((tx) =>
    stockService.moveCompanyStock({
      tx, itemId, refType: 'ADJUSTMENT',
      qtyIn: n > 0 ? n : 0, qtyOut: n < 0 ? -n : 0,
      notes: notes || 'Manual adjustment', skipAudit: true,
    })
  );
  await audit(req, 'adjust', 'Item', itemId, { qty: n, notes });
  res.status(201).json(ledgerRow);
}

module.exports = { summary, ledger, adjust };
