import express from 'express';
import Review from '../models/Review.js';
import { protect } from '../middleware/auth.js';
import {
  sendNewReviewAlertToAdmin,
  sendAutoReplyToReviewer,
  sendReviewReplyToClient
} from '../utils/emailTemplates.js';
import createNotification from '../utils/createNotification.js';

const router = express.Router();

// GET all reviews (with optional status filter)
router.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    res.json(await Review.find(query).sort({ createdAt: -1 }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST a new review (public)
router.post('/', async (req, res) => {
  try {
    const review = await Review.create(req.body);

    // 🚀 Send emails (non‑blocking)
    sendNewReviewAlertToAdmin(review).catch(err =>
      console.error('Admin alert error:', err)
    );
    if (review.email) {
      sendAutoReplyToReviewer(review).catch(err =>
        console.error('Auto reply error:', err)
      );
    }

    // Notification
    createNotification({
      type: 'new_review',
      message: `New review from ${review.customer_name} (${review.rating} ⭐)`,
      relatedId: review._id,
    });

    res.status(201).json(review);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH status (admin only)
router.patch('/:id/status', protect, async (req, res) => {
  try {
    res.json(await Review.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    ));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH featured (admin only)
router.patch('/:id/featured', protect, async (req, res) => {
  try {
    res.json(await Review.findByIdAndUpdate(
      req.params.id,
      { featured: req.body.featured },
      { new: true }
    ));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH reply (admin replies to a review)
router.patch('/:id/reply', protect, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { reply: req.body.reply },
      { new: true }
    );
    if (!review) return res.status(404).json({ message: 'Review not found' });

    // Send reply email to client
    sendReviewReplyToClient(review).catch(err =>
      console.error('Reply email error:', err)
    );

    res.json(review);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ✅ NEW: Generic update for all fields (admin – used for adding images, editing text, etc.)
router.patch('/:id', protect, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!review) return res.status(404).json({ message: 'Not found' });
    res.json(review);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE
router.delete('/:id', protect, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;