'use strict';
const prisma = require('../config/prisma');
const dayjs = require('dayjs');
const { getLowStockItems } = require('../services/stockService');

async function summary(_req, res) {
  const since30 = dayjs().subtract(30, 'day').toDate();

  const [
    invoiceTotal,
    invoiceCount,
    jobcardActive,
    pendingJobwork,
    overdueInvoices,
    totalParties,
    totalItems,
    lowStockItems,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      _sum: { total: true },
      where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, date: { gte: since30 } },
    }),
    // match salesLast30Days: the money KPI excludes CANCELLED invoices, so the
    // count KPI must exclude them too (L3 — previously inconsistent)
    prisma.invoice.count({
      where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, date: { gte: since30 } },
    }),
    prisma.jobcard.count({ where: { status: { in: ['DRAFT', 'IN_PROGRESS'] } } }),
    prisma.jobworkChallan.count({ where: { status: { in: ['ISSUED', 'PARTIAL_RECEIVED'] } } }),
    prisma.invoice.count({
      where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } },
    }),
    prisma.party.count({ where: { isActive: true } }),
    prisma.item.count({ where: { isActive: true } }),
    getLowStockItems(prisma, { take: 10 }),
  ]);

  const [salesTrend, productionTrend, inventoryDistribution] = await Promise.all([
    salesTrendLast6Months(),
    productionTrendLast4Weeks(),
    inventoryDistributionByType(),
  ]);

  res.json({
    salesLast30Days: Number(invoiceTotal._sum.total || 0),
    invoicesLast30Days: invoiceCount,
    jobcardsActive: jobcardActive,
    pendingJobwork,
    overdueInvoices,
    totalParties,
    totalItems,
    lowStockItems,
    salesTrend,
    productionTrend,
    inventoryDistribution,
  });
}

// real, lightweight sales-by-month for the dashboard's overview chart (the
// dedicated Sales Analytics page has its own richer version of this)
async function salesTrendLast6Months() {
  const since = dayjs().subtract(5, 'month').startOf('month').toDate();
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, date: { gte: since } },
    select: { date: true, total: true },
  });
  const monthMap = new Map();
  for (let i = 5; i >= 0; i--) {
    const d = dayjs().subtract(i, 'month');
    monthMap.set(d.format('YYYY-MM'), { month: d.format('MMM'), sales: 0 });
  }
  for (const inv of invoices) {
    const key = dayjs(inv.date).format('YYYY-MM');
    if (monthMap.has(key)) monthMap.get(key).sales += Number(inv.total);
  }
  return [...monthMap.values()];
}

// real planned-vs-completed production quantity, last 4 calendar weeks
async function productionTrendLast4Weeks() {
  const since = dayjs().subtract(4, 'week').startOf('week').toDate();
  const batches = await prisma.productionBatch.findMany({
    where: { date: { gte: since } },
    select: { date: true, qtyPlanned: true, qtyProduced: true },
  });
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const start = dayjs().subtract(i, 'week').startOf('week');
    weeks.push({ label: `W${4 - i}`, start, end: start.add(7, 'day'), completed: 0, planned: 0 });
  }
  for (const b of batches) {
    const d = dayjs(b.date);
    const w = weeks.find((w) => d.isAfter(w.start) && d.isBefore(w.end));
    if (w) { w.planned += Number(b.qtyPlanned); w.completed += Number(b.qtyProduced); }
  }
  return weeks.map((w) => ({ week: w.label, planned: w.planned, completed: w.completed }));
}

// real item-count breakdown by type for the dashboard's inventory pie chart
async function inventoryDistributionByType() {
  const groups = await prisma.item.groupBy({
    by: ['type'],
    where: { isActive: true },
    _count: { _all: true },
  });
  return groups
    .filter((g) => g._count._all > 0)
    .map((g) => ({ name: g.type.replace('_', ' '), value: g._count._all }));
}

// real sales trend + top-products data for the Sales Analytics page — last
// 6 calendar months of ISSUED/PARTIALLY_PAID/PAID invoices, aggregated
// server-side so the frontend never has to fabricate numbers.
async function salesAnalytics(_req, res) {
  const activeStatuses = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];
  const sixMonthsAgo = dayjs().subtract(5, 'month').startOf('month').toDate();

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: activeStatuses }, date: { gte: sixMonthsAgo } },
    select: { date: true, total: true },
  });

  const monthMap = new Map();
  for (let i = 5; i >= 0; i--) {
    const d = dayjs().subtract(i, 'month');
    monthMap.set(d.format('YYYY-MM'), { month: d.format('MMM'), year: d.year(), sales: 0, invoices: 0 });
  }
  for (const inv of invoices) {
    const key = dayjs(inv.date).format('YYYY-MM');
    if (monthMap.has(key)) {
      const m = monthMap.get(key);
      m.sales += Number(inv.total);
      m.invoices += 1;
    }
  }
  const monthly = [...monthMap.values()];

  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];
  const growthPct = prev && prev.sales > 0 ? ((last.sales - prev.sales) / prev.sales) * 100 : 0;

  const totalSales = monthly.reduce((s, m) => s + m.sales, 0);
  const totalInvoices = monthly.reduce((s, m) => s + m.invoices, 0);
  const avgOrderValue = totalInvoices ? totalSales / totalInvoices : 0;

  const lineGroups = await prisma.invoiceLine.groupBy({
    by: ['itemId'],
    where: { itemId: { not: null }, invoice: { status: { in: activeStatuses }, date: { gte: sixMonthsAgo } } },
    _sum: { amount: true, qty: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: 5,
  });
  const itemsById = await prisma.item.findMany({
    where: { id: { in: lineGroups.map((g) => g.itemId) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(itemsById.map((i) => [i.id, i.name]));
  const topProducts = lineGroups.map((g) => ({
    name: nameMap.get(g.itemId) || 'Unknown item',
    sales: Number(g._sum.amount || 0),
    quantity: Number(g._sum.qty || 0),
  }));

  res.json({
    monthly, topProducts,
    totals: { totalSales, totalInvoices, avgOrderValue, growthPct },
  });
}

module.exports = { summary, salesAnalytics };
