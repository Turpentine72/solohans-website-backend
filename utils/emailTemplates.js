// utils/emailTemplates.js
import { sendEmail } from './email.js';
import getSettings from './getSettings.js';

// ─── Branded wrapper (header + logo + footer) ──────────────────────────────
export async function sendBrandedEmail({ to, subject, content }) {
  const settings = await getSettings();
  const logo = settings?.logo || 'https://via.placeholder.com/150x50?text=Solohans';
  const restaurantName = settings?.name || 'Solohans Delicious Meals';
  const address = settings?.address || 'Adeniran Ogunsanya, Surulere, Lagos';
  const phone = settings?.phone || '+234 808 194 1298';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#f4f4f4; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4; padding:20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background:#C62828; padding:20px; text-align:center;">
              <img src="${logo}" alt="${restaurantName}" style="max-height:60px; margin-bottom:8px;" />
              <h1 style="color:#ffffff; margin:0; font-size:24px;">${restaurantName}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:30px 20px; color:#333333; line-height:1.6;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9; padding:20px; text-align:center; font-size:12px; color:#666;">
              <p style="margin:0 0 5px;"><strong>${restaurantName}</strong></p>
              <p style="margin:0 0 5px;">${address}</p>
              <p style="margin:0;">📞 ${phone}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmail({ to, subject, html });
}

// ─── NEW: New order placed → admin ──────────────────────────────────────────
export async function sendNewOrderAlertToAdmin(order) {
  const orderNum = order.order_id || order._id.toString().slice(-6).toUpperCase();
  const subject = `🛒 New Order #${orderNum} – Awaiting Payment`;

  // Build items list
  let itemsHtml = '';
  if (order.items && order.items.length > 0) {
    itemsHtml = '<ul style="list-style:none; padding:0;">';
    order.items.forEach(item => {
      itemsHtml += `<li style="padding:4px 0; border-bottom:1px solid #eee;">${item.name} × ${item.quantity} – ₦${Number(item.price).toLocaleString()}</li>`;
    });
    itemsHtml += '</ul>';
  }

  const isPickup = order.delivery_method === 'pickup';
  const content = `
    <h2>📦 New Order Placed</h2>
    <p><strong>Order #:</strong> ${orderNum}</p>
    <p><strong>Customer:</strong> ${order.customerName || 'Guest'}</p>
    <p><strong>Phone:</strong> ${order.phone || 'N/A'}</p>
    <p><strong>Email:</strong> ${order.customerEmail || 'N/A'}</p>
    <p><strong>Delivery Method:</strong> ${isPickup ? '🏪 Pickup at restaurant' : '🚚 Delivery'}</p>
    ${isPickup ? '' : `<p><strong>Delivery Address:</strong> ${order.address || 'N/A'}</p>`}
    <p><strong>Items Total:</strong> ₦${Number(order.items_subtotal ?? order.totalAmount).toLocaleString()}</p>
    <p><strong>Items:</strong></p>
    ${itemsHtml}
    ${isPickup
      ? '<p style="margin-top:20px; color:#888;">No delivery fee needed – customer will pay the items total directly.</p>'
      : '<p style="margin-top:20px; color:#C62828; font-weight:bold;">⚠️ Action required: set the delivery fee in the admin panel so the customer can complete payment.</p>'}
    <a href="${(process.env.SITE_URL || "https://www.solohansdeliciousmeal.com.ng")}/admin/orders" style="display:inline-block; margin-top:15px; background:#C62828; color:#fff; padding:10px 20px; border-radius:5px; text-decoration:none;">View in Admin</a>
  `;

  const settings = await getSettings();
  const adminEmail = settings?.email || 'solohansdeliciousmeal80@gmail.com';
  await sendBrandedEmail({ to: adminEmail, subject, content });
}

