import express from 'express';
import axios from 'axios';
import Order from '../models/Order.js';
import createNotification from '../utils/createNotification.js';
import { sendPaymentAlertToAdmin, sendOrderStatusUpdate } from '../utils/emailTemplates.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE   = 'https://api.paystack.co';

// Shared core logic — verifies a reference with Paystack and marks the
// matching order paid. Used by both the public /verify route (called
// automatically right after checkout) and the admin recovery route below
// (for when that automatic call never reached us for any reason, even
// though Paystack genuinely charged the customer).
async function verifyAndMarkPaid({ reference, orderId }) {
  const { data: psData } = await axios.get(
    `${PAYSTACK_BASE}/transaction/verify/${reference}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
  );

  if (psData.data.status !== 'success') {
    return { success: false, status: 400, message: 'Payment not successful on Paystack' };
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return { success: false, status: 404, message: 'Order not found' };
  }

  if (order.payment_status === 'paid') {
    return { success: true, alreadyPaid: true, order_id: order.order_id };
  }

  if (order.delivery_method === 'delivery' && !order.delivery_fee_set) {
    return {
      success: false,
      status: 400,
      message: 'Delivery fee has not been set yet for this order. Please wait for admin confirmation.',
    };
  }

  order.payment_status      = 'paid';
  order.verification_status = 'Verified'; // locked permanently from here on
  order.paymentRef          = reference;
  order.statusHistory       = [
    ...(order.statusHistory || []),
    { status: 'Paid & Verified', timestamp: new Date(), changedBy: 'system' },
  ];
  await order.save();

  createNotification({
    type:      'payment_receipt',
    message:   `Payment confirmed for order ${order.order_id}`,
    relatedId: order._id,
  }).catch(err => console.error('Notification error:', err));

  sendPaymentAlertToAdmin(order).catch(err => console.error('Payment alert email error:', err));
  sendOrderStatusUpdate(order).catch(err => console.error('Status update email error:', err));

  return { success: true, order_id: order.order_id };
}

router.post('/verify', async (req, res) => {
  const { reference, orderId } = req.body;

  if (!reference || !orderId) {
    return res.status(400).json({ success: false, message: 'reference and orderId required' });
  }

  try {
    const result = await verifyAndMarkPaid({ reference, orderId });
    return res.status(result.status || 200).json(result);
  } catch (err) {
    if (err.response) {
      console.error('Paystack error:', err.response.status, err.response.data);
      return res.status(502).json({ success: false, message: 'Could not reach Paystack' });
    }
    console.error('Verify route error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ─── ADMIN RECOVERY: manually reconcile a payment Paystack confirms but our
// system never recorded (e.g. the customer's automatic verify call never
// reached us due to a network issue). Admin finds the reference in their
// own Paystack dashboard and pastes it here. ──────────────────────────────
router.post('/admin-verify', protect, async (req, res) => {
  const { reference, orderId } = req.body;
  if (!reference || !orderId) {
    return res.status(400).json({ success: false, message: 'reference and orderId required' });
  }
  try {
    const result = await verifyAndMarkPaid({ reference, orderId });
    return res.status(result.status || 200).json(result);
  } catch (err) {
    if (err.response) {
      return res.status(502).json({ success: false, message: 'Could not reach Paystack' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;