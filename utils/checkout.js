// backend/utils/checkout.js
import Order from '../models/Order.js';
import DeliveryZone from '../models/DeliveryZone.js';
import Inventory from '../models/Inventory.js';
import Settings from '../models/Settings.js';
import MenuItem from '../models/MenuItem.js';
import { priceOrder, PricingError } from './pricing.js';
import { deductStockForOrder } from './stockEngine.js';
import { assertIngredientsAvailable, deductIngredientsForOrder } from './ingredientEngine.js';
import { requireActiveShift, ShiftError } from './shiftHelper.js';

export class CheckoutError extends Error {}

const PAYMENT_TAGS = {
  CASH: 'CASH',
  TRANSFER: 'TRANSFER',
  POS: 'POS',
  SPLIT: 'SPLIT PAYMENT',
  'WEBSITE PAYMENT': 'WEBSITE PAYMENT',
  PLATFORM: 'PLATFORM PAYMENT',
};

/**
 * Builds a priced, stock-checked meal-combo order and persists it.
 * Shared by POS (store) and the website combo builder.
 *
 * cart = {
 *   mealPackages: [{ meals: ['jollof'], protein: 'regularChicken', extraPortions: [] }],
 *   extras: [{ item: 'plantain', qty: 1 }],
 * }
 *
 * deliveryMethod: 'delivery' | 'pickup'
 * deliveryZoneId: required when deliveryMethod === 'delivery' — the fee is
 *   ALWAYS resolved server-side from the DeliveryZone document, exactly like
 *   the existing POST /api/orders route does. A client-sent fee is never trusted.
 */
