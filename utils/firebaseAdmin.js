import admin from 'firebase-admin';

// The service account JSON lives in the FIREBASE_SERVICE_ACCOUNT env var on
// Render — it is NEVER committed to git. Paste the whole JSON file's
// contents as the value of that single env var.
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT env var not set — push notifications disabled.');
    return;
  }
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    initialized = true;
    console.log('✅ Firebase Admin initialized');
  } catch (err) {
    console.error('❌ Failed to initialize Firebase Admin:', err.message);
  }
}

ensureInitialized();

export { admin, initialized as firebaseReady };
