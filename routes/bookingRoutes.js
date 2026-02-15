import express from 'express';
import {
  createBooking,
  getBooking,
  trackBooking,
  getBookingOTP,
  calculateFareEstimate,
  getNearbyCabs,
  cancelBooking,
  updateBookingStatus,
  getAvailableBookingsForRiders,
  debugBooking
} from '../controllers/bookingController.js';
import { authenticate, authorize, authenticateOptional } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/calculate-fare', authenticateOptional, calculateFareEstimate);
router.get('/nearby-cabs', authenticateOptional, getNearbyCabs);

// Protected routes
router.use(authenticate);

// User booking routes
router.post('/', authorize('USER'), createBooking);
router.get('/:id', getBooking);
router.get('/:id/track', trackBooking);
router.get('/:id/otp', authorize('USER'), getBookingOTP);
router.post('/:id/cancel', authorize('USER'), cancelBooking);

// Rider routes
router.get('/rider/available', authorize('RIDER'), getAvailableBookingsForRiders);
router.get('/:id/debug', debugBooking);
router.put('/:id/status', authorize('RIDER', 'ADMIN'), updateBookingStatus);

export default router;