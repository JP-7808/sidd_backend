// routes/webhookRoutes.js
import express from 'express';
import { razorpayWebhook } from '../controllers/paymentController.js';

const router = express.Router();

// IMPORTANT: Disable body parser for webhooks to get raw body
router.post('/razorpay', express.raw({ type: 'application/json' }), razorpayWebhook);

export default router;