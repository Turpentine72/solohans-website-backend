import express from 'express';
import Order from '../models/Order.js';
import { protect, requireRole } from '../middleware/auth.js';
import {
  sendOrderStatusUpdate,
  sendPaymentAlertToAdmin,
  sendDeliveryFeeUpdate,
  sendNewOrderAlertToAdmin
} from '../utils/emailTemplates.js';
import createNotification from '../utils/createNotification.js';
import Settings from '../models/Settings.js';
import DeliveryZone from '../models/DeliveryZone.js';
import { isWithinBusinessHours } from '../utils/businessHours.js';
import { sendPushToAdmins } from '../utils/push.js';
import { deductStockForOrder } from '../utils/stockDeduction.js';
import MenuItem from '../models/MenuItem.js';
import { assertIngredientsAvailable, deductIngredientsForOrder, IngredientStockError } from '../utils/ingredientEngine.js';
import { getActiveShift, ShiftError } from '../utils/shiftHelper.js';
import { createOrderFromCheckout, CheckoutError } from '../utils/checkout.js';
import { PricingError } from '../utils/pricing.js';
import { StockError } from '../utils/stockEngine.js';
// ❌ removed: import getNextSequence from '../utils/getNextSequence.js';

const router = express.Router();

// ─── CREATE WEBSITE MEAL-COMBO ORDER (Jollof/Fried Rice/Spaghetti builder) ──
// This is SEPARATE from the generic POST '/' route above (used by the
// existing menu/cart system). It shares the same Order model and the same
// delivery-zone fee resolution pattern, but deducts from the new shared
// Inventory (rice scoops / spaghetti plastics / lunch boxes) instead of
// per-MenuItem stock. Always tagged source='website', paymentMethod='WEBSITE PAYMENT'.
// body: { cart: { mealPackages, extras }, customerName, customerEmail, phone,
//         address, deliveryMethod, deliveryZoneId, notes }
router.post('/checkout', async (req, res) => {
  try {
    const settings = await Settings.findOne();
    if (settings && !isWithinBusinessHours(settings)) {
      return res.status(403).json({
        message: 'We are currently closed. Orders can only be placed between opening and closing hours.',
      });
    }

    const { cart, customerName, customerEmail, phone, address, deliveryMethod, deliveryZoneId, notes } = req.body;
    if (!customerEmail) return res.status(400).json({ message: 'Email is required' });

    const { order, paymentTag } = await createOrderFromCheckout({
      cart,
      source: 'website',
      paymentMethod: 'WEBSITE PAYMENT',
      customerName,
      customerEmail,
      phone,
      address,
      deliveryMethod,
      deliveryZoneId,
      notes,
    });

    createNotification({
      type: 'new_order',
      message: `New website order #${order.order_id} from ${customerName || 'Customer'} (${paymentTag})`,
      relatedId: order._id,
    });

    sendPushToAdmins({
      title: 'New Meal Order',
      body: `${customerName || 'Customer'} — ₦${Number(order.items_subtotal).toLocaleString()}`,
      url: `/admin/orders`,
    }).catch((err) => console.error('Push notification error:', err));

    res.status(201).json({ order, paymentTag });
  } catch (err) {
    if (err instanceof CheckoutError || err instanceof PricingError || err instanceof StockError) {
      return res.status(400).json({ message: err.message });
    }
    console.error('Website meal checkout error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ─── PUBLIC TRACKING ENDPOINT (no auth) ───────────────
router.get('/track', async (req, res) => {
  try {
    const { order_id, email } = req.query;
    if (!order_id || !email) {
      return res.status(400).json({ message: 'Order ID and email are required' });
    }
    const order = await Order.findOne({
      order_id: order_id.toUpperCase(),
      customerEmail: email.toLowerCase().trim(),
      isDeleted: false,
    }).select(
      'order_id customerName customerEmail status totalAmount items createdAt delivery_fee order_type statusHistory'
    );

    if (!order) return res.status(404).json({ message: 'Order not found' });

    const statusHistory = (order.statusHistory || []).map(entry => ({
      status: entry.status,
      date: entry.timestamp,
    }));

    res.json({
      order_id: order.order_id,
      customerName: order.customerName,
      totalAmount: order.totalAmount,
      delivery_fee: order.delivery_fee,
      order_type: order.order_type,
      status: order.status,
      items: order.items,
      statusHistory,
      createdAt: order.createdAt,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── CREATE ORDER (public) ───────────────────────────
router.post('/', async (req, res) => {
  try {
    const settings = await Settings.findOne();
    if (settings && !isWithinBusinessHours(settings)) {
      return res.status(403).json({
        message: 'We are currently closed. Orders can only be placed between opening and closing hours.',
      });
    }

    const delivery_method = req.body.delivery_method === 'pickup' ? 'pickup' : 'delivery';

    if (delivery_method === 'delivery' && !req.body.address?.trim()) {
      return res.status(400).json({ message: 'Delivery address is required for delivery orders' });
    }

    // ✅ The client (CartSidebar) already computes its subtotal WITH tax
    // included and sends that as `totalAmount` — this has always been the
    // contract, and changing it would double-charge VAT. So here we only
    // resolve the CURRENT tax rate from Settings and back-derive the VAT
    // portion for storage/display — we never add tax to the payable amount
    // a second time.
    const itemsSubtotalWithTax = Number(req.body.totalAmount) || 0;
    const taxEnabled = !!settings?.tax?.enabled;
    const taxRate = settings?.tax?.rate || 0;
    // subtotalWithTax = preTax * (1 + rate/100)  =>  preTax = subtotalWithTax / (1 + rate/100)
    const preTaxSubtotal = taxEnabled && taxRate > 0
      ? itemsSubtotalWithTax / (1 + taxRate / 100)
      : itemsSubtotalWithTax;
    const taxAmount = taxEnabled ? Math.round(itemsSubtotalWithTax - preTaxSubtotal) : 0;
    const itemsSubtotal = itemsSubtotalWithTax; // unchanged from original behaviour

    // If the customer picked a delivery zone, look up its fee SERVER-SIDE
    // (never trust a fee value sent directly from the browser) and apply it
    // immediately so they can pay right away, same as pickup.
    let zoneFee = null;
    if (delivery_method === 'delivery' && req.body.delivery_zone_id) {
      const zone = await DeliveryZone.findOne({ _id: req.body.delivery_zone_id, active: true });
      if (zone) zoneFee = zone.fee;
    }

    const feeIsKnown = delivery_method === 'pickup' || zoneFee !== null;

    // ✅ Ingredient-based stock validation — BLOCKS checkout if there isn't
    // enough Shawarma Bread / Hotdog (or any future ingredient-linked item).
    // This runs for every sale regardless of payment method or channel,
    // since it happens right here at order creation, before anything is saved.
    const cartItems = Array.isArray(req.body.items) ? req.body.items : [];
    const resolvedItems = [];
    for (const line of cartItems) {
      if (!line.menu_item_id) continue;
      const menuItem = await MenuItem.findById(line.menu_item_id);
      if (menuItem) resolvedItems.push({ menuItem, quantity: Number(line.quantity) || 1 });
    }
    try {
      await assertIngredientsAvailable(resolvedItems);
    } catch (err) {
      if (err instanceof IngredientStockError) {
        return res.status(400).json({ message: err.message });
      }
      throw err;
    }

    // ✅ No longer manually create order_id – the pre‑save hook in Order.js does it
    const orderData = {
      ...req.body,
      delivery_method,
      address: delivery_method === 'delivery' ? req.body.address : '',
      items_subtotal: itemsSubtotal,
      tax_enabled: taxEnabled,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      totalAmount: itemsSubtotal + (zoneFee || 0), // UNCHANGED formula — tax already inside itemsSubtotal
      delivery_fee: delivery_method === 'pickup' ? 0 : zoneFee,
      // Pickup, or a recognized zone with a known fee, can be paid immediately.
      // A custom/unlisted location still waits for admin to set a fee manually.
      delivery_fee_set: feeIsKnown,
      status: 'Pending',
      payment_status: 'unpaid',
      // order_id is NOT set here – will be auto‑generated by the model
    };
    delete orderData._id; // safety

    const order = await Order.create(orderData);

    // Deduct ingredient pieces immediately — this is a hard, real-time
    // deduction, separate from the lenient per-MenuItem stock deduction
    // below (which still only runs on first admin approval). Ingredients
    // must never be double-deducted, so this happens exactly once, here.
    if (resolvedItems.length) {
      await deductIngredientsForOrder(resolvedItems, { orderId: order._id, performedBy: order.customerEmail });
    }

    createNotification({
      type: 'new_order',
      message: `New order #${order.order_id} from ${order.customerName || 'Customer'}`,
      relatedId: order._id,
    });

    // ✅ Pickup orders are explicitly silent on email — admin still gets
    // the in-app notification above and the push notification below,
    // just no email for this fast, no-delivery-fee-coordination flow.
    if (delivery_method !== 'pickup') {
      sendNewOrderAlertToAdmin(order).catch(err =>
        console.error('New order admin email error:', err)
      );
    }

    sendPushToAdmins({
      title: 'New Order Received',
      body: `${order.customerName || 'Customer'} — ₦${Number(order.items_subtotal).toLocaleString()}`,
      url: `/admin/orders`,
    }).catch(err => console.error('Push notification error:', err));

    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── MARK AS PAID (public – called after Paystack) ────
// ─── ADMIN: MARK PAID (locks verification permanently) ──────────────
router.patch('/:id/payment', protect, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const targetStatus = req.body.payment_status === 'unpaid' ? 'unpaid' : 'paid';

    if (targetStatus === 'unpaid') {
      // 🔒 Cannot un-verify — once verified, payment can never be reverted.
      if (order.verification_status === 'Verified') {
        return res.status(400).json({ message: 'This order is already verified and cannot be marked unpaid again.' });
      }
      order.payment_status = 'unpaid';
      await order.save();
      return res.json(order);
    }

    if (order.payment_status === 'paid' && order.verification_status === 'Verified') {
      return res.status(400).json({ message: 'This order has already been paid and verified.' });
    }

    order.payment_status = 'paid';
    order.verification_status = 'Verified'; // 🔒 permanent from this point on
    order.statusHistory = [
      ...(order.statusHistory || []),
      { status: 'Paid & Verified', timestamp: new Date(), changedBy: req.user.email || req.user.id },
    ];
    await order.save();

    sendPaymentAlertToAdmin(order).catch(err => console.error(err));

    createNotification({
      type: 'payment_receipt',
      message: `Payment received for order #${order.order_id}`,
      relatedId: order._id,
    });

    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── PUBLIC: GET PAYMENT INFO (for the Complete Payment page) ─────────
router.get('/payment-info', async (req, res) => {
  try {
    const { order_id, email } = req.query;
    if (!order_id || !email) {
      return res.status(400).json({ message: 'Order ID and email are required' });
    }
    const order = await Order.findOne({
      order_id: order_id.toUpperCase(),
      customerEmail: email.toLowerCase().trim(),
      isDeleted: false,
    }).select(
      '_id order_id customerName customerEmail items items_subtotal delivery_fee delivery_fee_set delivery_method totalAmount payment_status'
    );

    if (!order) return res.status(404).json({ message: 'Order not found' });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN: GET ALL (exclude deleted by default, ?deleted=true to include) ──
router.get('/', protect, async (req, res) => {
  try {
    const includeDeleted = req.query.deleted === 'true';
    const filter = includeDeleted ? {} : { isDeleted: false };
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN: GET SINGLE ──────────────────────────────
// ─── WEBSITE ORDER TAGGING ─────────────────────────────────────────────
// Lists pending online orders that any logged-in staff member can claim.
// Must be registered BEFORE '/:id' below, or Express would treat
// "website-pending" as an :id and this would never be reached.
router.get('/website-pending', protect, async (req, res) => {
  try {
    const orders = await Order.find({
      isDeleted: false,
      source: { $ne: 'store' },      // website orders only (source defaults to 'website')
      taggedStaffId: null,           // not yet claimed by anyone
      status: { $nin: ['Delivered', 'Completed', 'Cancelled'] },
    }).sort('-createdAt').limit(100);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Not found' });
    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── ADMIN: UPDATE STATUS ───────────────────────────
router.patch('/:id/status', protect, requireRole('admin', 'cashier', 'chef', 'delivery_staff'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (['Delivered', 'Completed', 'Cancelled'].includes(order.status)) {
      return res.status(400).json({ message: `${order.status} orders cannot be changed` });
    }

    const newStatus = req.body.status;
    const currentStatus = order.status;

    // Pickup orders follow a different, simpler stage progression than
    // delivery orders — there's no "Out for Delivery" leg, and it ends
    // with "Completed" (picked up) instead of "Delivered".
    const deliveryTransitions = {
      'Pending': ['Confirmed', 'Processing', 'Cancelled'],
      'Confirmed': ['Processing', 'Cancelled'],
      'Processing': ['Out for Delivery', 'Cancelled'],
      'Out for Delivery': ['Delivered'],
      'Delivered': [],
      'Cancelled': [],
      // Legacy bridge — orders created before this restructure may still
      // have "Paid" stored as a fulfillment stage (it's now a payment
      // field instead). Treat it like Pending so old orders aren't stuck.
      'Paid': ['Confirmed', 'Processing', 'Cancelled'],
    };

    const pickupTransitions = {
      'Pending': ['Processing', 'Cancelled'],
      'Processing': ['Ready for Pickup', 'Cancelled'],
      'Ready for Pickup': ['Completed'],
      'Completed': [],
      'Cancelled': [],
      'Paid': ['Processing', 'Cancelled'], // legacy bridge, same reasoning as above
    };

    const allowedTransitions = order.delivery_method === 'pickup' ? pickupTransitions : deliveryTransitions;

    if (!allowedTransitions[currentStatus]?.includes(newStatus)) {
      return res.status(400).json({ message: `Cannot move from ${currentStatus} to ${newStatus}` });
    }

    // 👨‍🍳 Chef can only move orders through kitchen prep stages — not
    // confirm new orders, cancel, or mark final delivery/pickup completion.
    if (req.user.role === 'chef' && !['Processing', 'Out for Delivery', 'Ready for Pickup'].includes(newStatus)) {
      return res.status(403).json({ message: 'Chef can only update orders into kitchen prep stages' });
    }
    // 🚚 Delivery staff can only mark an order as Delivered — nothing else.
    if (req.user.role === 'delivery_staff' && newStatus !== 'Delivered') {
      return res.status(403).json({ message: 'Delivery staff can only mark orders as Delivered' });
    }

    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({
      status: newStatus,
      changedBy: req.user.email || req.user.id,
      previousStatus: currentStatus,
      timestamp: new Date(),
    });

    order.status = newStatus;

    // 📦 "Admin approves order → stock is automatically deducted." This is
    // the FIRST time the order leaves Pending — guarded by stockDeducted so
    // it can never happen twice even if status gets changed back and forth.
    const isFirstApproval = (currentStatus === 'Pending' || currentStatus === 'Paid') && !order.stockDeducted;
    if (isFirstApproval) {
      order.stockDeducted = true;
    }

    await order.save();

    if (isFirstApproval) {
      deductStockForOrder(order).catch(err => console.error('Stock deduction error:', err));
    }

    // Customer email for any real progress update — except pickup orders,
    // which are explicitly silent (no email at all, by design).
    if (order.delivery_method !== 'pickup' && ['Confirmed', 'Processing', 'Out for Delivery', 'Delivered', 'Cancelled'].includes(newStatus)) {
      sendOrderStatusUpdate(order).catch(err => console.error(err));
    }

    createNotification({
      type: 'order_status',
      message: `Order #${order.order_id} changed to ${newStatus}`,
      relatedId: order._id,
    });

    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── ADMIN: UPDATE DELIVERY FEE ─────────────────────
router.patch('/:id/delivery-fee', protect, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Not found' });

    if (order.delivery_method === 'pickup') {
      return res.status(400).json({ message: 'Pickup orders never have a delivery fee — nothing to set here.' });
    }

    if (order.payment_status === 'paid') {
      return res.status(400).json({ message: 'Cannot change delivery fee after payment has been made' });
    }

    const fee = Number(req.body.delivery_fee) || 0;
    order.delivery_fee = fee;
    order.delivery_fee_set = true;
    order.totalAmount = (order.items_subtotal || 0) + fee;
    await order.save();

    sendDeliveryFeeUpdate(order, fee).catch(err =>
      console.error('Delivery fee email error:', err)
    );

    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── ADMIN: SOFT DELETE ─────────────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Not found' });
    order.isDeleted = true;
    order.deletedAt = new Date();
    await order.save();
    res.json({ message: 'Order moved to trash' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── ADMIN: RESTORE ─────────────────────────────────
router.patch('/:id/restore', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Not found' });
    order.isDeleted = false;
    order.deletedAt = null;
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── ADMIN: PERMANENT DELETE ────────────────────────
router.delete('/:id/permanent', protect, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ message: 'Permanently deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─── Tag to Me — a staff member claims a pending website order ─────────
router.patch('/:id/tag-to-me', protect, async (req, res) => {
  try {
    const shift = await getActiveShift(req.user.id);
    if (!shift) return res.status(400).json({ message: 'You need to Start Work before tagging orders.' });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.source === 'store') return res.status(400).json({ message: 'Store sales cannot be tagged.' });

    // Prevent another staff member from tagging the same order unless an
    // admin reassigns it — this check is atomic-enough for our purposes
    // since we re-read taggedStaffId right before writing.
    if (order.taggedStaffId && order.taggedStaffId.toString() !== req.user.id) {
      return res.status(409).json({ message: `This order is already tagged to ${order.taggedStaffName}.` });
    }

    order.taggedStaffId = req.user.id;
    order.taggedStaffName = req.user.name || req.user.email;
    order.taggedShiftId = shift._id;
    order.taggedAt = new Date();
    await order.save();

    res.json(order);
  } catch (err) {
    if (err instanceof ShiftError) return res.status(400).json({ message: err.message });
    res.status(400).json({ message: err.message });
  }
});

// ─── Admin: reassign (or clear) a tagged order ──────────────────────────
router.patch('/:id/reassign', protect, requireRole('admin'), async (req, res) => {
  try {
    const { staffId, staffName } = req.body; // omit both to clear the tag entirely
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (!staffId) {
      order.taggedStaffId = null;
      order.taggedStaffName = '';
      order.taggedShiftId = null;
      order.taggedAt = null;
    } else {
      const shift = await getActiveShift(staffId);
      order.taggedStaffId = staffId;
      order.taggedStaffName = staffName || '';
      order.taggedShiftId = shift?._id || null;
      order.taggedAt = new Date();
    }
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;