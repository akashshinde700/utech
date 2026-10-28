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
const taskRoutes = require('./routes/task.routes');
const metalCalculatorRoutes = require('./routes/metalCalculator.routes');

const app = express();

// the API always sits behind a proxy in this deployment (sandbox Caddy/Next
// rewrites) — without this, express-rate-limit buckets every user under the
// proxy IP and audit logs record the wrong client
app.set('trust proxy', 1);

// security + parsing
app.use(helmet({
  frameguard: env.NODE_ENV === 'production' ? { action: 'sameorigin' } : false,
  contentSecurityPolicy: env.NODE_ENV === 'production'
    ? undefined
    : {
        useDefaults: true,
        directives: {
          frameAncestors: ["'self'", 'https://*.e2b.app', 'https://*.arena.ai'],
        },
      },
}));
app.use(cors({
  origin: env.NODE_ENV === 'production' ? env.CORS_ORIGIN : true,
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  // the automated suite issues hundreds of requests; request logging would bury
  // the test output. Real environments are unaffected.
  skip: () => env.NODE_ENV === 'test',
}));

// Rate limit the credential endpoints only. Mounting this on the whole
// /api/auth prefix also throttled GET /api/auth/me, which every page load
// calls to hydrate the profile: a few reloads and the app started showing
// 429s even though nobody was attempting a login.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'production' ? 50 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({
      error: 'TooManyRequests',
      message: 'Too many attempts. Please wait a few minutes and try again.',
    }),
});
app.use(['/api/auth/login', '/api/auth/otp/request', '/api/auth/otp/verify'], authLimiter);

// Business uploads are private. They are served only by the attachment and
// quotation-image APIs, which check authentication and document permissions.
// Never mount UPLOAD_DIR as a public static directory.

// This is a private business system on a public domain. robots.txt
// (frontend/public/robots.txt) asks crawlers to stay out; this header tells
// the ones that fetched a URL anyway not to index or follow it, which is the
// part robots.txt cannot do. It costs nothing and keeps the login page and
// /health out of search results.
app.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
});

// Exports and generated documents are the expensive endpoints: each one runs a
// wide query (capped at 5,000 rows) or renders a PDF, so they are the obvious
// way to tie up the single API process. A human runs a handful of reports in a
// sitting; a script runs thousands. This is the only global limit — an IP-wide
// cap on the whole API would be an outage waiting to happen, because the
// entire plant reaches the server from one NAT address.
const exportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: env.NODE_ENV === 'production' ? 60 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, res) =>
    res.status(429).json({
      error: 'TooManyRequests',
      message: 'Too many exports in a short time. Please wait a few minutes before downloading more.',
    }),
});
app.use('/api/reports', exportLimiter);

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
app.use('/api/tasks', taskRoutes);
app.use('/api/metal-calculator', metalCalculatorRoutes);

// frontend (static build served by this same process in production)
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^(?!\/api|\/uploads|\/health).*/, (req, res, next) => {
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) {
      if (req.path === '/') {
        return res.json({ ok: true, service: 'UTech ERP API', health: '/health' });
      }
      next();
    }
  });
});

// 404 + error
app.use(notFound);
app.use(errorHandler);

const port = env.PORT || 4000;
if (require.main === module) {
  (async () => {
    const prisma = require('./config/prisma');
    if (prisma._isInMemory) {
      const count = await prisma.user.count();
      if (count === 0) {
        const { seedDatabase } = require('../prisma/seed');
        await seedDatabase(prisma);
      }
    }
    const server = app.listen(port, '0.0.0.0', () => {
      console.log('UTech ERP API listening on http://0.0.0.0:' + port);
    });

    const shutdown = (sig) => {
      console.log(`Received ${sig}, shutting down gracefully...`);
      server.close(async () => {
        try {
          await prisma.$disconnect();
        } catch (_err) {
          // ignore disconnect errors during shutdown
        }
        process.exit(0);
      });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;
