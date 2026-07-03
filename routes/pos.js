// backend/routes/pos.js
import express from 'express';
import { protect } from '../middleware/auth.js';
import { createOrderFromCheckout, CheckoutError } from '../utils/checkout.js';
import { priceOrder, PricingError, DEFAULT_EXTRAS_CATALOG } from '../utils/pricing.js';
import { assertStockAvailable, StockError } from '../utils/stockEngine.js';
import Inventory from '../models/Inventory.js';
import createNotification from '../utils/createNotification.js';

const router = express.Router();

// ─── LIVE PRICE PREVIEW (no stock mutation) ──────────────────────
// Lets the POS screen show a running total as staff builds the order.
router.post('/quote', protect, async (req, res) => {
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
// body: { cart: { mealPackages, extras, deliveryFee }, paymentMethod, customerName, staffName }
router.post('/checkout', protect, async (req, res) => {
  try {
    const { cart, paymentMethod, customerName, phone } = req.body;
    const staffName = req.body.staffName || req.user?.email || 'Staff';

    const { order, paymentTag } = await createOrderFromCheckout({
      cart,
      source: 'store',
      paymentMethod,
      staffName,
      customerName,
      phone,
      markPaidImmediately: true,
    });

    createNotification({
      type: 'new_order',
      message: `Store sale #${order.order_id} — ₦${order.totalAmount.toLocaleString()} (${paymentTag})`,
      relatedId: order._id,
    }).catch(() => {});

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