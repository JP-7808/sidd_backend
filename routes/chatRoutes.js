import express from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import { sendMessage, getMessages, markAsRead, getUnreadCount } from '../controllers/chatController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Send message
router.post('/send', sendMessage);

// Get messages for a booking
router.get('/:bookingId', getMessages);

// Mark messages as read
router.put('/:bookingId/read', markAsRead);

// Get unread count
router.get('/unread/count', getUnreadCount);

export default router;