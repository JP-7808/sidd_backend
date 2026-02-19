// routes/webhookRoutes.js
import express from 'express';
import { razorpayWebhook } from '../controllers/paymentController.js';

const router = express.Router();

// Raw body needed for webhook signature verification
router.post('/razorpay', express.raw({ type: 'application/json' }), razorpayWebhook);

export default router;