// ─── Payment received → admin ───────────────────────────────────────────────
export async function sendPaymentAlertToAdmin(order) {
  const orderNum = order.order_id || order._id.toString().slice(-6).toUpperCase();
  const subject = `💰 Payment Received – Order #${orderNum}`;
  const content = `
    <h2>✅ Payment Received</h2>
    <p><strong>Order:</strong> #${orderNum}</p>
    <p><strong>Amount:</strong> ₦${Number(order.totalAmount).toLocaleString()}</p>
    <p><strong>Customer:</strong> ${order.customerName || 'N/A'}</p>
    <p><strong>Email:</strong> ${order.customerEmail}</p>
    <a href="${(process.env.SITE_URL || "https://www.solohansdeliciousmeal.com.ng")}/admin/orders" style="display:inline-block; margin-top:15px; background:#C62828; color:#fff; padding:10px 20px; border-radius:5px; text-decoration:none;">View Order</a>
  `;
  const settings = await getSettings();
  const adminEmail = settings?.email || 'solohansdeliciousmeal80@gmail.com';
  await sendBrandedEmail({ to: adminEmail, subject, content });
}

// ─── Review submitted → admin alert + auto‑reply ──────────────────────────
export async function sendNewReviewAlertToAdmin(review) {
  const subject = `⭐ New Review from ${review.customer_name}`;
  const content = `
    <h2>New Review Received</h2>
    <p><strong>Customer:</strong> ${review.customer_name}</p>
    <p><strong>Rating:</strong> ${'⭐'.repeat(review.rating)}</p>
    <p><strong>Message:</strong> ${review.text}</p>
    <a href="${(process.env.SITE_URL || "https://www.solohansdeliciousmeal.com.ng")}/admin/reviews" style="display:inline-block; margin-top:15px; background:#C62828; color:#fff; padding:10px 20px; border-radius:5px; text-decoration:none;">View in Admin</a>
  `;
  const settings = await getSettings();
  const adminEmail = settings?.email || 'solohansdeliciousmeal80@gmail.com';
  await sendBrandedEmail({ to: adminEmail, subject, content });
}

export async function sendAutoReplyToReviewer(review) {
  const subject = `Thank you for your review, ${review.customer_name}!`;
  const content = `
    <h2>Dear ${review.customer_name},</h2>
    <p>Thank you so much for taking the time to share your experience with us!</p>
    <p>We truly appreciate your feedback and we look forward to serving you again soon.</p>
    <p>Warm regards,<br/>The Solohans Team</p>
  `;
  if (review.email) {
    await sendBrandedEmail({ to: review.email, subject, content });
  }
}

// ─── Admin replies to review → client email ────────────────────────────────
export async function sendReviewReplyToClient(review) {
  const subject = `Your review has a reply from Solohans`;
  const content = `
    <h2>Dear ${review.customer_name},</h2>
    <p>Thank you again for your review. Our team has responded:</p>
    <blockquote style="background:#f9f9f9; padding:15px; border-left:4px solid #C62828; margin:15px 0;">
      ${review.reply}
    </blockquote>
    <p>We hope to see you again!</p>
  `;
  if (review.email && review.reply) {
    await sendBrandedEmail({ to: review.email, subject, content });
  }
}

// ─── Contact form submitted → admin alert ──────────────────────────────────
export async function sendContactAlertToAdmin(contact) {
  const subject = `📩 New Contact Message from ${contact.name}`;
  const content = `
    <h2>New Contact Message</h2>
    <p><strong>Name:</strong> ${contact.name}</p>
    <p><strong>Email:</strong> ${contact.email}</p>
    <p><strong>Message:</strong></p>
    <p>${contact.message}</p>
    <a href="${(process.env.SITE_URL || "https://www.solohansdeliciousmeal.com.ng")}/admin/contacts" style="display:inline-block; margin-top:15px; background:#C62828; color:#fff; padding:10px 20px; border-radius:5px; text-decoration:none;">Reply in Admin</a>
  `;
  const settings = await getSettings();
  const adminEmail = settings?.email || 'solohansdeliciousmeal80@gmail.com';
  await sendBrandedEmail({ to: adminEmail, subject, content });
}

