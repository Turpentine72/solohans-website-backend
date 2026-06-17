import express from 'express';
import axios from 'axios';
import Order from '../models/Order.js';
import createNotification from '../utils/createNotification.js';
import { sendPaymentAlertToAdmin, sendOrderStatusUpdate } from '../utils/emailTemplates.js';

const router = express.Router();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE   = 'https://api.paystack.co';

router.post('/verify', async (req, res) => {
  const { reference, orderId } = req.body;

  if (!reference || !orderId) {
    return res.status(400).json({ success: false, message: 'reference and orderId required' });
  }

  try {
    // 1. Ask Paystack
    const { data: psData } = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    if (psData.data.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    // 2. Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // 3. Guard against double-processing the same payment
    //    NOTE: field is payment_status (snake_case) per Order schema —
    //    NOT paymentStatus, which doesn't exist on the model.
    if (order.payment_status === 'paid') {
      return res.json({ success: true, alreadyPaid: true, order_id: order.order_id });
    }

    // 4. Mark paid in DB — single atomic update
    order.payment_status = 'paid';
    order.paymentRef     = reference;
    order.status          = 'Paid';
    order.statusHistory   = [
      ...(order.statusHistory || []),
      { status: 'Paid', timestamp: new Date(), changedBy: 'system' },
    ];
    await order.save();

    // 5. Fire notifications + emails (non-blocking — don't let these fail the response)
    createNotification({
      type:      'payment_receipt', // must match Notification schema enum
      message:   `Payment confirmed for order ${order.order_id}`,
      relatedId: order._id,
    }).catch(err => console.error('Notification error:', err));

    sendPaymentAlertToAdmin(order).catch(err =>
      console.error('Payment alert email error:', err)
    );

    sendOrderStatusUpdate(order).catch(err =>
      console.error('Status update email error:', err)
    );

    return res.json({ success: true, order_id: order.order_id });

  } catch (err) {
    if (err.response) {
      console.error('Paystack error:', err.response.status, err.response.data);
      return res.status(502).json({ success: false, message: 'Could not reach Paystack' });
    }
    console.error('Verify route error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;