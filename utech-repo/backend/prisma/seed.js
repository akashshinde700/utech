'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
// same GST math the invoice controller uses, so seed totals are computed
// exactly the way live invoices are (no hand-written header totals)
const { calcLineAmount, calcTaxes, round2 } = require('../src/utils/gst');
const prisma = new PrismaClient();

const MODULES = [
  'user', 'role', 'party', 'item', 'machine', 'process',
  'invoice', 'quotation', 'jobcard', 'jobwork', 'dispatch',
  'purchase', 'grn', 'quality', 'project', 'bom', 'expense',
  'attachment', 'report', 'customerMaterial', 'stock', 'department',
  'departmentSubcategory', 'assignment', 'vendorWorkOrder',
];
const ACTIONS = ['create', 'read', 'update', 'delete'];

async function main() {
  console.log('Seeding permissions...');
  for (const m of MODULES) {
    for (const a of ACTIONS) {
      const key = m + '.' + a;
      await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, module: m, action: a },
      });
    }
  }
  // non-CRUD actions the routes gate on (H1): without these rows only
  // SUPERADMIN (who bypasses checks entirely) could complete jobcards or
  // adjust stock
  await prisma.permission.upsert({
    where: { key: 'jobcard.progress' },
    update: {},
    create: { key: 'jobcard.progress', module: 'jobcard', action: 'progress' },
  });
  await prisma.permission.upsert({
    where: { key: 'stock.adjust' },
    update: {},
    create: { key: 'stock.adjust', module: 'stock', action: 'adjust' },
  });

  console.log('Seeding roles...');
  const allPerms = await prisma.permission.findMany();
  const superadmin = await prisma.role.upsert({
    where: { name: 'SUPERADMIN' },
    update: { hierarchyLevel: 0 },
    create: { name: 'SUPERADMIN', description: 'Full access', isSystem: true, hierarchyLevel: 0 },
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: superadmin.id } });
  await prisma.rolePermission.createMany({
    data: allPerms.map((p) => ({ roleId: superadmin.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  const manager = await prisma.role.upsert({
    where: { name: 'MANAGER' },
    update: {},
    create: { name: 'MANAGER', description: 'Operations manager', isSystem: false },
  });
  const managerMods = ['party', 'item', 'invoice', 'quotation', 'jobcard',
    'jobwork', 'dispatch', 'machine', 'process', 'purchase', 'grn',
    'quality', 'project', 'expense', 'attachment', 'report', 'customerMaterial', 'stock',
    'vendorWorkOrder'];
  // jobcard.delete (project delete) is Super Admin/Admin only; the special
  // non-CRUD grants (jobcard.progress / stock.adjust) follow their own lists
  const managerPerms = allPerms.filter((p) =>
    managerMods.includes(p.module) &&
    !(p.module === 'jobcard' && p.action === 'delete') &&
    !(p.module === 'jobcard' && p.action === 'progress') &&
    !(p.module === 'stock' && p.action === 'adjust')
  );
  await prisma.rolePermission.deleteMany({ where: { roleId: manager.id } });
  await prisma.rolePermission.createMany({
    data: managerPerms.map((p) => ({ roleId: manager.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  const operator = await prisma.role.upsert({
    where: { name: 'OPERATOR' },
    update: { hierarchyLevel: 6, requiresDepartment: true },
    create: { name: 'OPERATOR', description: 'Shopfloor operator', isSystem: false, hierarchyLevel: 6, requiresDepartment: true },
  });
  const operatorPerms = allPerms.filter((p) =>
    (p.module === 'jobcard' && ['read', 'update'].includes(p.action)) ||
    (p.module === 'jobcard' && p.action === 'progress') ||
    (p.module === 'item' && p.action === 'read') ||
    (p.module === 'quality' && ['create', 'read'].includes(p.action)) ||
    (p.module === 'assignment' && ['read', 'update'].includes(p.action))
  );
  await prisma.rolePermission.deleteMany({ where: { roleId: operator.id } });
  await prisma.rolePermission.createMany({
    data: operatorPerms.map((p) => ({ roleId: operator.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  console.log('Seeding department hierarchy roles...');
  const HIERARCHY_ROLES = [
    { name: 'Admin', description: 'Organization administrator', hierarchyLevel: 1, requiresDepartment: false, scopeToDepartment: false },
    { name: 'Plant Head', description: 'Oversees the entire plant across all departments', hierarchyLevel: 2, requiresDepartment: false, scopeToDepartment: false },
    { name: 'Project Engineer', description: 'Manages projects across departments', hierarchyLevel: 3, requiresDepartment: false, scopeToDepartment: false },
    { name: 'Department Head', description: 'Heads a single department', hierarchyLevel: 4, requiresDepartment: true, scopeToDepartment: true },
    { name: 'Supervisor', description: 'Supervises operators within a department', hierarchyLevel: 5, requiresDepartment: true, scopeToDepartment: true },
    { name: 'Team Leader', description: 'Leads a team within a department', hierarchyLevel: 5, requiresDepartment: true, scopeToDepartment: true },
  ];
  const hierarchyRoleRows = {};
  for (const r of HIERARCHY_ROLES) {
    hierarchyRoleRows[r.name] = await prisma.role.upsert({ where: { name: r.name }, update: r, create: r });
  }

  console.log('Seeding hierarchy role permissions...');
  async function grant(roleName, perms) {
    const role = hierarchyRoleRows[roleName];
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  const adminMods = ['party', 'item', 'invoice', 'quotation', 'jobcard', 'jobwork',
    'dispatch', 'machine', 'process', 'purchase', 'grn', 'quality', 'project',
    'expense', 'attachment', 'report', 'customerMaterial', 'stock', 'user', 'department',
    'departmentSubcategory', 'assignment', 'vendorWorkOrder'];
  await grant('Admin', allPerms.filter((p) => adminMods.includes(p.module)));
  await grant('Plant Head', allPerms.filter((p) => p.action === 'read'));
  // jobcard.delete (project delete) is Super Admin/Admin only; the special
  // jobcard.progress grant follows its own role list (Operator and the
  // department-scoped roles), so Project Engineer is excluded here too
  await grant('Project Engineer', allPerms.filter((p) =>
    (['jobcard', 'quotation', 'project'].includes(p.module) && !(p.module === 'jobcard' && ['delete', 'progress'].includes(p.action))) ||
    (p.module === 'invoice' && p.action === 'read') ||
    (p.module === 'user' && p.action === 'read') ||
    (['department', 'departmentSubcategory'].includes(p.module) && p.action === 'read') ||
    (p.module === 'assignment' && ['create', 'read', 'update'].includes(p.action)) ||
    // the Project Engineer starts every chain, so they must be able to see how
    // far a scope travelled — including out to an external vendor and back
    (p.module === 'vendorWorkOrder' && p.action === 'read') ||
    (['purchase', 'grn'].includes(p.module) && p.action === 'read')
  ));
  const deptScopedPerms = allPerms.filter((p) =>
    (p.module === 'user' && ['read', 'update'].includes(p.action)) ||
    (p.module === 'jobcard' && ['read', 'update'].includes(p.action)) ||
    (p.module === 'jobcard' && p.action === 'progress') ||
    (p.module === 'department' && p.action === 'read') ||
    (p.module === 'departmentSubcategory' && p.action === 'read') ||
    (p.module === 'assignment' && ['create', 'read', 'update'].includes(p.action)) ||
    // every department can see the work its own people sent outside (the
    // controller scopes rows to the caller's departmentId); only the Head below
    // can actually issue it
    (p.module === 'vendorWorkOrder' && p.action === 'read')
  );
  // The Department Head owns the hand-off to an external vendor end to end —
  // Vendor Development is the department this exists for: pick the vendor, issue
  // the work order (optionally issuing material with it), raise the purchase
  // order the vendor invoices against, and book the parts back in on a GRN.
  const deptHeadPerms = allPerms.filter((p) =>
    deptScopedPerms.includes(p) ||
    (p.module === 'vendorWorkOrder' && ['create', 'update'].includes(p.action)) ||
    (['party', 'item'].includes(p.module) && p.action === 'read') ||
    (p.module === 'jobwork' && p.action === 'read') ||
    (['purchase', 'grn'].includes(p.module) && ['create', 'read'].includes(p.action))
  );
  await grant('Department Head', deptHeadPerms);
  await grant('Supervisor', deptScopedPerms);
  await grant('Team Leader', deptScopedPerms);

  console.log('Seeding departments...');
  const DEPARTMENTS = [
    { name: 'Fabrication', code: 'FAB' },
    { name: 'Machining', code: 'MACH' },
    { name: 'CNC/VMC', code: 'CNCVMC' },
    { name: 'Vendor Development', code: 'VDEV' },
    { name: 'Quality', code: 'QC' },
  ];
  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({ where: { name: d.name }, update: {}, create: d });
  }

  console.log('Seeding admin user...');
  // C9: the password hash is only set on CREATE — re-seeding must never reset
  // a (possibly changed) admin password back to the default credential
  const passwordHash = await bcrypt.hash('Admin@123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@utech.local' },
    update: { roleId: superadmin.id, isActive: true },
    create: {
      email: 'admin@utech.local',
      name: 'System Admin',
      passwordHash,
      roleId: superadmin.id,
    },
  });

  console.log('Seeding UoM + categories...');
  const uoms = [
    { code: 'PCS', name: 'Pieces' },
    { code: 'KG', name: 'Kilograms' },
    { code: 'MTR', name: 'Meters' },
    { code: 'LTR', name: 'Litres' },
    { code: 'SET', name: 'Set' },
  ];
  for (const u of uoms) {
    await prisma.uom.upsert({ where: { code: u.code }, update: {}, create: u });
  }
  for (const name of ['Steel', 'Plastic', 'Hardware', 'Service']) {
    await prisma.itemCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  console.log('Seeding sample parties...');

  const sampleParties = [
    { code: 'P-0001', name: 'Sample Customer Pvt Ltd', type: 'CUSTOMER', gstin: '27AAPFU0939F1Z5', city: 'Pune', state: 'Maharashtra', country: 'India', phone: '9999999999' },
    { code: 'P-0002', name: 'ABC Engineering', type: 'CUSTOMER', gstin: '27AAZPK1234B1ZP', city: 'Mumbai', state: 'Maharashtra', country: 'India', phone: '8888888888' },
    { code: 'P-0003', name: 'XYZ Traders', type: 'VENDOR', gstin: '27AAEPM1234F1ZL', city: 'Nagpur', state: 'Maharashtra', country: 'India', phone: '7777777777' },
    { code: 'P-0004', name: 'Omega Supplies', type: 'VENDOR', gstin: '27AAECT1234M1ZV', city: 'Nashik', state: 'Maharashtra', country: 'India', phone: '6666666666' },
    { code: 'P-0005', name: 'Nova Components', type: 'CUSTOMER', gstin: '27AABCN1234H1ZS', city: 'Aurangabad', state: 'Maharashtra', country: 'India', phone: '5555555555' },
    { code: 'P-0006', name: 'Delta Manufacturing', type: 'BOTH', gstin: '27AABCD1234E1ZA', city: 'Nashik', state: 'Maharashtra', country: 'India', phone: '4444444444' },
    { code: 'P-0007', name: 'Prime Logistics', type: 'VENDOR', gstin: '27AAAPL1234F1ZQ', city: 'Pune', state: 'Maharashtra', country: 'India', phone: '3333333333' },
    { code: 'P-0008', name: 'Aquila Tech', type: 'CUSTOMER', gstin: '27AAATC1234G1ZM', city: 'Mumbai', state: 'Maharashtra', country: 'India', phone: '2222222222' },
    { code: 'P-0009', name: 'Sigma Parts', type: 'VENDOR', gstin: '27AAASC1234K1ZN', city: 'Nashik', state: 'Maharashtra', country: 'India', phone: '1111111111' },
    { code: 'P-0010', name: 'Vertex Projects', type: 'CUSTOMER', gstin: '27AABVT1234L1ZJ', city: 'Pune', state: 'Maharashtra', country: 'India', phone: '1234567890' },
  ];

  for (const party of sampleParties) {
    await prisma.party.upsert({ where: { code: party.code }, update: {}, create: party });
  }

  console.log('Seeding sample items...');
  const pcs = await prisma.uom.findUnique({ where: { code: 'PCS' } });
  const kg = await prisma.uom.findUnique({ where: { code: 'KG' } });
  const mtr = await prisma.uom.findUnique({ where: { code: 'MTR' } });
  const ltr = await prisma.uom.findUnique({ where: { code: 'LTR' } });
  const setUom = await prisma.uom.findUnique({ where: { code: 'SET' } });

  const sampleItems = [
    { code: 'IT-0001', name: 'Sample Finished Component', type: 'FINISHED', hsnCode: '7308', saleRate: 1500, purchaseRate: 900, gstRate: 18, openingStock: 10, currentStock: 10, minStock: 2, uomId: pcs?.id },
    { code: 'IT-0002', name: 'Steel Rod 10mm', type: 'RAW_MATERIAL', hsnCode: '7224', saleRate: 220, purchaseRate: 170, gstRate: 18, openingStock: 200, currentStock: 180, minStock: 20, uomId: mtr?.id },
    { code: 'IT-0003', name: 'Plastic Spacer Set', type: 'CONSUMABLE', hsnCode: '3926', saleRate: 450, purchaseRate: 320, gstRate: 18, openingStock: 150, currentStock: 145, minStock: 25, uomId: setUom?.id },
    { code: 'IT-0004', name: 'Aluminium Sheet 2mm', type: 'RAW_MATERIAL', hsnCode: '7606', saleRate: 680, purchaseRate: 520, gstRate: 18, openingStock: 90, currentStock: 80, minStock: 15, uomId: mtr?.id },
    { code: 'IT-0005', name: 'Precision Washer', type: 'FINISHED', hsnCode: '7318', saleRate: 15, purchaseRate: 8, gstRate: 18, openingStock: 500, currentStock: 470, minStock: 50, uomId: pcs?.id },
    { code: 'IT-0006', name: 'Motor Assembly', type: 'SEMI_FINISHED', hsnCode: '8501', saleRate: 5600, purchaseRate: 4200, gstRate: 18, openingStock: 25, currentStock: 20, minStock: 5, uomId: setUom?.id },
    { code: 'IT-0007', name: 'Chemical Coolant', type: 'CONSUMABLE', hsnCode: '3814', saleRate: 320, purchaseRate: 210, gstRate: 18, openingStock: 80, currentStock: 72, minStock: 12, uomId: ltr?.id },
    { code: 'IT-0008', name: 'Control Panel', type: 'FINISHED', hsnCode: '8537', saleRate: 12400, purchaseRate: 9400, gstRate: 18, openingStock: 12, currentStock: 10, minStock: 3, uomId: setUom?.id },
    { code: 'IT-0009', name: 'Bearing Kit', type: 'FINISHED', hsnCode: '8482', saleRate: 780, purchaseRate: 600, gstRate: 18, openingStock: 90, currentStock: 88, minStock: 15, uomId: pcs?.id },
    { code: 'IT-0010', name: 'Inspection Service', type: 'SERVICE', hsnCode: '9987', saleRate: 4500, purchaseRate: 0, gstRate: 18, openingStock: 0, currentStock: 0, minStock: 0, uomId: pcs?.id },
  ];

  for (const item of sampleItems) {
    await prisma.item.upsert({ where: { code: item.code }, update: {}, create: item });
  }

  console.log('Seeding sample invoices...');
  const parties = await prisma.party.findMany({ where: { code: { in: ['P-0001','P-0002','P-0005','P-0008','P-0010'] } } });
  const items = await prisma.item.findMany({ where: { code: { in: ['IT-0001','IT-0002','IT-0005','IT-0007','IT-0008','IT-0009'] } } });
  const partyMap = Object.fromEntries(parties.map((p) => [p.code, p]));
  const itemMap = Object.fromEntries(items.map((i) => [i.code, i]));

  // Header money fields are NOT written here — subtotal/cgst/sgst/igst/total
  // are computed from each invoice's `lines` with the same calcTaxes() the
  // invoice controller uses, and amountPaid/status are derived from real
  // InvoicePayment rows in the reconcile step below. All seeded invoices are
  // intra-state (CGST+SGST, igst 0).
  const invoiceData = [
    { number: 'INV-1001', partyCode: 'P-0001', date: new Date(), dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000), status: 'ISSUED', discount: 0, notes: 'Monthly supply invoice',
      lines: [{ itemCode: 'IT-0001', description: 'Sample Finished Component supply', qty: 12, rate: 1500, gstRate: 18 }],
      payments: [{ amount: 5000, mode: 'BANK', reference: 'PAY-1001' }] },
    { number: 'INV-1002', partyCode: 'P-0002', date: new Date(), dueDate: new Date(Date.now() + 10 * 24 * 3600 * 1000), status: 'ISSUED', discount: 0, notes: 'Engineering order part supply',
      lines: [{ itemCode: 'IT-0009', description: 'Bearing Kit supply', qty: 10, rate: 760, gstRate: 18 }],
      payments: [{ amount: 3000, mode: 'UPI', reference: 'PAY-1002' }] },
    { number: 'INV-1003', partyCode: 'P-0005', date: new Date(), dueDate: new Date(Date.now() + 5 * 24 * 3600 * 1000), status: 'ISSUED', discount: 0, notes: 'Custom component order',
      lines: [{ itemCode: 'IT-0005', description: 'Precision Washer bulk supply', qty: 300, rate: 14, gstRate: 18 }],
      payments: [] },
    { number: 'INV-1004', partyCode: 'P-0008', date: new Date(), dueDate: new Date(Date.now() + 14 * 24 * 3600 * 1000), status: 'DRAFT', discount: 0, notes: 'Control panel quotation workflow',
      lines: [{ itemCode: 'IT-0008', description: 'Control Panel (quotation workflow)', qty: 1, rate: 12400, gstRate: 18 }],
      payments: [] },
    { number: 'INV-1005', partyCode: 'P-0010', date: new Date(), dueDate: new Date(Date.now() + 12 * 24 * 3600 * 1000), status: 'ISSUED', discount: 0, notes: 'Project services invoice',
      lines: [{ itemCode: 'IT-0001', description: 'Project services — component supply', qty: 17, rate: 1500, gstRate: 18 }],
      payments: [{ amount: 15000, mode: 'BANK', reference: 'PAY-1005' }] },
  ];

  for (const inv of invoiceData) {
    const party = partyMap[inv.partyCode];
    if (!party) continue;
    const { partyCode, lines, payments, status, ...invoicePayload } = inv;

    const taxes = calcTaxes(lines);
    const total = round2(taxes.total - Number(inv.discount || 0));
    // status consistent with the payment rows we are about to create
    const specPaid = round2((payments || []).reduce((s, p) => s + Number(p.amount), 0));
    const specStatus = specPaid > 0 ? (specPaid >= total ? 'PAID' : 'PARTIALLY_PAID') : status;

    const invoice = await prisma.invoice.upsert({
      where: { number: inv.number },
      // update leaves the money fields alone — they are reconciled from the
      // invoice's actual lines/payments below (never hand-written)
      update: { ...invoicePayload, partyId: party.id },
      create: {
        ...invoicePayload, status: specStatus, partyId: party.id,
        subtotal: taxes.subtotal, cgst: taxes.cgst, sgst: taxes.sgst, igst: taxes.igst,
        discount: inv.discount || 0, total,
      },
    });

    const existingLine = await prisma.invoiceLine.findFirst({ where: { invoiceId: invoice.id } });
    if (!existingLine) {
      for (const l of lines) {
        await prisma.invoiceLine.create({
          data: {
            invoiceId: invoice.id,
            itemId: itemMap[l.itemCode]?.id || null,
            description: l.description,
            qty: l.qty,
            rate: l.rate,
            gstRate: l.gstRate,
            amount: calcLineAmount(l.qty, l.rate),
          },
        });
      }
    }

    // payment rows are only created when the invoice has none, so re-runs
    // never duplicate payments recorded through the app after seeding
    const paymentCount = await prisma.invoicePayment.count({ where: { invoiceId: invoice.id } });
    if (paymentCount === 0 && (payments || []).length > 0) {
      await prisma.invoicePayment.createMany({
        data: payments.map((p) => ({
          invoiceId: invoice.id,
          date: invoice.date,
          amount: p.amount,
          mode: p.mode,
          reference: p.reference || null,
        })),
      });
    }

    // reconcile: denormalized header totals are recomputed from the invoice's
    // ACTUAL lines (legacy DBs keep whatever lines they already have) and
    // amountPaid/status from its ACTUAL payment rows
    const [dbLines, paidAgg] = await Promise.all([
      prisma.invoiceLine.findMany({ where: { invoiceId: invoice.id } }),
      prisma.invoicePayment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } }),
    ]);
    const dbTaxes = calcTaxes(dbLines, !(Number(invoice.igst) > 0));
    const dbTotal = round2(dbTaxes.total - Number(invoice.discount || 0));
    const paid = round2(paidAgg._sum.amount || 0);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        subtotal: dbTaxes.subtotal,
        cgst: dbTaxes.cgst,
        sgst: dbTaxes.sgst,
        igst: dbTaxes.igst,
        total: dbTotal,
        amountPaid: paid,
        status: paid > 0 ? (paid >= dbTotal ? 'PAID' : 'PARTIALLY_PAID') : invoice.status,
      },
    });
  }

  console.log('Seeding sample shifts...');
  const sampleShifts = [
    { code: 'SHIFT-1', name: 'Morning Shift', startTime: '06:00', endTime: '14:00', isActive: true },
    { code: 'SHIFT-2', name: 'Evening Shift', startTime: '14:00', endTime: '22:00', isActive: true },
    { code: 'SHIFT-3', name: 'Night Shift', startTime: '22:00', endTime: '06:00', isActive: true },
  ];

  for (const shift of sampleShifts) {
    await prisma.shift.upsert({ where: { code: shift.code }, update: {}, create: shift });
  }

  console.log('Done. Login with admin@utech.local / Admin@123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
