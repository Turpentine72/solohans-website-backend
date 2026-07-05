// backend/routes/pos.js
import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { createOrderFromCheckout, CheckoutError } from '../utils/checkout.js';
import { priceOrder, PricingError } from '../utils/pricing.js';
import { assertStockAvailable, StockError } from '../utils/stockEngine.js';
import Inventory from '../models/Inventory.js';
import createNotification from '../utils/createNotification.js';

const router = express.Router();

router.use(protect, requireRole('admin', 'storekeeper', 'cashier'));

// ─── LIVE PRICE PREVIEW (no stock mutation) ──────────────────────
router.post('/quote', async (req, res) => {
  try {
    const inv = await Inventory.getSingleton();
    const extrasCatalog = {};
    for (const [key, entry] of inv.extras.entries()) {
      extrasCatalog[key] = { label: entry.label, price: entry.price, usesPlastic: entry.usesPlastic };
    }
    const priced = priceOrder(req.body.cart, extrasCatalog);
    let stockOk = true;
    let stockMessage = '';
    try {
      await assertStockAvailable(priced);
    } catch (err) {
      if (err instanceof StockError) { stockOk = false; stockMessage = err.message; }
      else throw err;
    }
    res.json({ priced, stockOk, stockMessage });
  } catch (err) {
    if (err instanceof PricingError) return res.status(400).json({ message: err.message });
    res.status(500).json({ message: err.message });
  }
});

// ─── COMPLETE SALE (store checkout) ──────────────────────────────
// body: { cart: { mealPackages, extras }, paymentMethod, customerName, phone }
router.post('/checkout', async (req, res) => {
  try {
    const { cart, paymentMethod, customerName, phone, posSaleType, splitPayments } = req.body;
    // ✅ Never take staff identity from the request body — always the
    // authenticated session, so staff never manually enter their own name.
    const staffName = req.user?.name || req.user?.email || 'Staff';
    const staffUserId = req.user?.id;

    const { order, paymentTag } = await createOrderFromCheckout({
      cart,
      source: 'store',
      paymentMethod,
      splitPayments,
      staffName,
      staffUserId,
      customerName,
      phone,
      posSaleType,
      deliveryMethod: 'pickup', // in-store sale — no delivery zone involved
    });

    createNotification({
      type: 'new_order',
      message: `Store sale #${order.order_id} — ₦${order.totalAmount.toLocaleString()} (${paymentTag})`,
      relatedId: order._id,
    });

    res.status(201).json({ order, paymentTag });
  } catch (err) {
    if (err instanceof CheckoutError || err instanceof PricingError || err instanceof StockError) {
      return res.status(400).json({ message: err.message });
    }
    console.error('POS checkout error:', err);
    res.status(500).json({ message: err.message });
  }
});

export default router;