// routes/webhook.js

import express from "express";
import crypto from "crypto";
import Order from "../models/Order.js"; // import your order model

const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

router.post("/", express.json(), async (req, res) => {
  try {
    // Verify Paystack signature
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;

    // Payment successful
    if (event.event === "charge.success") {
      const { metadata, amount, reference } = event.data;

      if (metadata?.orderId) {

        // Update order
        await Order.findByIdAndUpdate(
          metadata.orderId,
          {
            status: "Paid",
            paymentStatus: "Verified",
            paymentReference: reference,
            amountPaid: amount / 100
          }
        );

        console.log(`✅ Order ${metadata.orderId} updated`);
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.status(500).send("Webhook Error");
  }
});

export default router;