// ─── Admin replies to contact → client email ───────────────────────────────
export async function sendContactReplyToClient(contact) {
  const subject = `Reply from Solohans: ${contact.subject || 'Your message'}`;
  const content = `
    <h2>Dear ${contact.name},</h2>
    <p>Here is our response to your message:</p>
    <blockquote style="background:#f9f9f9; padding:15px; border-left:4px solid #C62828; margin:15px 0;">
      ${contact.reply}
    </blockquote>
    <p>If you have further questions, feel free to reach out.</p>
  `;
  if (contact.email) {
    await sendBrandedEmail({ to: contact.email, subject, content });
  }
}

// ─── Order status change → client (only for Processing, Out for Delivery, Delivered) ───
export async function sendOrderStatusUpdate(order) {
  const statusMessages = {
    'Pending': 'Order Placed',
    'Paid': 'Payment Confirmed',
    'Processing': 'Order is Being Prepared',
    'Out for Delivery': 'Order is Out for Delivery',
    'Delivered': 'Order Delivered',
  };
  const statusText = statusMessages[order.status] || order.status;

  const orderNum = order.order_id || order._id.toString().slice(-6).toUpperCase();
  const subject = `${statusText} – Order #${orderNum}`;

  let additionalInfo = '';
  if (order.status === 'Out for Delivery') {
    additionalInfo = `<p>🚀 Your delicious meal is on its way! ETA: within 30–45 minutes.</p>`;
  } else if (order.status === 'Delivered') {
    additionalInfo = `<p>✅ We hope you enjoyed your meal. Please leave us a review!</p>`;
  }

  const content = `
    <h2>${statusText}</h2>
    <p><strong>Order #${orderNum}</strong></p>
    <p>Total: ₦${Number(order.totalAmount).toLocaleString()}</p>
    ${additionalInfo}
    <p>Thank you for choosing Solohans!</p>
  `;

  if (order.customerEmail) {
    await sendBrandedEmail({ to: order.customerEmail, subject, content });
  }
}

// ─── Delivery fee updated → client ──────────────────────────────────────────
export async function sendDeliveryFeeUpdate(order, newDeliveryFee) {
  const orderNum = order.order_id || order._id.toString().slice(-6).toUpperCase();
  const subject = `Action Required – Delivery Fee Set for Order #${orderNum}`;
  const itemsTotal = Number(order.items_subtotal ?? order.totalAmount).toLocaleString();
  const fee = Number(newDeliveryFee).toLocaleString();
  const finalTotal = Number(order.totalAmount).toLocaleString();
  const payUrl = `${(process.env.SITE_URL || "https://www.solohansdeliciousmeal.com.ng")}/complete-payment?order_id=${orderNum}&email=${encodeURIComponent(order.customerEmail)}`;

  const content = `
    <h2>Your Delivery Fee Has Been Set</h2>
    <p>Order <strong>#${orderNum}</strong> is ready for payment.</p>
    <p><strong>Items Total:</strong> ₦${itemsTotal}</p>
    <p><strong>Delivery Fee:</strong> ₦${fee}</p>
    <p><strong>Final Amount Due:</strong> ₦${finalTotal}</p>
    <a href="${payUrl}" style="display:inline-block; margin-top:15px; background:#C62828; color:#fff; padding:12px 24px; border-radius:5px; text-decoration:none; font-weight:bold;">Complete Payment Now</a>
    <p style="margin-top:20px; color:#888;">Your order will be confirmed and prepared once payment is completed online.</p>
    <p>Thank you for choosing Solohans!</p>
  `;

  if (order.customerEmail) {
    await sendBrandedEmail({ to: order.customerEmail, subject, content });
  }
}