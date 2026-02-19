// routes/bookingRoutes.js
import express from 'express';
import {
  authenticate,
  authorize,
  isUser,
  isRider,
  isAdmin
} from '../middleware/authMiddleware.js';
import {
  calculateFareController,
  createBooking,
  getBookingDetails,
  getUserBookings,
  getRiderBookings,
  findNearbyRiders,
  broadcastBooking,
  broadcastToNearbyRiders,
  acceptBooking,
  rejectBooking,
  driverArrived,
  verifyOtpAndStartTrip,
  completeTrip,
  cancelBooking,
  updateLiveLocation,
  generateInvoice
} from '../controllers/bookingController.js';

const router = express.Router();

// Public routes
router.post('/calculate-fare', calculateFareController);

// Protected routes
router.use(authenticate);

// User routes
router.post('/', isUser, createBooking);
router.get('/user/my-bookings', isUser, getUserBookings);
router.get('/:id/invoice', generateInvoice);

// Rider routes
router.get('/rider/my-bookings', isRider, getRiderBookings);
router.post('/:id/accept', isRider, acceptBooking);
router.post('/:id/reject', isRider, rejectBooking);
router.post('/:id/driver-arrived', isRider, driverArrived);
router.post('/:id/verify-otp', isRider, verifyOtpAndStartTrip);
router.post('/:id/complete', isRider, completeTrip);
router.post('/:id/location', isRider, updateLiveLocation);

// Common routes
router.get('/nearby-riders', findNearbyRiders);
router.get('/:id', getBookingDetails);
router.post('/:id/cancel', cancelBooking);

// Admin routes
router.post('/:id/broadcast', isAdmin, broadcastBooking);

export default router;