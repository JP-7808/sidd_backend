import express from 'express';
import {
  getRiderProfile,
  updateRiderProfile,
  updateRiderDocuments,
  updateRiderLocation,
  toggleOnlineStatus,
  getAvailableBookings,
  getNearbyCustomers,
  acceptBookingRequest,
  rejectBookingRequest,
  startRide,
  completeRide,
  startReturnRide,
  completeReturnRide,
  getRiderEarnings,
  getRiderRatings,
  updateCabDetails,
  getRiderNotifications,
  updateTripStatus,
  getNearbyRidersForCustomers,
  debugBookingStatus,
  getRiderById,
  // resetAllRidersAndCabs
} from '../controllers/riderController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import { uploadCabDocuments, handleUploadError } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Multer configuration for rider documents
import multer from 'multer';
const storage = multer.memoryStorage();
const uploadDocuments = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDFs are allowed'), false);
    }
  }
});

// ========== PUBLIC ROUTES (no authentication required) ==========
router.get('/nearby-riders', getNearbyRidersForCustomers);
// Debug route – inline authentication
router.get('/bookings/:id/debug', authenticate, authorize('RIDER'), debugBookingStatus);
// Temporary reset route (commented out)
// router.post('/admin/reset-all', resetAllRidersAndCabs);

// ========== AUTHENTICATION REQUIRED (any logged-in user) ==========
router.use(authenticate);

// ----- Specific routes (must come BEFORE /:id) -----
router.get('/profile', getRiderProfile);
router.get('/earnings', getRiderEarnings);
router.get('/available-bookings', getAvailableBookings);
router.get('/nearby-customers', getNearbyCustomers);
router.get('/ratings', getRiderRatings);
router.get('/notifications', getRiderNotifications);

router.put('/profile', updateRiderProfile);
router.put('/documents', uploadDocuments.fields([
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'drivingLicenseFront', maxCount: 1 },
  { name: 'drivingLicenseBack', maxCount: 1 },
  { name: 'policeVerification', maxCount: 1 },
]), updateRiderDocuments);
router.put('/location', updateRiderLocation);
router.put('/online-status', toggleOnlineStatus);
router.put('/cab', uploadCabDocuments, handleUploadError, updateCabDetails);

// ----- Parameterized route – must be AFTER all specific GET routes -----
router.get('/:id', getRiderById);

// ========== RIDER-ONLY ROUTES ==========
router.use(authorize('RIDER'));

// Booking routes (rider only)
router.post('/bookings/accept', acceptBookingRequest);
router.post('/bookings/:bookingId/reject', rejectBookingRequest);
// router.post('/bookings/:bookingId/start', startRide);
router.post('/bookings/:bookingId/complete', completeRide);
router.post('/bookings/update-status', updateTripStatus);

// Round trip routes
router.post('/bookings/:bookingId/return/start', startReturnRide);
router.post('/bookings/:bookingId/return/complete', completeReturnRide);

export default router;