import express from 'express';
import {
  register,
  registerRider,
  login,
  googleAuth,
  verifyEmail,
  resendOTP,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  changePassword,
  uploadProfileImage,
  deleteProfileImage,
  refreshToken,
  getCurrentUser,
  logout,
  checkAuth,
  googleAuthRedirect,
  handleGoogleCallback
} from '../controllers/authController.js';
import { 
  authenticate, 
  authorize, 
  authenticateOptional,
  requireEmailVerification 
} from '../middleware/authMiddleware.js';
import { 
  uploadRiderDocuments, 
  uploadProfileImage as uploadMiddleware, 
  handleUploadError 
} from '../middleware/uploadMiddleware.js';

const router = express.Router();

// Public routes (no authentication required)
router.post('/register', register);
router.post('/register-rider', uploadRiderDocuments, handleUploadError, registerRider);
router.post('/login', login);
router.post('/google-auth', googleAuth);
router.get('/google', googleAuthRedirect);
router.get('/google/callback', handleGoogleCallback);
router.post('/verify-email', verifyEmail);
router.post('/resend-otp', resendOTP);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/refresh-token', refreshToken);

// Check authentication status (public route)
router.get('/check', authenticateOptional, checkAuth);

// Protected routes (authentication required)
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.put('/change-password', authenticate, changePassword);
router.post('/upload-profile', 
  authenticate, 
  uploadMiddleware, 
  handleUploadError, 
  uploadProfileImage
);
router.delete('/profile-image', authenticate, deleteProfileImage);
router.get('/me', authenticate, getCurrentUser);
router.post('/logout', authenticate, logout);

// Email verification required routes
router.get('/protected-data', 
  authenticate, 
  requireEmailVerification, 
  (req, res) => {
    res.json({
      success: true,
      message: 'This is protected data',
      data: { secret: 'You can only see this after email verification' }
    });
  }
);

// Role-based protected routes
router.get('/admin-only', 
  authenticate, 
  authorize('ADMIN'), 
  (req, res) => {
    res.json({
      success: true,
      message: 'Welcome Admin!',
      data: { adminData: 'Sensitive admin information' }
    });
  }
);

router.get('/rider-only', 
  authenticate, 
  authorize('RIDER'), 
  (req, res) => {
    res.json({
      success: true,
      message: 'Welcome Rider!',
      data: { riderData: 'Rider specific information' }
    });
  }
);

router.get('/user-only', 
  authenticate, 
  authorize('USER'), 
  (req, res) => {
    res.json({
      success: true,
      message: 'Welcome User!',
      data: { userData: 'User specific information' }
    });
  }
);

// Combined role access
router.get('/admin-or-rider', 
  authenticate, 
  authorize('ADMIN', 'RIDER'), 
  (req, res) => {
    res.json({
      success: true,
      message: 'Welcome Admin or Rider!',
      data: { combinedData: 'Shared information' }
    });
  }
);

// Test cookie route (for debugging)
router.get('/test-cookies', (req, res) => {
  res.json({
    success: true,
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    headers: {
      cookie: req.headers.cookie
    }
  });
});

// Health check route
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Auth service is healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

export default router;