// backend/utils/checkout.js
import Order from '../models/Order.js';
import { priceOrder, PricingError } from './pricing.js';
import { deductStockForOrder } from './stockEngine.js';
import Inventory from '../models/Inventory.js';

export class CheckoutError extends Error {}

const PAYMENT_TAGS = {
  CASH: '🟢 CASH',
  TRANSFER: '🔵 TRANSFER',
  POS: '🟣 POS',
  'WEBSITE PAYMENT': '🌐 WEBSITE PAYMENT',
};

/**
 * Builds a priced, stock-checked order and persists it.
 * cart = {
 *   mealPackages: [{ meals: ['jollof'], protein: 'regularChicken', extraPortions: [] }],
 *   extras: [{ item: 'plantain', qty: 1 }],
 *   deliveryFee
 * }
 */
export async function createOrderFromCheckout({
  cart,
  source,               // 'store' | 'website'
  paymentMethod,        // 'CASH' | 'TRANSFER' | 'POS' | 'WEBSITE PAYMENT'
  staffName = '',
  customerName = '',
  customerEmail = '',
  phone = '',
  address = '',
  order_type = source === 'store' ? 'store' : 'card',
  markPaidImmediately = false,
}) {
  if (source === 'store' && !['CASH', 'TRANSFER', 'POS'].includes(paymentMethod)) {
    throw new CheckoutError('A payment method (Cash, Transfer or POS) is required to complete a store sale.');
  }
  if (source === 'website') paymentMethod = 'WEBSITE PAYMENT';

  const inv = await Inventory.getSingleton();
  const extrasCatalog = {};
  for (const [key, entry] of inv.extras.entries()) {
    extrasCatalog[key] = { label: entry.label, price: entry.price, usesPlastic: entry.usesPlastic };
  }

  let priced;
  try {
    priced = priceOrder(cart, extrasCatalog);
  } catch (err) {
    if (err instanceof PricingError) throw new CheckoutError(err.message);
    throw err;
  }

  // Items array kept for backward-compat display in existing Orders UI
  const items = [
    ...priced.mealPackages.map((mp) => ({
      name: `${mp.meals.map((m) => (m === 'friedRice' ? 'Fried Rice' : m === 'jollof' ? 'Jollof' : 'Spaghetti')).join(' + ')}${mp.protein !== 'none' ? ` + ${mp.protein}` : ''}`,
      price: mp.lineTotal,
      quantity: 1,
      meta: mp,
    })),
    ...priced.extras.map((e) => ({ name: e.label, price: e.unitPrice, quantity: e.qty, meta: e })),
  ];

  const order = new Order({
    customerEmail: customerEmail || 'store-sale@solohans.local',
    customerName,
    phone,
    address,
    items,
    totalAmount: priced.totalAmount,
    mealsTotal: priced.mealsTotal,
    extrasTotal: priced.extrasTotal,
    delivery_fee: priced.deliveryFee,
    source,
    paymentMethod,
    staffName,
    mealPackages: priced.mealPackages,
    storeExtras: priced.extras,
    lunchBoxesUsed: priced.lunchBoxesUsed,
    order_type,
    status: markPaidImmediately || source === 'store' ? 'Paid' : 'Pending',
    payment_status: markPaidImmediately || source === 'store' ? 'paid' : 'unpaid',
  });

  // Deduct shared inventory the moment the sale is committed
  await deductStockForOrder(priced, { orderId: order._id, performedBy: staffName || paymentMethod });

  await order.save();

  return { order, priced, paymentTag: PAYMENT_TAGS[paymentMethod] };
}

export { PAYMENT_TAGS };