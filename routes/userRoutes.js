import express from 'express';
import {
  getUserProfile,
  updateUserProfile,
  addUserAddress,
  getUserAddresses,
  updateUserAddress,
  deleteUserAddress,
  getUserBookings,
  getBookingDetails,
  cancelBooking,
  rateRider,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  updateNotificationToken
} from '../controllers/userController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication and USER role
router.use(authenticate);
router.use(authorize('USER'));

// Profile routes
router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);

// Address routes
router.post('/addresses', addUserAddress);
router.get('/addresses', getUserAddresses);
router.put('/addresses/:id', updateUserAddress);
router.delete('/addresses/:id', deleteUserAddress);

// Booking routes
router.get('/bookings', getUserBookings);
router.get('/bookings/:id', getBookingDetails);
router.post('/bookings/:id/cancel', cancelBooking);
router.post('/bookings/:bookingId/rate', rateRider);

// Notification routes
router.get('/notifications', getUserNotifications);
router.put('/notifications/:id/read', markNotificationAsRead);
router.put('/notifications/read-all', markAllNotificationsAsRead);
router.put('/notification-token', updateNotificationToken);

export default router;