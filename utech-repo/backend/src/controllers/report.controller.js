'use strict';
const { sendXlsx } = require('../utils/xlsx');
const prisma = require('../config/prisma');
const dayjs = require('dayjs');
const { audit } = require('../utils/audit');

// One workbook, one named sheet — the shape every export below needs.
// Returns the byte length so the caller can audit the export size.
async function send(res, rows, sheet, name) {
  const stamp = dayjs().format('YYYYMMDD-HHmm');
  return sendXlsx(res, { filename: `${name}-${stamp}.xlsx`, sheets: [{ name: sheet, rows }] });
}

async function invoices(req, res) {
  const where = {};
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  if (req.query.status) where.status = req.query.status;

  const rows = await prisma.invoice.findMany({
    where,
    include: { party: true },
    orderBy: { date: 'desc' },
    take: 5000,
  });

  const data = rows.map((r) => ({
    Number: r.number,
    Date: dayjs(r.date).format('DD-MM-YYYY'),
    Party: r.party ? r.party.name : '',
    GSTIN: r.party ? (r.party.gstin || '') : '',
    Status: r.status,
    Subtotal: Number(r.subtotal),
    CGST: Number(r.cgst),
    SGST: Number(r.sgst),
    IGST: Number(r.igst),
    Discount: Number(r.discount),
    Total: Number(r.total),
    Paid: Number(r.amountPaid),
    Balance: Number(r.total) - Number(r.amountPaid),
  }));

  audit(req, 'export', 'Invoice', null, { count: rows.length });
  await send(res, data, 'Invoices', 'invoices');
}

async function jobcards(req, res) {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  const rows = await prisma.jobcard.findMany({
    where, include: { party: true }, orderBy: { date: 'desc' },
  });
  const data = rows.map((r) => ({
    Number: r.number,
    Date: dayjs(r.date).format('DD-MM-YYYY'),
    Party: r.party ? r.party.name : '',
    Item: r.itemDescription || '',
    Ordered: Number(r.qtyOrdered),
    Produced: Number(r.qtyProduced),
    Rejected: Number(r.qtyRejected),
    Status: r.status,
  }));
  audit(req, 'export', 'Jobcard', null, { count: rows.length });
  await send(res, data, 'Jobcards', 'jobcards');
}

async function items(req, res) {
  const rows = await prisma.item.findMany({
    where: { isActive: true },
    include: { uom: true, category: true },
    orderBy: { name: 'asc' },
  });
  const data = rows.map((r) => ({
    Code: r.code,
    Name: r.name,
    Type: r.type,
    HSN: r.hsnCode || '',
    UoM: r.uom ? r.uom.code : '',
    Category: r.category ? r.category.name : '',
    'Purchase Rate': Number(r.purchaseRate || 0),
    'Sale Rate': Number(r.saleRate || 0),
    'GST %': Number(r.gstRate || 0),
    'Current Stock': Number(r.currentStock),
    'Min Stock': Number(r.minStock),
  }));
  audit(req, 'export', 'Item', null, { count: rows.length });
  await send(res, data, 'Items', 'items');
}

async function expenses(req, res) {
  const where = {};
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  if (req.query.category) where.category = req.query.category;

  const rows = await prisma.expense.findMany({
    where, include: { party: true }, orderBy: { date: 'desc' },
  });
  const data = rows.map((r) => ({
    Number: r.number,
    Date: dayjs(r.date).format('DD-MM-YYYY'),
    Category: r.category,
    Party: r.party ? r.party.name : '',
    Description: r.description,
    Amount: Number(r.amount),
    Tax: Number(r.taxAmount),
    Mode: r.paymentMode,
    Reference: r.reference || '',
  }));
  await send(res, data, 'Expenses', 'expenses');
}

async function partyLedger(req, res) {
  const partyId = parseInt(req.params.partyId, 10);
  const [party, entries] = await Promise.all([
    prisma.party.findUnique({ where: { id: partyId } }),
    prisma.partyLedger.findMany({ where: { partyId }, orderBy: { date: 'asc' } }),
  ]);
  if (!party) return res.status(404).json({ error: 'NotFound' });
  let bal = Number(party.openingBalance || 0);
  const data = entries.map((e) => {
    bal += Number(e.debit) - Number(e.credit);
    return {
      Date: dayjs(e.date).format('DD-MM-YYYY'),
      Type: e.refType,
      'Ref ID': e.refId || '',
      Debit: Number(e.debit),
      Credit: Number(e.credit),
      Balance: bal,
      Notes: e.notes || '',
    };
  });
  await send(res, data, 'Ledger', `${party.code}-ledger`);
}

