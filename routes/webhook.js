// routes/webhook.js

import express from "express";
import crypto from "crypto";
import Order from "../models/Order.js"; // import your order model
import { sendPaymentAlertToAdmin, sendOrderStatusUpdate } from "../utils/emailTemplates.js";
import createNotification from "../utils/createNotification.js";

const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

router.post("/", express.json(), async (req, res) => {
  try {
    // Verify Paystack signature
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    const providedSignature = req.headers["x-paystack-signature"] || "";
    const signaturesMatch =
      hash.length === providedSignature.length &&
      crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(providedSignature));

    if (!signaturesMatch) {
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;

    // Payment successful
    if (event.event === "charge.success") {
      const { metadata, reference } = event.data;

      if (metadata?.orderId) {
        const order = await Order.findById(metadata.orderId);

        // ✅ Idempotent + non-destructive: only act the FIRST time a given
        // order is confirmed paid. Paystack can resend this webhook (retries,
        // duplicate delivery), and without this guard a delayed/duplicate
        // event would silently snap order.status back to "Paid" even after
        // an admin had already moved it to Processing / Out for Delivery /
        // Delivered. Once payment_status is "paid", this webhook never
        // touches the order again.
        if (order && order.payment_status !== "paid") {
          order.payment_status = "paid";
          order.verification_status = "Verified"; // locked permanently from here on
          order.paymentRef = reference;
          order.statusHistory = [
            ...(order.statusHistory || []),
            { status: "Paid & Verified", timestamp: new Date(), changedBy: "paystack_webhook" },
          ];
          await order.save();

          createNotification({
            type: "payment_receipt",
            message: `Payment received for order #${order.order_id}`,
            relatedId: order._id,
          }).catch(err => console.error("Notification error:", err));

          // ✅ Pickup orders stay silent on email here too — same reasoning
          // as the /payments/verify route.
          if (order.delivery_method !== 'pickup') {
            sendPaymentAlertToAdmin(order).catch(err =>
              console.error("Payment alert email error:", err)
            );
            sendOrderStatusUpdate(order).catch(err =>
              console.error("Status update email error:", err)
            );
          }

          console.log(`✅ Order ${order.order_id} marked paid via webhook`);
        } else if (order) {
          console.log(
            `ℹ️ Webhook ignored — order ${order.order_id} already paid (current status: ${order.status})`
          );
        }
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.status(500).send("Webhook Error");
  }
});

export default router;