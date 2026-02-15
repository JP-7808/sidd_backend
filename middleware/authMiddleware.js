import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Rider from '../models/Rider.js';
import Admin from '../models/Admin.js';

// Generate tokens (same as in controller)
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { 
      id: user._id, 
      email: user.email, 
      role: user.role 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '15m' }
  );

  const refreshToken = jwt.sign(
    { 
      id: user._id,
      role: user.role,
      tokenVersion: user.tokenVersion || 0 
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d' }
  );

  return { accessToken, refreshToken };
};

// Set cookies (same as in controller)
const setCookies = (res, accessToken, refreshToken, user) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Access Token Cookie
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000,
    domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
    path: '/'
  });

  // Refresh Token Cookie
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
    path: '/'
  });

  // User Info Cookie
  if (user) {
    res.cookie('user_info', JSON.stringify({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      photo: user.photo || null,
      phone: user.phone
    }), {
      httpOnly: false,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 15 * 60 * 1000,
      domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
      path: '/'
    });
  }
};

// Clear cookies (same as in controller)
const clearCookies = (res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const cookies = ['access_token', 'refresh_token', 'user_info'];
  
  cookies.forEach(cookieName => {
    res.clearCookie(cookieName, {
      httpOnly: cookieName !== 'user_info',
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
      path: '/'
    });
  });
};

// Main authentication middleware
export const authenticate = async (req, res, next) => {
  try {
    let token;
    
    // 1. Check for token in Authorization header (for API clients)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    // 2. Check for token in cookies (for web browsers)
    if (!token && req.cookies?.access_token) {
      token = req.cookies.access_token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        // Token expired, try to refresh using refresh token
        return await tryRefreshToken(req, res, next);
      }
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }
      
      throw error;
    }
    
    let user;
    
    // Find user based on role in token
    if (decoded.role === 'USER') {
      user = await User.findById(decoded.id);
    } else if (decoded.role === 'RIDER') {
      user = await Rider.findById(decoded.id);
    } else if (decoded.role === 'ADMIN') {
      user = await Admin.findById(decoded.id);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // For riders, check if approved
    if (decoded.role === 'RIDER' && user.approvalStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.approvalStatus.toLowerCase()}`
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Helper function to try refresh token
const tryRefreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Access token expired. No refresh token available.'
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (error) {
      clearCookies(res);
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token. Please login again.'
      });
    }
    
    // Find user
    let user;
    if (decoded.role === 'USER') {
      user = await User.findById(decoded.id);
    } else if (decoded.role === 'RIDER') {
      user = await Rider.findById(decoded.id);
    } else if (decoded.role === 'ADMIN') {
      user = await Admin.findById(decoded.id);
    }

    if (!user) {
      clearCookies(res);
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      clearCookies(res);
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check token version (for refresh token rotation)
    if (user.tokenVersion !== decoded.tokenVersion) {
      clearCookies(res);
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // For riders, check if approved
    if (decoded.role === 'RIDER' && user.approvalStatus !== 'APPROVED') {
      clearCookies(res);
      return res.status(403).json({
        success: false,
        message: `Account is ${user.approvalStatus.toLowerCase()}`
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    
    // Set new cookies
    setCookies(res, accessToken, newRefreshToken, user);
    
    // Attach new access token to response header for clients that need it
    res.set('X-New-Access-Token', accessToken);
    
    // Continue with the request
    req.user = user;
    next();
  } catch (error) {
    console.error('Token refresh error:', error);
    clearCookies(res);
    return res.status(401).json({
      success: false,
      message: 'Session expired. Please login again.'
    });
  }
};

// Role-based authorization middleware
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. ${req.user.role} role is not authorized for this resource.`
      });
    }

    next();
  };
};

// Optional authentication middleware
export const authenticateOptional = async (req, res, next) => {
  try {
    let token;
    
    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    // Check for token in cookies
    if (!token && req.cookies?.access_token) {
      token = req.cookies.access_token;
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        let user;
        
        // Find user based on role in token
        if (decoded.role === 'USER') {
          user = await User.findById(decoded.id);
        } else if (decoded.role === 'RIDER') {
          user = await Rider.findById(decoded.id);
        } else if (decoded.role === 'ADMIN') {
          user = await Admin.findById(decoded.id);
        }

        if (user && user.isActive) {
          // For riders, check if approved
          if (decoded.role !== 'RIDER' || user.approvalStatus === 'APPROVED') {
            req.user = user;
          }
        }
      } catch (error) {
        // Token is invalid or expired, continue without user
        if (process.env.NODE_ENV === 'development') {
          console.log('Optional auth token error:', error.message);
        }
      }
    }

    next();
  } catch (error) {
    // Continue without authentication on error
    next();
  }
};

// Verify email middleware
export const requireEmailVerification = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Only check for users (not riders or admins)
  if (req.user.role === 'USER' && !req.user.isEmailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required',
      requiresVerification: true
    });
  }

  next();
};

// Check if user is owner or admin
export const isOwnerOrAdmin = (resourceUserId) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Admin can access any resource
    if (req.user.role === 'ADMIN') {
      return next();
    }

    // User can only access their own resources
    if (req.user._id.toString() === resourceUserId.toString()) {
      return next();
    }

    // Rider can access their own resources
    if (req.user.role === 'RIDER' && req.user._id.toString() === resourceUserId.toString()) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'You do not have permission to access this resource'
    });
  };
};

// Check if user is admin
export const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  next();
};

// Check if user is rider
export const isRider = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'RIDER') {
    return res.status(403).json({
      success: false,
      message: 'Rider access required'
    });
  }

  next();
};

// Check if user is regular user
export const isUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'USER') {
    return res.status(403).json({
      success: false,
      message: 'User access required'
    });
  }

  next();
};

// Rate limiting middleware (simple version)
export const rateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    
    if (!requests.has(ip)) {
      requests.set(ip, []);
    }
    
    const userRequests = requests.get(ip);
    
    // Remove requests older than windowMs
    const windowStart = now - windowMs;
    while (userRequests.length > 0 && userRequests[0] < windowStart) {
      userRequests.shift();
    }
    
    // Check if rate limit exceeded
    if (userRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }
    
    // Add current request
    userRequests.push(now);
    
    // Clean up old entries (optional, for memory management)
    if (Math.random() < 0.01) {
      for (const [key, value] of requests.entries()) {
        if (value.length === 0) {
          requests.delete(key);
        }
      }
    }
    
    next();
  };
};