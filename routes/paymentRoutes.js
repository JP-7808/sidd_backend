import express from 'express';
import {
  createPaymentOrder,
  verifyPayment,
  getPaymentDetails,
  processCashPayment,
  processWalletPayment,
  initiateRefund,
  getPaymentHistory,
  razorpayWebhook,
  completeCashPayment
} from '../controllers/paymentController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Webhook route (no authentication needed)
router.post('/webhook/razorpay', razorpayWebhook);

// Protected routes
router.use(authenticate);

// Payment routes
router.post('/create-order', authorize('USER'), createPaymentOrder);
router.post('/verify', authorize('USER'), verifyPayment);
router.post('/complete-cash', authorize('USER'), completeCashPayment);
router.get('/booking/:bookingId', getPaymentDetails);
router.post('/cash', authorize('RIDER'), processCashPayment);
router.post('/wallet', authorize('USER'), processWalletPayment);
router.post('/refund', authorize('ADMIN'), initiateRefund);
router.get('/history', getPaymentHistory);

export default router;