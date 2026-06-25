import express from 'express';
import AuditLog from '../models/AuditLog.js';
import { protect, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, requireRole('admin'), async (req, res) => {
  try {
    const logs = await AuditLog.find().sort('-timestamp').limit(200);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;