// controllers/transferController.js
import axios from 'axios';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Helper: create a reusable axios instance
const paystack = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
});

// 1. Create a transfer recipient (bank account you want to send money to)
export const createRecipient = async (req, res) => {
  const { name, account_number, bank_code, currency = 'NGN' } = req.body;
  try {
    const response = await paystack.post('/transferrecipient', {
      type: 'nuban',
      name,
      account_number,
      bank_code,
      currency,
    });
    res.json(response.data); // contains recipient_code
  } catch (error) {
    res.status(400).json(error.response?.data || { message: error.message });
  }
};

// 2. Initiate a transfer (send money)
export const initiateTransfer = async (req, res) => {
  const { recipient_code, amount, reason } = req.body;
  try {
    const response = await paystack.post('/transfer', {
      source: 'balance',       // funds from your Paystack balance
      amount: Math.round(amount * 100), // amount in kobo
      recipient: recipient_code,
      reason,
    });
    res.json(response.data);
  } catch (error) {
    res.status(400).json(error.response?.data || { message: error.message });
  }
};

// 3. Finalize a transfer (if OTP is required)
export const finalizeTransfer = async (req, res) => {
  const { transfer_code, otp } = req.body;
  try {
    const response = await paystack.post('/transfer/finalize_transfer', {
      transfer_code,
      otp,
    });
    res.json(response.data);
  } catch (error) {
    res.status(400).json(error.response?.data || { message: error.message });
  }
};