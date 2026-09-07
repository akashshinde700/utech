'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const env = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const roleRoutes = require('./routes/role.routes');
const partyRoutes = require('./routes/party.routes');
const itemRoutes = require('./routes/item.routes');
const machineRoutes = require('./routes/machine.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const quotationRoutes = require('./routes/quotation.routes');
const jobcardRoutes = require('./routes/jobcard.routes');
const jobworkRoutes = require('./routes/jobwork.routes');
const dispatchRoutes = require('./routes/dispatch.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const processRoutes = require('./routes/process.routes');
const qualityRoutes = require('./routes/quality.routes');
const projectRoutes = require('./routes/project.routes');
const expenseRoutes = require('./routes/expense.routes');
const purchaseRoutes = require('./routes/purchase.routes');
const grnRoutes = require('./routes/grn.routes');
const attachmentRoutes = require('./routes/attachment.routes');
const quotationTemplateRoutes = require('./routes/quotationTemplate.routes');
const reportRoutes = require('./routes/report.routes');
const salesReturnRoutes = require('./routes/salesReturn.routes');
const purchaseReturnRoutes = require('./routes/purchaseReturn.routes');
const backOrderRoutes = require('./routes/backOrder.routes');
const productionRoutes = require('./routes/production.routes');
const bomRoutes = require('./routes/bom.routes');
const tallyRoutes = require('./routes/tally.routes');
const notificationRoutes = require('./routes/notification.routes');
const customerMaterialRoutes = require('./routes/customerMaterial.routes');
const stockRoutes = require('./routes/stock.routes');
const departmentRoutes = require('./routes/department.routes');
const assignmentRoutes = require('./routes/assignment.routes');
const departmentSubCategoryRoutes = require('./routes/departmentSubCategory.routes');
const vendorWorkOrderRoutes = require('./routes/vendorWorkOrder.routes');

const app = express();

// the API always sits behind a proxy in this deployment (sandbox Caddy/Next
// rewrites) — without this, express-rate-limit buckets every user under the
// proxy IP and audit logs record the wrong client
app.set('trust proxy', 1);

// security + parsing
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// rate limit on auth
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));

// uploads (static)
app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR)));

// health
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/machines', machineRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/quotation-templates', quotationTemplateRoutes);
app.use('/api/jobcards', jobcardRoutes);
app.use('/api/jobwork', jobworkRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/processes', processRoutes);
app.use('/api/quality', qualityRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/purchase-orders', purchaseRoutes);
app.use('/api/grns', grnRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/sales-returns', salesReturnRoutes);
app.use('/api/purchase-returns', purchaseReturnRoutes);
app.use('/api/back-orders', backOrderRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/boms', bomRoutes);
app.use('/api/tally', tallyRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/customer-material', customerMaterialRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/department-subcategories', departmentSubCategoryRoutes);
app.use('/api/vendor-work-orders', vendorWorkOrderRoutes);

// frontend (static build served by this same process in production)
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^(?!\/api|\/uploads|\/health).*/, (req, res, next) => {
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) next();
  });
});

// 404 + error
app.use(notFound);
app.use(errorHandler);

const port = env.PORT || 4000;
if (require.main === module) {
  app.listen(port, () => {
    console.log('UTech ERP API listening on http://localhost:' + port);
  });
}

module.exports = app;
