// routes/paymentRoutes.js
import express from 'express';
import {
  authenticate,
  authorize,
  isUser,
  isAdmin
} from '../middleware/authMiddleware.js';
import {
  createOrder,
  verifyPayment,
  processCashPayment,
  processWalletPayment,
  getPaymentDetails,
  getUserPayments,
  processRefund,
  getPaymentStats
} from '../controllers/paymentController.js';

const router = express.Router();

// Protected routes
router.use(authenticate);

// User routes
router.post('/create-order', isUser, createOrder);
router.post('/verify', isUser, verifyPayment);
router.post('/cash', isUser, processCashPayment);
router.post('/wallet', isUser, processWalletPayment);
router.get('/user/my-payments', isUser, getUserPayments);
router.get('/:id', getPaymentDetails);

// Admin routes
router.post('/:id/refund', isAdmin, processRefund);
router.get('/admin/stats', isAdmin, getPaymentStats);

export default router;