async function customerStock(req, res) {
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.customerId) where.customerId = parseInt(req.query.customerId, 10);
  const rows = await prisma.customerMaterialLot.findMany({
    where, include: { customer: true, item: true }, orderBy: { receivedDate: 'desc' }, take: 5000,
  });
  const data = rows.map((r) => ({
    'Inward No': r.inwardNumber,
    Date: dayjs(r.receivedDate).format('DD-MM-YYYY'),
    Customer: r.customer ? r.customer.name : '',
    Material: r.materialDescription,
    Item: r.item ? r.item.name : '',
    'Heat No': r.heatNumber || '',
    'Lot No': r.lotNumber || '',
    Qty: Number(r.qty),
    Weight: r.weight != null ? Number(r.weight) : '',
    UoM: r.uomCode || '',
    Location: r.location || '',
    Status: r.status,
  }));
  audit(req, 'export', 'CustomerMaterialLot', null, { count: rows.length });
  await send(res, data, 'Customer Stock', 'customer-stock');
}

// vendor's current position is computed (qtySent - qtyReceived - qtyRejected)
// per open line, grouped by vendor — no separate stored "vendor inventory" table
async function vendorStock(req, res) {
  const where = { challan: { status: { in: ['ISSUED', 'PARTIAL_RECEIVED'] } } };
  if (req.query.ownerType) where.challan.materialOwnerType = req.query.ownerType;
  if (req.query.partyId) where.challan.partyId = parseInt(req.query.partyId, 10);
  const lines = await prisma.jobworkLine.findMany({
    where,
    include: {
      item: true,
      challan: { include: { party: true, customerMaterialLot: true } },
    },
  });
  const data = lines
    .map((l) => ({
      Vendor: l.challan?.party?.name || '',
      Challan: l.challan?.number || '',
      Date: dayjs(l.challan?.date).format('DD-MM-YYYY'),
      Owner: l.challan?.materialOwnerType || '',
      'Customer Lot': l.challan?.customerMaterialLot ? l.challan.customerMaterialLot.inwardNumber : '',
      Material: l.item ? l.item.name : (l.description || ''),
      Sent: Number(l.qtySent),
      Received: Number(l.qtyReceived),
      Rejected: Number(l.qtyRejected),
      Outstanding: Number(l.qtySent) - Number(l.qtyReceived) - Number(l.qtyRejected),
      Status: l.challan.status,
    }))
    .filter((r) => r.Outstanding > 0);
  audit(req, 'export', 'JobworkChallan', null, { count: data.length });
  await send(res, data, 'Vendor Stock', 'vendor-stock');
}

async function stockLedgerReport(req, res) {
  const where = {};
  if (req.query.ownerType) where.ownerType = req.query.ownerType;
  if (req.query.itemId) where.itemId = parseInt(req.query.itemId, 10);
  if (req.query.from || req.query.to) {
    where.date = {};
    if (req.query.from) where.date.gte = new Date(req.query.from);
    if (req.query.to) where.date.lte = new Date(req.query.to);
  }
  const rows = await prisma.stockLedger.findMany({
    where,
    include: { item: true, customerMaterialLot: true },
    orderBy: { date: 'desc' },
    take: 2000,
  });
  const data = rows.map((r) => ({
    Date: dayjs(r.date).format('DD-MM-YYYY'),
    Owner: r.ownerType,
    Item: r.item ? `${r.item.code} — ${r.item.name}` : '',
    'Customer Lot': r.customerMaterialLot ? r.customerMaterialLot.inwardNumber : '',
    Type: r.refType,
    'Ref ID': r.refId || '',
    In: Number(r.qtyIn),
    Out: Number(r.qtyOut),
    Balance: Number(r.balance),
    Notes: r.notes || '',
  }));
  audit(req, 'export', 'StockLedger', null, { count: rows.length });
  await send(res, data, 'Stock Ledger', 'stock-ledger');
}

module.exports = {
  invoices, jobcards, items, expenses, partyLedger,
  customerStock, vendorStock, stockLedgerReport,
};
