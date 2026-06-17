// routes/transfer.js
import express from 'express';
import axios from 'axios';

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';

const paystack = axios.create({
  baseURL: PAYSTACK_BASE,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    'Content-Type': 'application/json',
  },
});

const handleError = (error, res) => {
  const status = error.response?.status || 500;
  const message = error.response?.data?.message || error.message || 'Transfer failed';
  res.status(status).json({ success: false, message });
};

// Create recipient
router.post('/recipient', async (req, res) => {
  try {
    const { name, account_number, bank_code, currency = 'NGN' } = req.body;
    if (!name || !account_number || !bank_code) {
      return res.status(400).json({ success: false, message: 'Missing fields: name, account_number, bank_code' });
    }
    const { data } = await paystack.post('/transferrecipient', {
      type: 'nuban',
      name,
      account_number,
      bank_code,
      currency,
    });
    res.json({ success: true, data: data.data });
  } catch (error) {
    handleError(error, res);
  }
});

// Initiate transfer
router.post('/transfer', async (req, res) => {
  try {
    const { recipient_code, amount, reason } = req.body;
    if (!recipient_code || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'recipient_code and positive amount required' });
    }
    const amountInKobo = Math.round(amount * 100);
    const { data } = await paystack.post('/transfer', {
      source: 'balance',
      amount: amountInKobo,
      recipient: recipient_code,
      reason: reason || 'Payout',
    });
    res.json({ success: true, data: data.data });
  } catch (error) {
    handleError(error, res);
  }
});

// Finalize transfer
router.post('/transfer/finalize', async (req, res) => {
  try {
    const { transfer_code, otp } = req.body;
    if (!transfer_code || !otp) {
      return res.status(400).json({ success: false, message: 'transfer_code and otp required' });
    }
    const { data } = await paystack.post('/transfer/finalize_transfer', {
      transfer_code,
      otp,
    });
    res.json({ success: true, data: data.data });
  } catch (error) {
    handleError(error, res);
  }
});

// List banks
router.get('/banks', async (req, res) => {
  try {
    const { data } = await paystack.get('/bank');
    res.json({ success: true, data: data.data });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;