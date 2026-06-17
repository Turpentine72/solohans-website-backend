// utils/getSettings.js
import Settings from '../models/Settings.js';

let cachedSettings = null;
let lastFetch = 0;
const CACHE_TTL = 60_000; // 1 minute

export default async function getSettings() {
  if (cachedSettings && Date.now() - lastFetch < CACHE_TTL) {
    return cachedSettings;
  }
  const settings = await Settings.findOne();
  cachedSettings = settings;
  lastFetch = Date.now();
  return settings;
}