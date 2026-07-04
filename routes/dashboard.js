// backend/routes/dashboard.js
import express from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Inventory from '../models/Inventory.js';
import { inventorySnapshot } from '../utils/stockEngine.js';
import { getIngredientReport } from '../utils/ingredientEngine.js';

const router = express.Router();
router.use(protect, requireRole('admin', 'storekeeper', 'cashier'));

function rangeStart(period) {
  const now = new Date();
  if (period === 'weekly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === 'monthly') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d;
  }
  // daily = since midnight today
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

router.get('/summary', protect, async (req, res) => {
  try {
    const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
    const since = rangeStart(period);

    const orders = await Order.find({
      isDeleted: false,
      payment_status: 'paid',
      createdAt: { $gte: since },
    });

    const totals = {
      totalRevenue: 0,
      websiteRevenue: 0,
      storeRevenue: 0,
      cashTotal: 0,
      transferTotal: 0,
      posTotal: 0,
      websitePaymentTotal: 0,
      mealsSold: 0,
      portionsSold: 0,
      extraPortionsSold: 0,
      lunchBoxesUsed: 0,
    };

    const proteinCount = {};
    const mealCombinationCount = {};

    for (const o of orders) {
      totals.totalRevenue += o.totalAmount || 0;
      if (o.source === 'website') totals.websiteRevenue += o.totalAmount || 0;
      else totals.storeRevenue += o.totalAmount || 0;

      if (o.paymentMethod === 'CASH') totals.cashTotal += o.totalAmount || 0;
      else if (o.paymentMethod === 'TRANSFER') totals.transferTotal += o.totalAmount || 0;
      else if (o.paymentMethod === 'POS') totals.posTotal += o.totalAmount || 0;
      else if (o.paymentMethod === 'WEBSITE PAYMENT') totals.websitePaymentTotal += o.totalAmount || 0;

      totals.lunchBoxesUsed += o.lunchBoxesUsed || 0;

      (o.mealPackages || []).forEach((mp) => {
        totals.mealsSold += 1;
        totals.extraPortionsSold += (mp.extraPortions || []).length;
        totals.portionsSold += Object.values(mp.scoopDeductions || {}).reduce((a, b) => a + b, 0)
          + (mp.spaghettiPlastics || 0);

        const proteinKey = mp.protein || 'none';
        proteinCount[proteinKey] = (proteinCount[proteinKey] || 0) + 1;

        const comboKey = (mp.meals || []).slice().sort().join('+');
        mealCombinationCount[comboKey] = (mealCombinationCount[comboKey] || 0) + 1;
      });
    }

    const bestSellingMeal = Object.entries(mealCombinationCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const bestSellingProtein = Object.entries(proteinCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const inv = await Inventory.getSingleton();
    const snapshot = inventorySnapshot(inv);

    const lowStockAlerts = [];
    const outOfStockAlerts = [];
    const checkAlert = (label, remaining) => {
      if (remaining <= 0) outOfStockAlerts.push(label);
      else if (remaining <= snapshot.lowStockThreshold) lowStockAlerts.push({ label, remaining });
    };
    checkAlert('Jollof Rice (scoops)', snapshot.jollof.remaining);
    checkAlert('Fried Rice (scoops)', snapshot.friedRice.remaining);
    checkAlert('Spaghetti (plastics)', snapshot.spaghettiPlastics.remaining);
    checkAlert('Lunch Boxes', snapshot.lunchBoxes.remaining);
    checkAlert('Extra Packaging Plastics', snapshot.extraPlastics.remaining);
    Object.entries(snapshot.extras).forEach(([key, e]) => checkAlert(e.label, e.remaining));

    // ✅ Shawarma Bread / Hotdog ingredient inventory — same alerts array,
    // same real-time contract, no separate dashboard section required.
    const ingredientReport = await getIngredientReport();
    ingredientReport.forEach((ing) => {
      if (ing.outOfStock) outOfStockAlerts.push(`${ing.pieceLabel} (0 remaining)`);
      else if (ing.lowStock) lowStockAlerts.push({ label: ing.pieceLabel, remaining: ing.remainingPieces });
    });

    res.json({
      period,
      since,
      sales: totals,
      payments: {
        cashTotal: totals.cashTotal,
        transferTotal: totals.transferTotal,
        posTotal: totals.posTotal,
        websitePaymentTotal: totals.websitePaymentTotal,
        totalSales: totals.cashTotal + totals.transferTotal + totals.posTotal + totals.websitePaymentTotal,
      },
      inventory: snapshot,
      ingredients: ingredientReport,
      analytics: {
        bestSellingMeal,
        bestSellingProtein,
        mealCombinationCount,
        proteinCount,
      },
      alerts: { lowStock: lowStockAlerts, outOfStock: outOfStockAlerts },
      orderCount: orders.length,
    });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    res.status(500).json({ message: err.message });
  }
});

export default router;