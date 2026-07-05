// backend/utils/autoArchive.js
import Order from '../models/Order.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Automatically archives completed orders older than 7 days — reuses the
 * exact same isDeleted/deletedAt fields the Orders page already uses for
 * manual archiving, so:
 *   - They disappear from the default Orders view (isDeleted: false)
 *   - They still show up via the existing "Show deleted" toggle
 *   - They can still be restored via the existing restore button
 *   - Verified payments still show permanently on the Payment Verification
 *     page regardless, since that page always fetches with ?deleted=true
 *
 * Cheap enough to run on every admin Orders page load — no cron job or
 * background scheduler needed for this to feel "automatic".
 */
export async function archiveOldCompletedOrders() {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
  await Order.updateMany(
    {
      isDeleted: false,
      status: { $in: ['Delivered', 'Completed'] },
      createdAt: { $lt: cutoff },
    },
    { $set: { isDeleted: true, deletedAt: new Date() } }
  );
}