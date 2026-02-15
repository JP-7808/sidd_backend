import express from 'express';
import {
  getDashboardStats,
  getRiders,
  getRiderDetails,
  approveRider,
  suspendRider,
  getCabs,
  approveCab,
  getPricing,
  updatePricing,
  getBookings,
  getBookingAnalytics,
  getUsers,
  updateUserStatus,
  getPayouts,
  processPayout,
  processBulkPayouts
} from '../controllers/adminController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication and ADMIN role
router.use(authenticate);
router.use(authorize('ADMIN'));

// Dashboard
router.get('/dashboard', getDashboardStats);

// Rider Management
router.get('/riders', getRiders);
router.get('/riders/:id', getRiderDetails);
router.put('/riders/:id/approve', approveRider);
router.put('/riders/:id/suspend', suspendRider);

// Cab Management
router.get('/cabs', getCabs);
router.put('/cabs/:id/approve', approveCab);

// Pricing Management
router.get('/pricing', getPricing);
router.put('/pricing', updatePricing);

// Booking Management
router.get('/bookings', getBookings);
router.get('/bookings/analytics', getBookingAnalytics);

// User Management
router.get('/users', getUsers);
router.put('/users/:id/status', updateUserStatus);

// Payout Management
router.get('/payouts', getPayouts);
router.put('/payouts/:id/process', processPayout);
router.post('/payouts/bulk', processBulkPayouts);

export default router;