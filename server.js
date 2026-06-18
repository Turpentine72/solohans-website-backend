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

const app = express();

// ───────────────────────────────
// Allowed Origins
// ───────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',

  ...(process.env.CLIENT_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
];

// ───────────────────────────────
// CORS (ONLY ONCE)
// ───────────────────────────────
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log('Blocked Origin:', origin);

      return callback(
        new Error(`Origin not allowed: ${origin}`)
      );
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
    ],
  })
);

app.use(express.json());

// ───────────────────────────────
// Routes
// ───────────────────────────────
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

// ───────────────────────────────
// Health Check
// ───────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Solohans backend is running',
  });
});

// ───────────────────────────────
// Start Server
// ───────────────────────────────
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ───────────────────────────────
// Error Handler
// ───────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});