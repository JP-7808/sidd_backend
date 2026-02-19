// config/razorpay.js
import Razorpay from 'razorpay';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Razorpay instance
export const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create a Razorpay order
 * @param {number} amount - Amount in paise (INR * 100)
 * @param {string} currency - Currency code (default: INR)
 * @param {string} receipt - Receipt ID
 * @param {Object} notes - Additional notes
 * @returns {Promise<Object>} Razorpay order object
 */
export const createRazorpayOrder = async (amount, currency = 'INR', receipt, notes = {}) => {
  try {
    const options = {
      amount: amount * 100, // Convert to paise
      currency,
      receipt,
      notes,
      payment_capture: 1, // Auto-capture payment
    };

    const order = await razorpayInstance.orders.create(options);
    return order;
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    throw error;
  }
};

/**
 * Verify Razorpay payment signature
 * @param {string} orderId - Razorpay order ID
 * @param {string} paymentId - Razorpay payment ID
 * @param {string} signature - Razorpay signature
 * @returns {boolean} Verification result
 */
export const verifyPaymentSignature = (orderId, paymentId, signature) => {
  const crypto = require('crypto');
  
  const body = orderId + '|' + paymentId;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');

  return expectedSignature === signature;
};

/**
 * Fetch payment details from Razorpay
 * @param {string} paymentId - Razorpay payment ID
 * @returns {Promise<Object>} Payment details
 */
export const fetchPaymentDetails = async (paymentId) => {
  try {
    const payment = await razorpayInstance.payments.fetch(paymentId);
    return payment;
  } catch (error) {
    console.error('Error fetching payment details:', error);
    throw error;
  }
};

/**
 * Capture payment (if not auto-captured)
 * @param {string} paymentId - Razorpay payment ID
 * @param {number} amount - Amount in paise
 * @param {string} currency - Currency code
 * @returns {Promise<Object>} Captured payment details
 */
export const capturePayment = async (paymentId, amount, currency = 'INR') => {
  try {
    const payment = await razorpayInstance.payments.capture(paymentId, amount, currency);
    return payment;
  } catch (error) {
    console.error('Error capturing payment:', error);
    throw error;
  }
};

/**
 * Refund a payment
 * @param {string} paymentId - Razorpay payment ID
 * @param {number} amount - Amount in paise (optional - full refund if not specified)
 * @param {string} notes - Refund notes
 * @returns {Promise<Object>} Refund details
 */
export const refundPayment = async (paymentId, amount = null, notes = {}) => {
  try {
    const options = {
      payment_id: paymentId,
      ...(amount && { amount: amount * 100 }), // Convert to paise if amount specified
      notes,
    };

    const refund = await razorpayInstance.payments.refund(options);
    return refund;
  } catch (error) {
    console.error('Error refunding payment:', error);
    throw error;
  }
};

/**
 * Create a QR code for UPI payments
 * @param {string} name - QR code name
 * @param {number} amount - Fixed amount (optional)
 * @param {string} description - QR code description
 * @returns {Promise<Object>} QR code details
 */
export const createQRCode = async (name, amount = null, description = '') => {
  try {
    const options = {
      name,
      ...(amount && { fixed_amount: { amount: amount * 100 } }),
      description,
    };

    const qrCode = await razorpayInstance.qrCode.create(options);
    return qrCode;
  } catch (error) {
    console.error('Error creating QR code:', error);
    throw error;
  }
};

export default {
  razorpayInstance,
  createRazorpayOrder,
  verifyPaymentSignature,
  fetchPaymentDetails,
  capturePayment,
  refundPayment,
  createQRCode,
};