export async function createOrderFromCheckout({
  cart,
  source,               // 'store' | 'website'
  paymentMethod,        // 'CASH' | 'TRANSFER' | 'POS' | 'SPLIT' | 'WEBSITE PAYMENT'
  splitPayments = [],   // [{ method: 'CASH'|'TRANSFER'|'POS', amount }] — required when paymentMethod === 'SPLIT'
  staffName = '',
  staffUserId = null,        // logged-in staff's User _id — required for source: 'store'
  customerName = '',
  customerEmail = '',
  phone = '',
  address = '',
  deliveryMethod = null,     // if omitted: 'pickup' for store, 'delivery' for website
  deliveryZoneId = null,
  posSaleType = null,        // 'shop' | 'restaurant' — required for source: 'store'
  notes = '',
  markPaidImmediately = false,
  platform = 'Walk-in',      // 'Walk-in' | 'Glovo' | 'Chowdeck' | 'Uber Eats' | 'Other'
  externalOrderId = '',      // required for every non-Walk-in platform
  discountAmount = 0,        // manual staff-applied discount — POS ('store') only, ignored for website
  discountLabel = '',        // e.g. "Loyalty discount", "Manager override"
}) {
  // ✅ Platform Order Recording — third-party platforms are logged manually
  // at POS (no API integration). Every platform other than Walk-in requires
  // a real External Order ID, and that ID can never be reused for the same
  // platform (guards against re-entering the same delivery order twice).
  const VALID_PLATFORMS = ['Walk-in', 'Glovo', 'Chowdeck', 'Uber Eats', 'Other'];
  if (!VALID_PLATFORMS.includes(platform)) {
    throw new CheckoutError('Select a valid order platform.');
  }
  const isThirdPartyPlatform = platform !== 'Walk-in';
  const trimmedExternalOrderId = String(externalOrderId || '').trim();
  if (isThirdPartyPlatform) {
    if (!trimmedExternalOrderId) {
      throw new CheckoutError(`${platform} Order ID is required for a ${platform} order.`);
    }
    const duplicate = await Order.findOne({ platform, externalOrderId: trimmedExternalOrderId, isDeleted: { $ne: true } });
    if (duplicate) {
      throw new CheckoutError(`A ${platform} order with ID "${trimmedExternalOrderId}" has already been recorded (Order #${duplicate.order_id}).`);
    }
  }

  // ✅ Third-party delivery platforms (Glovo, Chowdeck, any future platform)
  // have already collected payment from the customer directly — there is
  // nothing to reconcile in cash/transfer/POS at this register. So for
  // these orders specifically: skip the payment-method requirement
  // entirely (forced to a dedicated 'PLATFORM' tag instead of asking the
  // cashier to pick one), and skip the Order Type choice too, since a
  // delivery-platform order isn't a dine-in/shop distinction — it defaults
  // to 'shop'. A Walk-in sale still requires both, unchanged.
  if (source === 'store' && isThirdPartyPlatform) {
    paymentMethod = 'PLATFORM';
    if (!posSaleType) posSaleType = 'shop';
  } else {
    if (source === 'store' && !['CASH', 'TRANSFER', 'POS', 'SPLIT'].includes(paymentMethod)) {
      throw new CheckoutError('A payment method (Cash, Transfer, POS, or Split Payment) is required to complete a store sale.');
    }
    if (source === 'store' && paymentMethod === 'SPLIT') {
      if (!Array.isArray(splitPayments) || splitPayments.length < 1) {
        throw new CheckoutError('Add at least one payment entry for a split payment.');
      }
      for (const entry of splitPayments) {
        if (!['CASH', 'TRANSFER', 'POS'].includes(entry.method)) {
          throw new CheckoutError('Each split payment entry must use Cash, Transfer, or POS.');
        }
        if (!(Number(entry.amount) > 0)) {
          throw new CheckoutError('Each split payment entry must have an amount greater than ₦0.');
        }
      }
    }
    if (source === 'store' && !['shop', 'restaurant'].includes(posSaleType)) {
      throw new CheckoutError('Select an Order Type (Shop Sale or Restaurant Sale) to complete this sale.');
    }
  }

  if (source === 'website') paymentMethod = 'WEBSITE PAYMENT';

  // ✅ Every POS sale is automatically linked to the logged-in staff member's
  // active shift — staff never type their own name, and a sale can't be
  // completed at all without having clicked "Start Work" first.
  let activeShift = null;
  if (source === 'store') {
    if (!staffUserId) throw new CheckoutError('You must be logged in to complete a sale.');
    try {
      activeShift = await requireActiveShift(staffUserId);
    } catch (err) {
      if (err instanceof ShiftError) throw new CheckoutError(err.message);
      throw err;
    }
  }

  const resolvedDeliveryMethod = deliveryMethod || (source === 'store' ? 'pickup' : 'delivery');

  if (resolvedDeliveryMethod === 'delivery' && !address?.trim()) {
    throw new CheckoutError('Delivery address is required for delivery orders.');
  }

  // Resolve delivery fee SERVER-SIDE — never trust a fee sent from the browser.
  let deliveryFee = 0;
  let deliveryFeeSet = true;
  if (resolvedDeliveryMethod === 'delivery') {
    if (!deliveryZoneId) {
      // No recognized zone selected — matches existing behaviour: order can
      // still be placed, but waits for admin to set the fee manually before
      // it can be paid/verified.
      deliveryFeeSet = false;
    } else {
      const zone = await DeliveryZone.findOne({ _id: deliveryZoneId, active: true });
      if (!zone) throw new CheckoutError('Selected delivery zone is not available.');
      deliveryFee = zone.fee;
    }
  }

  const inv = await Inventory.getSingleton();
  const extrasCatalog = {};
  for (const [key, entry] of inv.extras.entries()) {
    extrasCatalog[key] = { label: entry.label, price: entry.price, usesPlastic: entry.usesPlastic };
  }

  let priced;
  try {
    priced = priceOrder({ ...cart, deliveryFee: 0 }, extrasCatalog); // delivery kept separate from item pricing
  } catch (err) {
    if (err instanceof PricingError) throw new CheckoutError(err.message);
    throw err;
  }

  // ✅ Generic menu items — Shawarma/Hotdog and anything else in MenuItem,
  // sold the same way the POS sells meal combos. Ingredients are validated
  // and deducted here; a plain, non-ingredient-linked item (drinks, sides,
  // etc.) just adds its price with no ingredient effect.
  const menuItemLines = Array.isArray(cart?.menuItems) ? cart.menuItems : [];
  const resolvedMenuItems = [];
  for (const line of menuItemLines) {
    const menuItem = await MenuItem.findById(line.menuItemId);
    if (!menuItem) throw new CheckoutError('One of the selected menu items no longer exists.');
    if (!menuItem.available) throw new CheckoutError(`${menuItem.name} is currently unavailable.`);
    const quantity = Math.max(1, Number(line.quantity) || 1);
    resolvedMenuItems.push({ menuItem, quantity });
  }
  if (resolvedMenuItems.length) {
    await assertIngredientsAvailable(resolvedMenuItems); // throws "Insufficient X Stock." if short
  }
  const menuItemsTotal = resolvedMenuItems.reduce((sum, { menuItem, quantity }) => sum + menuItem.price * quantity, 0);

  const items = [
    ...priced.mealPackages.map((mp) => ({
      name: `${mp.meals.map((m) => (m === 'friedRice' ? 'Fried Rice' : m === 'jollof' ? 'Jollof' : 'Spaghetti')).join(' + ')}${mp.protein !== 'none' ? ` + ${mp.protein}` : ''}`,
      price: mp.lineTotal,
      quantity: 1,
      meta: mp,
    })),
    ...priced.extras.map((e) => ({ name: e.label, price: e.unitPrice, quantity: e.qty, meta: e })),
    ...resolvedMenuItems.map(({ menuItem, quantity }) => ({
      name: menuItem.name,
      price: menuItem.price,
      quantity,
      menu_item_id: menuItem._id,
    })),
  ];

  const itemsSubtotal = priced.mealsTotal + priced.extrasTotal + menuItemsTotal;

  // ⚠️ Discounts can ONLY be applied on 'store' (POS) sales — the website
  // checkout is public/unauthenticated, so honoring a client-supplied
  // discount there would let anyone set their own price. This is a
  // deliberate, hard restriction, not a default.
  const isStoreSale = source === 'store';
  let resolvedDiscountAmount = 0;
  let resolvedDiscountLabel = '';
  if (isStoreSale && Number(discountAmount) > 0) {
    resolvedDiscountAmount = Math.min(Number(discountAmount), itemsSubtotal);
    resolvedDiscountLabel = String(discountLabel || '').trim().slice(0, 80);
  }
  const discountedSubtotal = itemsSubtotal - resolvedDiscountAmount;

  const settings = await Settings.findOne();
  const taxEnabled = !!settings?.tax?.enabled;
  const taxRate = settings?.tax?.rate || 0;
  const taxAmount = taxEnabled ? Math.round(discountedSubtotal * (taxRate / 100)) : 0;
  const totalAmount = discountedSubtotal + taxAmount + (deliveryFeeSet ? deliveryFee : 0);

  // ✅ Split Payment must add up to EXACTLY the order total — never trust
  // the client's own math, even though the POS UI already enforces this.
  if (source === 'store' && paymentMethod === 'SPLIT') {
    const paidTotal = splitPayments.reduce((sum, e) => sum + Number(e.amount), 0);
    // Naira amounts are whole numbers in this app; a fraction of a kobo of
    // float drift is tolerated, anything more is a real mismatch.
    if (Math.abs(paidTotal - totalAmount) > 0.5) {
      throw new CheckoutError(
        paidTotal < totalAmount
          ? `Split payment is short by ₦${(totalAmount - paidTotal).toLocaleString()}.`
          : `Split payment exceeds the total by ₦${(paidTotal - totalAmount).toLocaleString()}.`
      );
    }
  }

  const order = new Order({
    customerEmail: customerEmail || 'store-sale@solohans.local',
    customerName,
    phone,
    address: resolvedDeliveryMethod === 'delivery' ? address : '',
    notes,
    items,
    items_subtotal: itemsSubtotal,
    discount_amount: resolvedDiscountAmount,
    discount_label: resolvedDiscountLabel,
    tax_enabled: taxEnabled,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    totalAmount,
    delivery_method: resolvedDeliveryMethod,
    delivery_fee: resolvedDeliveryMethod === 'pickup' ? 0 : (deliveryFeeSet ? deliveryFee : null),
    delivery_fee_set: resolvedDeliveryMethod === 'pickup' ? true : deliveryFeeSet,
    source,
    paymentMethod,
    staffName,
    pos_sale_type: isStoreSale ? posSaleType : null,
    splitPayments: isStoreSale && paymentMethod === 'SPLIT'
      ? splitPayments.map((e) => ({ method: e.method, amount: Number(e.amount) }))
      : [],
    staffId: isStoreSale ? staffUserId : null,
    staffNameSnapshot: isStoreSale ? staffName : '',
    shiftId: isStoreSale ? activeShift._id : null,
    mealPackages: priced.mealPackages,
    storeExtras: priced.extras,
    lunchBoxesUsed: priced.lunchBoxesUsed,
    mealsTotal: priced.mealsTotal,
    extrasTotal: priced.extrasTotal,
    platform,
    externalOrderId: platform !== 'Walk-in' ? trimmedExternalOrderId : '',
    order_type: isStoreSale ? 'store' : 'card',
    // Store sales are handed over and paid for on the spot — treat as
    // already complete, matching the "Completed" terminal pickup stage.
    status: isStoreSale ? 'Completed' : 'Pending',
    payment_status: isStoreSale || markPaidImmediately ? 'paid' : 'unpaid',
    // ✅ POS sales (Cash, Transfer, POS/Card, or Split) are verified the
    // instant the cashier completes checkout — the cashier has already
    // confirmed the money changed hands, so there's nothing left to verify
    // manually. Website orders are untouched here; they're verified
    // separately by routes/payments.js once Paystack confirms the charge.
    verification_status: isStoreSale ? 'Verified' : 'Not Verified',
    // These orders are deducted from the shared Inventory system (rice
    // scoops / spaghetti plastics / lunch boxes) immediately below — NOT
    // via the old MenuItem-based deductStockForOrder() that runs on first
    // admin approval. Marking this true prevents that legacy path from
    // ever double-processing (or erroring on) a combo order's items.
    stockDeducted: true,
  });

  // Deduct shared inventory the moment the sale is committed.
  await deductStockForOrder(priced, { orderId: order._id, performedBy: staffName || paymentMethod });
  if (resolvedMenuItems.length) {
    await deductIngredientsForOrder(resolvedMenuItems, { orderId: order._id, performedBy: staffName || paymentMethod });
  }

  try {
    await order.save();
  } catch (err) {
    if (err?.code === 11000 && err?.keyPattern?.externalOrderId) {
      throw new CheckoutError(`A ${platform} order with ID "${trimmedExternalOrderId}" has already been recorded.`);
    }
    throw err;
  }

  return { order, priced, paymentTag: PAYMENT_TAGS[paymentMethod] };
}

export { PAYMENT_TAGS };