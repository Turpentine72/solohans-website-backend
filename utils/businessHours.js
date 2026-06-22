// Nigeria (Africa/Lagos) does not observe Daylight Saving Time, so it is
// always a fixed UTC+1. This lets us check business hours reliably without
// pulling in a timezone library.

export function getLagosTime() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000; // true UTC ms
  const lagosMs = utcMs + 60 * 60000; // UTC+1
  return new Date(lagosMs);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Returns true if orders are currently allowed.
export function isWithinBusinessHours(settings) {
  const bh = settings?.businessHours;
  if (!bh || !bh.enabled) return true; // enforcement is opt-in

  const lagosNow = getLagosTime();
  const nowMinutes = lagosNow.getHours() * 60 + lagosNow.getMinutes();
  const open = toMinutes(bh.openTime || '08:00');
  const close = toMinutes(bh.closeTime || '22:00');

  if (open === close) return true; // treat equal open/close as "always open"

  if (open < close) {
    // Normal same-day window, e.g. 08:00 – 22:00
    return nowMinutes >= open && nowMinutes < close;
  }
  // Overnight window, e.g. 18:00 – 02:00
  return nowMinutes >= open || nowMinutes < close;
}
