// backend/utils/shiftHelper.js
import Attendance from '../models/Attendance.js';
import Order from '../models/Order.js';

export class ShiftError extends Error {}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the staff member's active (checked-in, not checked-out) shift for
 * today, or null if they haven't started work. Mirrors the exact
 * one-shift-per-day semantics already used by routes/attendance.js.
 */
export async function getActiveShift(userId) {
  const record = await Attendance.findOne({ user: userId, date: startOfToday() });
  if (!record || !record.checkIn || record.status !== 'Active') return null;
  return record;
}

/**
 * Requires an active shift to exist — throws a clear, actionable error if
 * not. Used to block POS sales until the staff member has clicked "Start Work".
 */
export async function requireActiveShift(userId) {
  const shift = await getActiveShift(userId);
  if (!shift) {
    throw new ShiftError('You need to Start Work before making sales.');
  }
  return shift;
}

/**
 * Activity-only summary for a shift — deliberately NO sales/payment
 * figures (that's what Order History and Payment Reconciliation are for
 * now). Just counts of what the staff member actually did during this
 * shift: orders processed, inventory changes made, expenses logged.
 */
export async function getShiftActivitySummary(record) {
  const Expense = (await import('../models/Expense.js')).default;
  const AuditLog = (await import('../models/AuditLog.js')).default;

  const posOrders = await Order.countDocuments({ shiftId: record._id, source: 'store', isDeleted: false });
  const taggedOrders = await Order.countDocuments({ taggedShiftId: record._id, isDeleted: false });

  const windowEnd = record.checkOut || new Date();
  const expensesAdded = record.checkIn
    ? await Expense.countDocuments({ addedBy: record.user, createdAt: { $gte: record.checkIn, $lte: windowEnd } })
    : 0;
  const inventoryUpdates = record.checkIn
    ? await AuditLog.countDocuments({
        user: record.user,
        timestamp: { $gte: record.checkIn, $lte: windowEnd },
        action: { $regex: /Ingredient|Extra Item|Stock Reset|Menu Item/i },
      })
    : 0;

  return {
    ordersProcessed: posOrders + taggedOrders,
    expensesAdded,
    inventoryUpdates,
  };
}

/**
 * Computes a full shift summary — used for the live Staff Dashboard (while
 * the shift is still Active) and the final summary shown on End Work.
 * Combines two independent things happening in one shift:
 *   1. Walk-in POS sales the staff personally rang up (by payment method)
 *   2. Website orders the staff tagged to themselves ("Tag to Me")
 */
export async function getShiftSummary(shiftId) {
  const posSales = await Order.find({ shiftId, source: 'store', isDeleted: false });
  const taggedOrders = await Order.find({ taggedShiftId: shiftId, isDeleted: false });

  const summary = {
    cashSales: 0,
    transferSales: 0,
    posCardSales: 0,
    websiteOrdersTaggedCount: taggedOrders.length,
    websiteOrdersTaggedTotal: 0,
    ordersHandled: posSales.length + taggedOrders.length,
  };

  posSales.forEach((o) => {
    if (o.paymentMethod === 'CASH') summary.cashSales += o.totalAmount || 0;
    else if (o.paymentMethod === 'TRANSFER') summary.transferSales += o.totalAmount || 0;
    else if (o.paymentMethod === 'POS') summary.posCardSales += o.totalAmount || 0;
    else if (o.paymentMethod === 'SPLIT') {
      (o.splitPayments || []).forEach((sp) => {
        if (sp.method === 'CASH') summary.cashSales += sp.amount || 0;
        else if (sp.method === 'TRANSFER') summary.transferSales += sp.amount || 0;
        else if (sp.method === 'POS') summary.posCardSales += sp.amount || 0;
      });
    }
  });

  taggedOrders.forEach((o) => {
    summary.websiteOrdersTaggedTotal += o.totalAmount || 0;
  });

  summary.grandTotal = summary.cashSales + summary.transferSales + summary.posCardSales + summary.websiteOrdersTaggedTotal;

  return summary;
}