// backend/utils/pricing.js
// Central source of truth for meal combos, protein pricing and portion-deduction rules.
// Mirrored on the frontend in src/lib/pricing.js — keep both in sync.

export const MEAL_TYPES = ['jollof', 'friedRice', 'spaghetti'];
export const RICE_TYPES = ['jollof', 'friedRice'];

export const MEAL_LABELS = {
  jollof: 'Jollof Rice',
  friedRice: 'Fried Rice',
  spaghetti: 'Spaghetti',
};

// Allowed single & combo selections (max 2 meals, no repeats)
export const ALLOWED_COMBOS = [
  ['jollof'],
  ['friedRice'],
  ['spaghetti'],
  ['jollof', 'friedRice'],
  ['jollof', 'spaghetti'],
  ['friedRice', 'spaghetti'],
];

export const PROTEIN_PRICES = {
  none: 3000,
  regularChicken: 4500,
  bigChicken: 5500,
  extraBigChicken: 6500,
  regularTurkey: 6500,
  bigTurkey: 8500,
};

export const PROTEIN_LABELS = {
  none: 'Meal Only',
  regularChicken: 'Regular Chicken',
  bigChicken: 'Big Chicken',
  extraBigChicken: 'Extra Big Chicken',
  regularTurkey: 'Regular Turkey',
  bigTurkey: 'Big Turkey',
};

// ✅ Chicken and Turkey are deliberately separate groups — never combined
// into one flat list — so the UI can render two clearly labeled sections.
export const CHICKEN_PROTEINS = ['none', 'regularChicken', 'bigChicken', 'extraBigChicken'];
export const TURKEY_PROTEINS = ['regularTurkey', 'bigTurkey'];

export const EXTRA_PORTION_PRICE = 1500;

// Default catalog for standalone extras (admin can override prices via /api/inventory)
export const DEFAULT_EXTRAS_CATALOG = {
  hotdog: { label: 'Hotdog', price: 500, usesPlastic: false },
  water: { label: 'Water', price: 500, usesPlastic: false },
  drinks: { label: 'Drinks', price: 1000, usesPlastic: false },
  plantainSmall: { label: 'Plantain Small', price: 1000, usesPlastic: true },
  plantainBig: { label: 'Plantain Big', price: 2000, usesPlastic: true },
  coleslawSmall: { label: 'Coleslaw Small', price: 1000, usesPlastic: true },
  coleslawBig: { label: 'Coleslaw Big', price: 2000, usesPlastic: true },
  salad: { label: 'Salad', price: 1000, usesPlastic: true },
};

export class PricingError extends Error {}

function normalizeMeals(meals) {
  const uniq = Array.from(new Set(meals || []));
  return uniq;
}

export function validateCombo(meals) {
  const uniq = normalizeMeals(meals);
  if (uniq.length === 0) throw new PricingError('Select at least 1 meal.');
  if (uniq.length > 2) throw new PricingError('You can only mix a maximum of 2 meals.');
  if (!uniq.every((m) => MEAL_TYPES.includes(m))) {
    throw new PricingError('Invalid meal type selected.');
  }
  const isAllowed = ALLOWED_COMBOS.some(
    (combo) => combo.length === uniq.length && combo.every((m) => uniq.includes(m))
  );
  if (!isAllowed) throw new PricingError('That meal combination is not allowed.');
  return uniq;
}

/**
 * Computes exact scoop / plastic deductions for one meal package,
 * following the "one meal = 4 units" rule:
 *   - Single rice meal  -> 4 scoops of that rice
 *   - Single spaghetti  -> 2 plastics
 *   - Mixed rice+rice   -> 2 scoops each
 *   - Mixed rice+spaghetti -> 2 scoops of rice + 1 plastic of spaghetti
 */
export function computePortionDeductions(meals) {
  const uniq = validateCombo(meals);
  const scoopDeductions = {}; // { jollof: n, friedRice: n }
  let spaghettiPlastics = 0;

  if (uniq.length === 1) {
    const only = uniq[0];
    if (only === 'spaghetti') {
      spaghettiPlastics = 2;
    } else {
      scoopDeductions[only] = 4;
    }
  } else {
    // exactly 2 meals
    uniq.forEach((m) => {
      if (m === 'spaghetti') {
        spaghettiPlastics = 1;
      } else {
        scoopDeductions[m] = 2;
      }
    });
  }

  return { scoopDeductions, spaghettiPlastics };
}

