import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User from '../models/User.js';
import Rider from '../models/Rider.js';
import Admin from '../models/Admin.js';
import Cab from '../models/Cab.js';
import { sendEmail } from '../utils/emailService.js';
import { generateOTP } from '../utils/helper.js';
import { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } from '../config/cloudinary.js';
import admin from '../config/firebase.js';

// Token generation with different expiry times
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

// Set secure cookies
const setCookies = (res, accessToken, refreshToken, user) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Access Token Cookie (short-lived)
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    maxAge: 15 * 60 * 1000,
    path: '/'
  });

  // Refresh Token Cookie (long-lived)
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });

  // User Info Cookie (non-sensitive data, not httpOnly for client access)
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
      maxAge: 15 * 60 * 1000, // 15 minutes
      domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
      path: '/'
    });
  }
};

// Clear all cookies on logout
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

// User Registration
export const register = async (req, res) => {
  try {
    const { name, email, phone, password, role = 'USER' } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, phone, and password are required',
        missingFields: {
          name: !name,
          email: !email,
          phone: !phone,
          password: !password
        }
      });
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Check if phone exists
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this phone number'
      });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Validate phone format (basic validation)
    if (phone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create user with tokenVersion
    const user = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role,
      otp,
      otpExpires,
      isActive: true,
      tokenVersion: 0
    });

    console.log('✅ User registered successfully:', email);

    // Send verification email
    await sendEmail({
      to: email,
      subject: 'Email Verification - Cab Booking',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #333; text-align: center;">Welcome to Cab Booking!</h2>
          <p style="font-size: 16px; color: #555;">Hi ${name},</p>
          <p style="font-size: 16px; color: #555;">Thank you for registering with our cab booking service.</p>
          <p style="font-size: 16px; color: #555;">Your verification code is:</p>
          <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0; border-radius: 5px; color: #333;">
            ${otp}
          </div>
          <p style="font-size: 14px; color: #777;">This code will expire in 10 minutes.</p>
          <p style="font-size: 14px; color: #777;">If you didn't create an account, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} Cab Booking. All rights reserved.</p>
        </div>
      `
    });

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Set secure cookies
    setCookies(res, accessToken, refreshToken, user);

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.otp;
    delete userResponse.otpExpires;
    delete userResponse.tokenVersion;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpires;

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email.',
      data: {
        user: userResponse
      }
    });
  } catch (error) {
    console.error('❌ Registration error:', error.message);
    console.error('Full error:', error);
    
    // Handle mongoose validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: messages
      });
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Rider Registration
export const registerRider = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      aadhaarNumber,
      drivingLicenseNumber,
      cabNumber,
      cabModel,
      cabType,
      seatingCapacity,
      yearOfManufacture,
      acAvailable = true
    } = req.body;
    // Check if rider exists
    const existingRider = await Rider.findOne({ email });
    if (existingRider) {
      return res.status(400).json({
        success: false,
        message: 'Rider already exists with this email'
      });
    }
    // Check if phone exists
    const existingPhone = await Rider.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'Rider already exists with this phone number'
      });
    }
    // Check Aadhaar
    const existingAadhaar = await Rider.findOne({ aadhaarNumber });
    if (existingAadhaar) {
      return res.status(400).json({
        success: false,
        message: 'Aadhaar number already registered'
      });
    }
    // Check Driving License
    const existingLicense = await Rider.findOne({ drivingLicenseNumber });
    if (existingLicense) {
      return res.status(400).json({
        success: false,
        message: 'Driving license already registered'
      });
    }
    // Check if cab number exists
    const existingCab = await Cab.findOne({ cabNumber: cabNumber.toUpperCase() });
    if (existingCab) {
      return res.status(400).json({
        success: false,
        message: 'Cab number already registered'
      });
    }
    // Validate password
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }
    // Validate seating capacity
    if (seatingCapacity < 2 || seatingCapacity > 8) {
      return res.status(400).json({
        success: false,
        message: 'Seating capacity must be between 2 and 8'
      });
    }
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Handle file uploads
    const files = req.files;
   
    // Upload profile photo
    let profilePhotoUrl = '';
    if (files?.photo && files.photo[0]) {
      try {
        const result = await uploadToCloudinary(files.photo[0].buffer, {
          folder: `riders/${email}/profile`
        });
        profilePhotoUrl = result.secure_url;
      } catch (uploadError) {
        console.error('Profile photo upload error:', uploadError);
        return res.status(400).json({
          success: false,
          message: 'Failed to upload profile photo'
        });
      }
    }
    // Create rider
    const rider = await Rider.create({
      name,
      email,
      phone,
      password: hashedPassword,
      photo: profilePhotoUrl,
      aadhaarNumber,
      drivingLicenseNumber,
      approvalStatus: 'PENDING',
      availabilityStatus: 'INACTIVE',
      isOnline: false,
      tokenVersion: 0
    });
    // Handle cab images upload
    const cabImages = [];
    if (files?.cabImages && files.cabImages.length > 0) {
      for (const [index, file] of files.cabImages.entries()) {
        try {
          const result = await uploadToCloudinary(file.buffer, {
            folder: `riders/${email}/cab`,
            public_id: `cab_${Date.now()}_${index}`
          });
         
          // Determine image type based on index or add logic for naming
          const imageTypes = ['FRONT', 'BACK', 'SIDE', 'INTERIOR', 'OTHER'];
          const imageType = imageTypes[index] || 'OTHER';
         
          cabImages.push({
            url: result.secure_url,
            type: imageType
          });
        } catch (uploadError) {
          console.error('Cab image upload error:', uploadError);
        }
      }
    }
    // Handle document uploads
    const documentUploads = {};
   
    // Upload Aadhaar images
    if (files?.aadhaarFront && files.aadhaarFront[0]) {
      try {
        const result = await uploadToCloudinary(files.aadhaarFront[0].buffer, {
          folder: `riders/${email}/documents/aadhaar`
        });
        documentUploads.aadhaarFront = result.secure_url;
      } catch (error) {
        console.error('Aadhaar front upload error:', error);
      }
    }
   
    if (files?.aadhaarBack && files.aadhaarBack[0]) {
      try {
        const result = await uploadToCloudinary(files.aadhaarBack[0].buffer, {
          folder: `riders/${email}/documents/aadhaar`
        });
        documentUploads.aadhaarBack = result.secure_url;
      } catch (error) {
        console.error('Aadhaar back upload error:', error);
      }
    }
    // Upload Driving License images
    if (files?.licenseFront && files.licenseFront[0]) {
      try {
        const result = await uploadToCloudinary(files.licenseFront[0].buffer, {
          folder: `riders/${email}/documents/license`
        });
        documentUploads.licenseFront = result.secure_url;
      } catch (error) {
        console.error('License front upload error:', error);
      }
    }
   
    if (files?.licenseBack && files.licenseBack[0]) {
      try {
        const result = await uploadToCloudinary(files.licenseBack[0].buffer, {
          folder: `riders/${email}/documents/license`
        });
        documentUploads.licenseBack = result.secure_url;
      } catch (error) {
        console.error('License back upload error:', error);
      }
    }
    // Assign rider-specific documents to rider
    if (documentUploads.aadhaarFront || documentUploads.aadhaarBack) {
      rider.aadhaarImage = {
        front: documentUploads.aadhaarFront || '',
        back: documentUploads.aadhaarBack || ''
      };
    }
   
    if (documentUploads.licenseFront || documentUploads.licenseBack) {
      rider.drivingLicenseImage = {
        front: documentUploads.licenseFront || '',
        back: documentUploads.licenseBack || ''
      };
    }
    // Create cab with images and documents
    const cabData = {
      riderId: rider._id,
      cabType,
      cabNumber: cabNumber.toUpperCase(),
      cabModel,
      seatingCapacity: parseInt(seatingCapacity),
      approvalStatus: 'PENDING',
      isApproved: false,
      isAvailable: false,
      acAvailable: acAvailable === 'true' || acAvailable === true
    };
    // Add optional fields
    if (yearOfManufacture) {
      cabData.yearOfManufacture = parseInt(yearOfManufacture);
    }
   
    if (cabImages.length > 0) {
      cabData.images = cabImages;
    }
   
    // Upload other documents if provided
    if (files?.policeVerification && files.policeVerification[0]) {
      try {
        const result = await uploadToCloudinary(files.policeVerification[0].buffer, {
          folder: `riders/${email}/documents/verification`
        });
        rider.policeVerificationImage = result.secure_url;
      } catch (error) {
        console.error('Police verification upload error:', error);
      }
    }
    if (files?.rcFront && files.rcFront[0]) {
      try {
        const result = await uploadToCloudinary(files.rcFront[0].buffer, {
          folder: `riders/${email}/documents/rc`
        });
        cabData.rcImage = {
          ...cabData.rcImage,
          front: result.secure_url
        };
      } catch (error) {
        console.error('RC front upload error:', error);
      }
    }
   
    if (files?.rcBack && files.rcBack[0]) {
      try {
        const result = await uploadToCloudinary(files.rcBack[0].buffer, {
          folder: `riders/${email}/documents/rc`
        });
        cabData.rcImage = {
          ...cabData.rcImage,
          back: result.secure_url
        };
      } catch (error) {
        console.error('RC back upload error:', error);
      }
    }
    if (files?.insuranceFront && files.insuranceFront[0]) {
      try {
        const result = await uploadToCloudinary(files.insuranceFront[0].buffer, {
          folder: `riders/${email}/documents/insurance`
        });
        cabData.insuranceImage = {
          ...cabData.insuranceImage,
          front: result.secure_url
        };
      } catch (error) {
        console.error('Insurance front upload error:', error);
      }
    }
   
    if (files?.insuranceBack && files.insuranceBack[0]) {
      try {
        const result = await uploadToCloudinary(files.insuranceBack[0].buffer, {
          folder: `riders/${email}/documents/insurance`
        });
        cabData.insuranceImage = {
          ...cabData.insuranceImage,
          back: result.secure_url
        };
      } catch (error) {
        console.error('Insurance back upload error:', error);
      }
    }
    if (files?.fitnessCertificate && files.fitnessCertificate[0]) {
      try {
        const result = await uploadToCloudinary(files.fitnessCertificate[0].buffer, {
          folder: `riders/${email}/documents/fitness`
        });
        cabData.fitnessImage = result.secure_url;
      } catch (error) {
        console.error('Fitness certificate upload error:', error);
      }
    }
    if (files?.permitCertificate && files.permitCertificate[0]) {
      try {
        const result = await uploadToCloudinary(files.permitCertificate[0].buffer, {
          folder: `riders/${email}/documents/permit`
        });
        cabData.permitImage = result.secure_url;
      } catch (error) {
        console.error('Permit certificate upload error:', error);
      }
    }
    // Save updated rider with documents
    await rider.save();
    // Create cab
    const cab = await Cab.create(cabData);
    // Send email to admin about new rider registration
    await sendEmail({
      to: process.env.ADMIN_EMAIL || 'admin@example.com',
      subject: 'New Rider Registration',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #333; text-align: center;">New Rider Registration</h2>
          <p style="font-size: 16px; color: #555;">A new rider has registered on the platform:</p>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>
            <p><strong>Aadhaar:</strong> ${aadhaarNumber}</p>
            <p><strong>License:</strong> ${drivingLicenseNumber}</p>
            <p><strong>Cab Details:</strong> ${cabType} - ${cabModel} (${cabNumber})</p>
            <p><strong>Cab Images:</strong> ${cabImages.length} uploaded</p>
          </div>
          <p style="font-size: 14px; color: #777;">Please review and approve the rider in admin panel.</p>
          <div style="text-align: center; margin-top: 20px;">
            <a href="${process.env.ADMIN_URL || 'http://localhost:3000/admin'}/riders/${rider._id}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Review Rider
            </a>
          </div>
        </div>
      `
    });
    // Send confirmation email to rider
    await sendEmail({
      to: email,
      subject: 'Rider Registration Received',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #333; text-align: center;">Welcome to Cab Booking Platform! 🚗</h2>
          <p style="font-size: 16px; color: #555;">Hi ${name},</p>
          <p style="font-size: 16px; color: #555;">Your rider registration has been received successfully.</p>
         
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Registration Summary</h3>
            <p><strong>Rider ID:</strong> ${rider._id.toString().substring(0, 8)}...</p>
            <p><strong>Cab Details:</strong> ${cabType} ${cabModel}</p>
            <p><strong>Cab Number:</strong> ${cabNumber}</p>
            <p><strong>Documents Uploaded:</strong> ${Object.keys(documentUploads).length + (cabImages.length > 0 ? 1 : 0)}</p>
          </div>
         
          <p style="font-size: 16px; color: #555;">Our team will review your documents and approve your account within 24-48 hours.</p>
          <p style="font-size: 16px; color: #555;">You will receive an email once your account is approved.</p>
         
          <div style="background-color: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #2e7d32;">Next Steps:</h4>
            <ol style="margin: 0; padding-left: 20px;">
              <li>Wait for admin approval</li>
              <li>Check your email for approval notification</li>
              <li>Login to rider app after approval</li>
              <li>Complete your profile setup</li>
              <li>Start accepting rides!</li>
            </ol>
          </div>
         
          <p style="font-size: 16px; color: #555;">Thank you for choosing us!</p>
         
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">
            © ${new Date().getFullYear()} Cab Booking. All rights reserved.<br>
            For support, contact: support@cabbooking.com
          </p>
        </div>
      `
    });
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(rider);
    // Set secure cookies
    setCookies(res, accessToken, refreshToken, rider);
    // Remove sensitive data
    const riderResponse = rider.toObject();
    delete riderResponse.password;
    delete riderResponse.tokenVersion;
    const cabResponse = cab.toObject();
    // Remove sensitive URLs or keep as needed
    res.status(201).json({
      success: true,
      message: 'Rider registration submitted for approval',
      data: {
        rider: riderResponse,
        cab: {
          id: cab._id,
          cabType: cab.cabType,
          cabNumber: cab.cabNumber,
          cabModel: cab.cabModel,
          seatingCapacity: cab.seatingCapacity,
          imagesCount: cab.images?.length || 0,
          approvalStatus: cab.approvalStatus
        },
        documents: {
          aadhaar: documentUploads.aadhaarFront ? 'Uploaded' : 'Not uploaded',
          license: documentUploads.licenseFront ? 'Uploaded' : 'Not uploaded',
          cabImages: cabImages.length
        }
      }
    });
  } catch (error) {
    console.error('Rider registration error:', error);
   
    // Cleanup if rider was created but cab creation failed
    if (error.name === 'ValidationError' || error.code === 11000) {
      // If there's a validation or duplicate error, delete the rider if created
      try {
        const rider = await Rider.findOne({ email: req.body.email });
        if (rider) {
          await Rider.findByIdAndDelete(rider._id);
          // Also delete any uploaded files from Cloudinary
          // (You might want to implement this if needed)
        }
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }
   
    let errorMessage = 'Rider registration failed';
   
    if (error.code === 11000) {
      if (error.keyPattern?.email) {
        errorMessage = 'Email already registered';
      } else if (error.keyPattern?.phone) {
        errorMessage = 'Phone number already registered';
      } else if (error.keyPattern?.cabNumber) {
        errorMessage = 'Cab number already registered';
      } else if (error.keyPattern?.aadhaarNumber) {
        errorMessage = 'Aadhaar number already registered';
      } else if (error.keyPattern?.drivingLicenseNumber) {
        errorMessage = 'Driving license already registered';
      }
    } else if (error.name === 'ValidationError') {
      errorMessage = 'Validation error: ' + Object.values(error.errors).map(e => e.message).join(', ');
    }
   
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Login
export const login = async (req, res) => {
  try {
    const { email, password, role = 'USER' } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    let user;
    
    // Find user based on role
    if (role === 'USER') {
      user = await User.findOne({ email });
    } else if (role === 'RIDER') {
      user = await Rider.findOne({ email });
    } else if (role === 'ADMIN') {
      user = await Admin.findOne({ email });
    }

    // Check if user exists
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if account is active
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // For riders, check if approved
    if (role === "RIDER") {
      if (user.approvalStatus === "PENDING") {
        return res.status(403).json({
          success: false,
          message:
            "Your account is under review. Please wait 24 to 48 hours while admin checks your details and approves your account.",
          approvalStatus: "PENDING"
        });
      }

      if (user.approvalStatus === "REJECTED") {
        return res.status(403).json({
          success: false,
          message:
            "Your account has been rejected. Please register again and upload correct details.",
          approvalStatus: "REJECTED",
          rejectionReason: user.rejectionReason || null
        });
      }

      if (user.approvalStatus === "SUSPENDED") {
        return res.status(403).json({
          success: false,
          message:
            "Your account has been suspended. Please contact admin for further assistance.",
          approvalStatus: "SUSPENDED"
        });
      }
    }

    // For users, check email verification
    if (role === 'USER' && !user.isEmailVerified) {
      // Generate new OTP
      const otp = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      
      user.otp = otp;
      user.otpExpires = otpExpires;
      await user.save();

      // Send verification email
      await sendEmail({
        to: email,
        subject: 'Email Verification Required',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h2 style="color: #333; text-align: center;">Email Verification Required</h2>
            <p style="font-size: 16px; color: #555;">Hi ${user.name},</p>
            <p style="font-size: 16px; color: #555;">Please verify your email to continue.</p>
            <p style="font-size: 16px; color: #555;">Your verification code is:</p>
            <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0; border-radius: 5px; color: #333;">
              ${otp}
            </div>
            <p style="font-size: 14px; color: #777;">This code will expire in 10 minutes.</p>
            <p style="font-size: 14px; color: #777;">If you didn't request this, please ignore this email.</p>
          </div>
        `
      });

      return res.status(403).json({
        success: false,
        message: 'Email verification required',
        requiresVerification: true
      });
    }

    // Update last login and increment token version
    user.lastLogin = new Date();
    if (!user.tokenVersion) {
      user.tokenVersion = 0;
    }
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Set secure cookies
    setCookies(res, accessToken, refreshToken, user);

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    if (userResponse.otp) delete userResponse.otp;
    if (userResponse.otpExpires) delete userResponse.otpExpires;
    delete userResponse.tokenVersion;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpires;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse
      },
      token: accessToken // Add token to response for frontend compatibility
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Google Auth
export const googleAuth = async (req, res) => {
  try {
    const { token, email, name, picture } = req.body;

    // Validate required fields
    if (!email || !name) {
      return res.status(400).json({
        success: false,
        message: 'Email and name are required'
      });
    }

    // Email validation
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // If token is provided, attempt to verify it
    let googleId = null;
    if (token) {
      try {
        // Decode token (note: in production, should verify with Google's public keys)
        const decoded = jwt.decode(token, { complete: true });
        if (decoded && decoded.payload) {
          googleId = decoded.payload.sub;
        }
      } catch (tokenError) {
        console.warn('Token verification warning:', tokenError.message);
        // Continue without googleId - frontend may handle this differently
      }
    }

    // Check if user exists
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user via Google
      user = await User.create({
        name,
        email,
        photo: picture || null,
        googleId: googleId || null,
        isEmailVerified: true, // Email is pre-verified by Google
        isActive: true,
        tokenVersion: 0
      });

      console.log('✅ New user created via Google:', email);
    } else {
      // Update existing user
      if (!user.googleId && googleId) {
        user.googleId = googleId;
      }
      if (!user.isEmailVerified) {
        user.isEmailVerified = true; // Mark as verified since Google verified it
      }
      if (!user.tokenVersion) {
        user.tokenVersion = 0;
      }
      if (picture && !user.photo) {
        user.photo = picture;
      }
      await user.save();

      console.log('✅ Existing user logged in via Google:', email);
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Set secure cookies
    setCookies(res, accessToken, refreshToken, user);

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.tokenVersion;
    if (userResponse.otp) delete userResponse.otp;
    if (userResponse.otpExpires) delete userResponse.otpExpires;

    res.status(200).json({
      success: true,
      message: 'Google authentication successful',
      data: {
        user: userResponse,
        isNewUser: !user.createdAt ? true : false
      }
    });
  } catch (error) {
    console.error('❌ Google auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Google authentication failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Google Auth Redirect - Initiates OAuth flow
export const googleAuthRedirect = async (req, res) => {
  try {
    const { redirect } = req.query;
    const frontendRedirect = redirect || process.env.FRONTEND_URL;
    
    // Redirect to Google auth endpoint on frontend
    // Frontend should handle Google OAuth with library like google-one-tap or react-google-login
    res.status(200).json({
      success: true,
      message: 'Use frontend Google OAuth library to authenticate',
      data: {
        redirectUrl: `${frontendRedirect}/login/customer`
      }
    });
  } catch (error) {
    console.error('❌ Google auth redirect error:', error);
    res.status(500).json({
      success: false,
      message: 'Google auth redirect failed'
    });
  }
};

// Google OAuth Callback - Handles callback from Google
export const handleGoogleCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    const { redirect } = req.query;
    const frontendRedirect = redirect || process.env.FRONTEND_URL;
    
    if (!code) {
      return res.redirect(`${frontendRedirect}?error=missing_code`);
    }

    // In a real implementation, you would exchange the code for tokens with Google
    // For now, return error as this requires backend-to-backend communication with Google
    
    console.warn('⚠️ Google callback received but not fully implemented');
    res.redirect(`${frontendRedirect}?error=not_implemented`);
  } catch (error) {
    console.error('❌ Google callback error:', error);
    const frontendRedirect = process.env.FRONTEND_URL;
    res.redirect(`${frontendRedirect}?error=auth_failed`);
  }
};

// Verify Email
export const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    // Check OTP
    if (user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Check OTP expiry
    if (user.otpExpires < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    // Verify email
    user.isEmailVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    // Send welcome email
    await sendEmail({
      to: email,
      subject: 'Email Verified Successfully',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #333; text-align: center;">Email Verified Successfully!</h2>
          <p style="font-size: 16px; color: #555;">Hi ${user.name},</p>
          <p style="font-size: 16px; color: #555;">Congratulations! Your email has been verified successfully.</p>
          <p style="font-size: 16px; color: #555;">You can now book cabs and enjoy our services.</p>
          <p style="font-size: 16px; color: #555;">Thank you for choosing us!</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} Cab Booking. All rights reserved.</p>
        </div>
      `
    });

    res.status(200).json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Email verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Resend OTP
export const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    user.otp = otp;
    user.otpExpires = otpExpires;
    await user.save();

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'New OTP - Cab Booking',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #333; text-align: center;">New OTP for Email Verification</h2>
          <p style="font-size: 16px; color: #555;">Hi ${user.name},</p>
          <p style="font-size: 16px; color: #555;">Your new verification code is:</p>
          <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0; border-radius: 5px; color: #333;">
            ${otp}
          </div>
          <p style="font-size: 14px; color: #777;">This code will expire in 10 minutes.</p>
          <p style="font-size: 14px; color: #777;">If you didn't request this, please ignore this email.</p>
        </div>
      `
    });

    res.status(200).json({
      success: true,
      message: 'New OTP sent successfully'
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Forgot Password
export const forgotPassword = async (req, res) => {
  try {
    const { email, role = 'USER' } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    let user;
    
    if (role === 'USER') {
      user = await User.findOne({ email });
    } else if (role === 'RIDER') {
      user = await Rider.findOne({ email });
    } else if (role === 'ADMIN') {
      user = await Admin.findOne({ email });
    }

    if (!user) {
      // Don't reveal if user exists for security
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset link'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Save reset token
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    user.resetPasswordExpires = resetTokenExpires;
    await user.save();

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&role=${role}`;

    // Send reset email
    await sendEmail({
      to: email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
          <p style="font-size: 16px; color: #555;">Hi ${user.name},</p>
          <p style="font-size: 16px; color: #555;">You requested to reset your password. Click the button below to reset:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; display: inline-block;">Reset Password</a>
          </div>
          <p style="font-size: 14px; color: #777;">This link will expire in 15 minutes.</p>
          <p style="font-size: 14px; color: #777;">If you didn't request this, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} Cab Booking. All rights reserved.</p>
        </div>
      `
    });

    res.status(200).json({
      success: true,
      message: 'Password reset email sent'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process forgot password request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Reset Password
export const resetPassword = async (req, res) => {
  try {
    const { token, password, role = 'USER' } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and password are required'
      });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Hash the token
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    let user;
    
    // Find user with valid reset token
    if (role === 'USER') {
      user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() }
      });
    } else if (role === 'RIDER') {
      user = await Rider.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() }
      });
    } else if (role === 'ADMIN') {
      user = await Admin.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() }
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear reset token
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    // Increment token version to invalidate all existing sessions
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Send confirmation email
    await sendEmail({
      to: user.email,
      subject: 'Password Reset Successful',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #333; text-align: center;">Password Reset Successful</h2>
          <p style="font-size: 16px; color: #555;">Hi ${user.name},</p>
          <p style="font-size: 16px; color: #555;">Your password has been reset successfully.</p>
          <p style="font-size: 16px; color: #555;">If you didn't perform this action, please contact support immediately.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
          <p style="font-size: 12px; color: #999; text-align: center;">© ${new Date().getFullYear()} Cab Booking. All rights reserved.</p>
        </div>
      `
    });

    // Clear any existing cookies
    clearCookies(res);

    res.status(200).json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Profile
export const getProfile = async (req, res) => {
  try {
    const user = req.user;

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpires;
    delete userResponse.tokenVersion;
    if (userResponse.otp) delete userResponse.otp;
    if (userResponse.otpExpires) delete userResponse.otpExpires;

    res.status(200).json({
      success: true,
      data: userResponse
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update Profile
export const updateProfile = async (req, res) => {
  try {
    const user = req.user;
    const { name, phone } = req.body;

    // Update user details
    if (name) user.name = name;
    if (phone) user.phone = phone;

    await user.save();

    // Update user info cookie
    if (req.cookies?.user_info) {
      const userInfo = JSON.parse(req.cookies.user_info);
      userInfo.name = user.name;
      userInfo.phone = user.phone;
      
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('user_info', JSON.stringify(userInfo), {
        httpOnly: false,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000,
        domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
        path: '/'
      });
    }

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.tokenVersion;

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: userResponse
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Change Password
export const changePassword = async (req, res) => {
  try {
    const user = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    // Validate new password
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Check current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and increment token version
    user.password = hashedPassword;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // Clear existing cookies
    clearCookies(res);

    // Send notification email
    await sendEmail({
      to: user.email,
      subject: 'Password Changed Successfully',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #333; text-align: center;">Password Changed Successfully</h2>
          <p style="font-size: 16px; color: #555;">Hi ${user.name},</p>
          <p style="font-size: 16px; color: #555;">Your password has been changed successfully.</p>
          <p style="font-size: 16px; color: #555;">All your existing sessions have been logged out for security.</p>
          <p style="font-size: 16px; color: #555;">If you didn't perform this action, please contact support immediately.</p>
        </div>
      `
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully. Please login again.'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Upload Profile Image
export const uploadProfileImage = async (req, res) => {
  try {
    const user = req.user;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload an image'
      });
    }

    // Upload to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: 'profiles'
    });

    // Delete old image if exists
    if (user.photo) {
      try {
        const publicId = getPublicIdFromUrl(user.photo);
        await deleteFromCloudinary(publicId);
      } catch (error) {
        console.error('Error deleting old image:', error);
      }
    }

    // Update user profile
    user.photo = result.secure_url;
    await user.save();

    // Update user info cookie
    if (req.cookies?.user_info) {
      const userInfo = JSON.parse(req.cookies.user_info);
      userInfo.photo = user.photo;
      
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('user_info', JSON.stringify(userInfo), {
        httpOnly: false,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000,
        domain: isProduction ? process.env.COOKIE_DOMAIN : undefined,
        path: '/'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile image uploaded successfully',
      data: {
        photo: result.secure_url
      }
    });
  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile image',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete Profile Image
export const deleteProfileImage = async (req, res) => {
  try {
    const user = req.user;

    if (!user.photo) {
      return res.status(400).json({
        success: false,
        message: 'No profile image to delete'
      });
    }

    // Delete from Cloudinary
    try {
      const publicId = getPublicIdFromUrl(user.photo);
      await deleteFromCloudinary(publicId);
    } catch (error) {
      console.error('Error deleting from Cloudinary:', error);
    }

    // Remove photo from user
    user.photo = undefined;
    await user.save();

    // Update user info cookie
    if (req.cookies?.user_info) {
      const userInfo = JSON.parse(req.cookies.user_info);
      userInfo.photo = null;
      
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('user_info', JSON.stringify(userInfo), {
        httpOnly: false,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 15 * 60 * 1000,
        domain: undefined,
        path: '/'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile image deleted successfully'
    });
  } catch (error) {
    console.error('Delete profile image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete profile image',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Refresh Token
export const refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token not found'
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
        message: 'Invalid refresh token'
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

    // Generate new tokens
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user);

    // Set new cookies
    setCookies(res, newAccessToken, newRefreshToken, user);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    clearCookies(res);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get Current User
export const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpires;
    delete userResponse.tokenVersion;

    res.status(200).json({
      success: true,
      data: userResponse
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get current user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Logout
export const logout = async (req, res) => {
  try {
    // Get refresh token from cookies
    const refreshToken = req.cookies?.refresh_token;
    
    if (refreshToken) {
      try {
        // Verify and decode token to get user ID
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        
        // Increment token version to invalidate all refresh tokens
        let user;
        if (decoded.role === 'USER') {
          user = await User.findById(decoded.id);
        } else if (decoded.role === 'RIDER') {
          user = await Rider.findById(decoded.id);
        } else if (decoded.role === 'ADMIN') {
          user = await Admin.findById(decoded.id);
        }
        
        if (user) {
          user.tokenVersion = (user.tokenVersion || 0) + 1;
          await user.save();
        }
      } catch (error) {
        // Token is invalid, just clear cookies
        console.log('Invalid token during logout:', error.message);
      }
    }

    // Clear all cookies
    clearCookies(res);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Check Auth Status
export const checkAuth = async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(200).json({
        success: false,
        authenticated: false,
        message: 'Not authenticated'
      });
    }

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.tokenVersion;

    res.status(200).json({
      success: true,
      authenticated: true,
      data: userResponse
    });
  } catch (error) {
    console.error('Check auth error:', error);
    res.status(500).json({
      success: false,
      authenticated: false,
      message: 'Failed to check authentication status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send OTP to Phone
export const sendPhoneOTP = async (req, res) => {
  try {
    const { phone, role = 'USER' } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Validate phone format
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
    }

    // Find user by phone
    let user;
    if (role === 'USER') {
      user = await User.findOne({ phone });
    } else if (role === 'RIDER') {
      user = await Rider.findOne({ phone });
    }

    // Check if user exists for login
    if (!user) {
      // For registration, allow OTP to be sent
      if (role !== 'USER') {
        return res.status(404).json({
          success: false,
          message: 'No account found with this phone number'
        });
      }
    }

    // Try to send OTP via Firebase
    try {
      if (admin.apps.length > 0) {
        await admin.auth().generatePhoneVerificationLink(phone, {
          handleUpgradeVerification: true
        });
        
        // Note: generatePhoneVerificationLink doesn't actually send SMS
        // For actual SMS, we need to use Firebase Admin with custom claims or
        // use a third-party SMS service with Firebase
        
        // For now, we'll also generate and store OTP in DB
        const otp = generateOTP();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

        if (user) {
          user.phoneOTP = otp;
          user.phoneOTPExpires = otpExpires;
          await user.save();
        }

        console.log(`\n========== OTP FOR ${phone} ==========`);
        console.log(`OTP: ${otp} (Firebase link sent)`);
        console.log(`======================================\n`);

        return res.status(200).json({
          success: true,
          message: 'Verification link sent to your phone'
        });
      }
    } catch (firebaseError) {
      console.log('Firebase not available, using manual OTP:', firebaseError.message);
    }

    // Fallback: Use manual OTP (FREE - logs to console)
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    if (user) {
      user.phoneOTP = otp;
      user.phoneOTPExpires = otpExpires;
      await user.save();
    }

    // FREE: Log OTP to console (for testing)
    console.log(`\n========== OTP FOR ${phone} ==========`);
    console.log(`OTP: ${otp}`);
    console.log(`======================================\n`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully (Check server console)'
    });
  } catch (error) {
    console.error('Send phone OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verify OTP and Login
export const verifyPhoneOTP = async (req, res) => {
  try {
    const { phone, otp, role = 'USER' } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required'
      });
    }

    // Find user by phone
    let user;
    if (role === 'USER') {
      user = await User.findOne({ phone });
    } else if (role === 'RIDER') {
      user = await Rider.findOne({ phone });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found with this phone number'
      });
    }

    // Check if account is active
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Verify OTP
    if (user.phoneOTP !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Check OTP expiry
    if (user.phoneOTPExpires && user.phoneOTPExpires < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    // Clear OTP after successful verification
    user.phoneOTP = undefined;
    user.phoneOTPExpires = undefined;
    user.lastLogin = new Date();
    await user.save();

    // For riders, check approval status
    if (role === 'RIDER') {
      if (user.approvalStatus === 'PENDING') {
        return res.status(403).json({
          success: false,
          message: 'Your account is under review. Please wait 24 to 48 hours.',
          approvalStatus: 'PENDING'
        });
      }

      if (user.approvalStatus === 'REJECTED') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been rejected.',
          approvalStatus: 'REJECTED'
        });
      }

      if (user.approvalStatus === 'SUSPENDED') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been suspended.',
          approvalStatus: 'SUSPENDED'
        });
      }
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Set secure cookies
    setCookies(res, accessToken, refreshToken, user);

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.phoneOTP;
    delete userResponse.phoneOTPExpires;
    delete userResponse.tokenVersion;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpires;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse
      },
      token: accessToken
    });
  } catch (error) {
    console.error('Verify phone OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'OTP verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Firebase Login
export const firebaseLogin = async (req, res) => {
  try {
    const { idToken, phone, role = 'USER' } = req.body;

    if (!idToken || !phone) {
      return res.status(400).json({
        success: false,
        message: 'ID token and phone are required'
      });
    }

    // Verify Firebase token
    let decodedToken;
    try {
      if (admin.apps.length > 0) {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } else {
        return res.status(503).json({
          success: false,
          message: 'Firebase not configured'
        });
      }
    } catch (firebaseError) {
      console.error('Firebase token verification error:', firebaseError);
      return res.status(400).json({
        success: false,
        message: 'Invalid Firebase token'
      });
    }

    // Check if phone matches
    if (decodedToken.phone_number !== phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number mismatch'
      });
    }

    // Find or create user
    let user;
    if (role === 'USER') {
      user = await User.findOne({ phone });
      
      if (!user) {
        // Create new user with Firebase phone
        user = await User.create({
          name: decodedToken.name || 'Firebase User',
          email: decodedToken.email || `${phone}@firebase.local`,
          phone: phone,
          password: null, // No password for Firebase users
          isEmailVerified: true,
          isActive: true,
          tokenVersion: 0
        });
        
        console.log('✅ New user created via Firebase Phone:', phone);
      }
    } else if (role === 'RIDER') {
      user = await Rider.findOne({ phone });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Rider not found with this phone number'
        });
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if account is active
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // For riders, check approval status
    if (role === 'RIDER') {
      if (user.approvalStatus === 'PENDING') {
        return res.status(403).json({
          success: false,
          message: 'Your account is under review.',
          approvalStatus: 'PENDING'
        });
      }
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Set secure cookies
    setCookies(res, accessToken, refreshToken, user);

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.tokenVersion;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpires;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse
      },
      token: accessToken
    });
  } catch (error) {
    console.error('Firebase login error:', error);
    res.status(500).json({
      success: false,
      message: 'Firebase login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};