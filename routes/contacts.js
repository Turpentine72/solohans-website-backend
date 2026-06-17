import express from 'express';
import Contact from '../models/Contact.js';
import { protect } from '../middleware/auth.js';
import { sendContactAlertToAdmin, sendContactReplyToClient } from '../utils/emailTemplates.js';
import createNotification from '../utils/createNotification.js';

const router = express.Router();

// POST a new contact message (public)
router.post('/', async (req, res) => {
  try {
    const contact = await Contact.create(req.body);

    sendContactAlertToAdmin(contact).catch(err =>
      console.error('Contact alert error:', err)
    );

    createNotification({
      type: 'new_contact',
      message: `New message from ${contact.name}`,
      relatedId: contact._id,
    });

    res.status(201).json(contact);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET all contacts (admin only)
router.get('/', protect, async (req, res) => {
  try {
    res.json(await Contact.find().sort({ createdAt: -1 }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH reply (admin replies)
router.patch('/:id/reply', protect, async (req, res) => {
  try {
    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { reply: req.body.reply, replied: true },
      { new: true }
    );
    if (!contact) return res.status(404).json({ message: 'Contact not found' });

    sendContactReplyToClient(contact).catch(err =>
      console.error('Contact reply error:', err)
    );

    res.json(contact);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE a contact message (admin only)
router.delete('/:id', protect, async (req, res) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id);
    if (!contact) return res.status(404).json({ message: 'Contact not found' });
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
