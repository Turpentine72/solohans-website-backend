import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import menuItemRoutes from './routes/menuItems.js';
import categoryRoutes from './routes/categories.js';
import orderRoutes from './routes/orders.js';
import contactRoutes from './routes/contacts.js';
import reviewRoutes from './routes/reviews.js';
import uploadRoutes from './routes/upload.js';
import transferRoutes from './routes/transfer.js';
import webhookRoutes from './routes/webhook.js';
import settingsRoutes from './routes/settings.js';
import notificationRoutes from './routes/notifications.js';
import paymentRoutes from './routes/payments.js';
import adminRoutes from './routes/admin.js';
import promoRoutes from './routes/promos.js';
import galleryRoutes from './routes/gallery.js';
import deliveryZoneRoutes from './routes/deliveryZones.js';
import staffRoutes from './routes/staff.js';
import attendanceRoutes from './routes/attendance.js';
import expenseRoutes from './routes/expenses.js';
import rolesRoutes from './routes/roles.js';
import stockRoutes from './routes/stock.js';
import reconciliationRoutes from './routes/reconciliation.js';
import auditLogRoutes from './routes/auditLog.js';

// ─── New: shared meal-combo inventory + POS + dashboard system ─────
import inventoryRoutes from './routes/inventory.js';
import posRoutes from './routes/pos.js';
import dashboardRoutes from './routes/dashboard.js';
import paymentReconciliationRoutes from './routes/paymentReconciliation.js';
import ingredientRoutes from './routes/ingredients.js';
import backupRoutes from './routes/backup.js';
import resetRoutes from './routes/reset.js';
import { maybeRunScheduledBackup } from './utils/backupEngine.js';

const app = express();

// ✅ This app runs behind a reverse proxy (Render). Without this, Express's
// req.ip returns the proxy's internal address for every single request —
// identical for every user — which would make IP-based rate limiting
// either useless (never triggers) or actively harmful (one shared bucket
// across every user, so unrelated users get locked out together).
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────
// Comma-separated list of allowed frontend origins, e.g.
// CLIENT_URL=https://project-2e90d.vercel.app,https://yourdomain.com
const allowedOrigins = [
  'http://localhost:5173',
  ...(process.env.CLIENT_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (curl, server-to-server, mobile apps)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow any Vercel preview/production deployment URL automatically
      if (/\.vercel\.app$/.test(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());

// ─────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/menu-items', menuItemRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/promos', promoRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/delivery-zones', deliveryZoneRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// ─── New: shared meal-combo inventory + POS + dashboard system ─────
app.use('/api/inventory', inventoryRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payment-reconciliation', paymentReconciliationRoutes);
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/backup', backupRoutes);
console.log('[startup] registered route: /api/backup');
app.use('/api/reset', resetRoutes);
console.log('[startup] registered route: /api/reset');

// ─────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Solohans backend is running',
  });
});

// ─────────────────────────────────────────────────────────
// Connect DB + Start Server
// ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    // ✅ Automatic Backup — checked hourly, actually runs only when the
    // configured daily/weekly/monthly interval has elapsed. Dependency-free
    // (no cron package) since this business doesn't need sub-hour precision.
    console.log('[backup-scheduler] initializing — will check every hour whether a scheduled backup is due');
    const runScheduleCheck = () => {
      console.log(`[backup-scheduler] running check at ${new Date().toISOString()}`);
      maybeRunScheduledBackup()
        .then(() => console.log('[backup-scheduler] check complete'))
        .catch((err) => console.error('❌ [backup-scheduler] Scheduled backup check failed:', err));
    };
    runScheduleCheck();
    setInterval(runScheduleCheck, 60 * 60 * 1000);
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ─────────────────────────────────────────────────────────
// 404 — must come after every route is registered, before the error
// handler. Without this, a request to a route that genuinely doesn't
// exist (e.g. a deploy missing a route file) falls through to Express's
// own default HTML 404 page — which isn't JSON, and on the frontend
// shows up as a generic, undiagnosable "API error" instead of clearly
// saying which route was missing.
app.use('/api', (req, res) => {
  console.error(`❌ 404 — no route matched: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: `No route matched ${req.method} ${req.originalUrl}. Check that this route is registered in server.js and was actually deployed.` });
});

// ─────────────────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  // ✅ Always log the full error server-side (visible in Render logs) —
  // previously this handler discarded err.message entirely and returned
  // a hardcoded generic string, so any error that escaped a route's own
  // try/catch was completely undiagnosable from the client-facing
  // response. Now the real message is both logged AND returned.
  console.error(`❌ Unhandled error on ${req.method} ${req.originalUrl}:`, err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// ✅ Catch anything that escapes Express entirely (a truly unhandled
// promise rejection or synchronous throw outside any request). Without
// this, such an error crashes the process with no trace in the logs.
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
});