/**
 * One extra portion of a given meal type.
 * Extra Rice -> 2 scoops, Extra Spaghetti -> 1 plastic. Both cost ₦1,500.
 */
export function computeExtraPortionDeduction(mealType) {
  if (mealType === 'spaghetti') return { scoopDeductions: {}, spaghettiPlastics: 1 };
  if (RICE_TYPES.includes(mealType)) return { scoopDeductions: { [mealType]: 2 }, spaghettiPlastics: 0 };
  throw new PricingError('Invalid extra portion meal type.');
}

export function proteinPrice(protein) {
  const key = protein || 'none';
  if (!(key in PROTEIN_PRICES)) throw new PricingError('Invalid protein selection.');
  return PROTEIN_PRICES[key];
}

/**
 * Builds a full priced meal-package line from raw selection input.
 * selection = { meals: ['jollof','spaghetti'], protein: 'regularChicken', extraPortions: ['jollof'] }
 */
export function priceMealPackage(selection = {}) {
  const meals = validateCombo(selection.meals);
  const protein = selection.protein || 'none';
  const basePrice = proteinPrice(protein);

  const { scoopDeductions, spaghettiPlastics } = computePortionDeductions(meals);

  const extraPortions = Array.isArray(selection.extraPortions) ? selection.extraPortions : [];
  let extraScoops = { ...scoopDeductions };
  let extraSpaghettiPlastics = spaghettiPlastics;
  let extraPortionsTotal = 0;

  const extraPortionLines = extraPortions.map((mealType) => {
    if (!meals.includes(mealType)) {
      throw new PricingError('Extra portion must match a meal already in the order.');
    }
    const d = computeExtraPortionDeduction(mealType);
    Object.entries(d.scoopDeductions).forEach(([k, v]) => {
      extraScoops[k] = (extraScoops[k] || 0) + v;
    });
    extraSpaghettiPlastics += d.spaghettiPlastics;
    extraPortionsTotal += EXTRA_PORTION_PRICE;
    return { mealType, price: EXTRA_PORTION_PRICE, ...d };
  });

  return {
    meals,
    protein,
    basePrice,
    scoopDeductions: extraScoops,
    spaghettiPlastics: extraSpaghettiPlastics,
    extraPortions: extraPortionLines,
    extraPortionsTotal,
    lineTotal: basePrice + extraPortionsTotal,
    lunchBoxUsed: 1,
  };
}

/**
 * Prices a whole order made of 1..N meal packages + standalone extras.
 * order = { mealPackages: [selection, selection...], extras: [{ item: 'plantain', qty: 2 }] , deliveryFee }
 */
export function priceOrder(order = {}, extrasCatalog = DEFAULT_EXTRAS_CATALOG) {
  const mealPackages = Array.isArray(order.mealPackages) ? order.mealPackages : [];
  const hasMenuItems = Array.isArray(order.menuItems) && order.menuItems.length > 0;
  if (mealPackages.length === 0 && !hasMenuItems && (!order.extras || order.extras.length === 0)) {
    throw new PricingError('Order must contain at least one item.');
  }

  const pricedMeals = mealPackages.map(priceMealPackage);

  const extrasInput = Array.isArray(order.extras) ? order.extras : [];
  const pricedExtras = extrasInput.map(({ item, qty }) => {
    const catalogEntry = extrasCatalog[item];
    if (!catalogEntry) throw new PricingError(`Unknown extra item: ${item}`);
    const quantity = Math.max(1, Number(qty) || 1);
    return {
      item,
      label: catalogEntry.label,
      qty: quantity,
      unitPrice: catalogEntry.price,
      usesPlastic: !!catalogEntry.usesPlastic,
      total: catalogEntry.price * quantity,
    };
  });

  const mealsTotal = pricedMeals.reduce((sum, m) => sum + m.lineTotal, 0);
  const extrasTotal = pricedExtras.reduce((sum, e) => sum + e.total, 0);
  const deliveryFee = Number(order.deliveryFee) || 0;

  return {
    mealPackages: pricedMeals,
    extras: pricedExtras,
    mealsTotal,
    extrasTotal,
    deliveryFee,
    totalAmount: mealsTotal + extrasTotal + deliveryFee,
    lunchBoxesUsed: pricedMeals.length, // 1 lunch box per meal package sold
  };
}