// backend/middleware/rateLimit.js
// A minimal, dependency-free rate limiter. Not distributed (per-process,
// in-memory) — fine for this app's single-instance deployment. Protects
// against brute-force login/password-reset attempts, which previously had
// no rate limiting at all.

const buckets = new Map(); // key -> [timestamps]

// Periodic cleanup so this never grows unbounded over a long-running process.
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, timestamps] of buckets.entries()) {
    const kept = timestamps.filter((t) => t > cutoff);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
  }
}, 5 * 60 * 1000).unref();

export function rateLimit({ max = 10, windowMs = 15 * 60 * 1000, message = 'Too many attempts — please try again later.' } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (buckets.get(key) || []).filter((t) => t > windowStart);

    if (timestamps.length >= max) {
      return res.status(429).json({ message });
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    next();
  };
}