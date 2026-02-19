import mongoose from "mongoose";
import Rider from "../models/Rider.js";
import Cab from "../models/Cab.js";
import Booking from "../models/Booking.js";
import BookingRequest from "../models/BookingRequest.js";
import RiderEarning from "../models/RiderEarning.js";
import RiderWallet from "../models/RiderWallet.js";
import RiderActivity from "../models/RiderActivity.js";
import Notification from "../models/Notification.js";
import LiveLocation from "../models/LiveLocation.js";
import Rating from "../models/Rating.js";
import Pricing from "../models/Pricing.js";
import { calculateDistance, calculateFare } from "../utils/helper.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../config/cloudinary.js";

// Get rider profile
export const getRiderProfile = async (req, res) => {
  try {
    const rider = await Rider.findById(req.user._id).select(
      "-password -tokenVersion -resetPasswordToken -resetPasswordExpires",
    );

    // Get cab details
    const cab = await Cab.findOne({ riderId: rider._id });

    // Get wallet balance
    const wallet = await RiderWallet.findOne({ riderId: rider._id });

    // Get recent earnings
    const recentEarnings = await RiderEarning.find({ riderId: rider._id })
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      success: true,
      data: {
        rider,
        cab,
        wallet,
        recentEarnings,
      },
    });
  } catch (error) {
    console.error("Get rider profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get rider profile",
    });
  }
};

// Update rider profile
export const updateRiderProfile = async (req, res) => {
  try {
    const { name, phone } = req.body;
    const rider = req.user;

    if (name) rider.name = name;
    if (phone) {
      const existingRider = await Rider.findOne({
        phone,
        _id: { $ne: rider._id },
      });

      if (existingRider) {
        return res.status(400).json({
          success: false,
          message: "Phone number already in use",
        });
      }
      rider.phone = phone;
    }

    await rider.save();

    const riderResponse = rider.toObject();
    delete riderResponse.password;
    delete riderResponse.tokenVersion;

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: riderResponse,
    });
  } catch (error) {
    console.error("Update rider profile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
};

// Update rider location
export const updateRiderLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const riderId = req.user._id;

    // Update current location in rider document
    await Rider.findByIdAndUpdate(riderId, {
      currentLocation: {
        type: 'Point',
        coordinates: [lng, lat]
      }
    });

    // Update live location for tracking
    await LiveLocation.findOneAndUpdate(
      { riderId },
      { lat, lng, updatedAt: new Date() },
      { upsert: true }
    );

    // Update rider activity
    await RiderActivity.findOneAndUpdate(
      { riderId },
      { 
        lastLocation: { lat, lng },
        lastSeenAt: new Date()
      },
      { upsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'Location updated successfully'
    });
  } catch (error) {
    console.error('Update rider location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location'
    });
  }
};

// Toggle online status
// ============================================================
// Toggle Online Status – with automatic stale booking cleanup
// ============================================================
export const toggleOnlineStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const riderId = req.user._id;
    const { isOnline } = req.body;

    console.log('========== TOGGLE ONLINE STATUS ==========');
    console.log('Rider ID:', riderId);
    console.log('Requested status:', isOnline ? 'ONLINE' : 'OFFLINE');

    const rider = await Rider.findById(riderId).session(session);
    if (!rider) {
      await session.abortTransaction();
      return res.status(404).json({ 
        success: false, 
        message: "Rider not found" 
      });
    }

    console.log('Current rider status:', {
      isOnline: rider.isOnline,
      availabilityStatus: rider.availabilityStatus,
      currentBooking: rider.currentBooking,
      isLocked: rider.isLocked,
      lockedUntil: rider.lockedUntil
    });

    // ----- Going OFFLINE -----
    if (isOnline === false) {
      // Check if rider has an active trip
      if (rider.currentBooking) {
        const activeBooking = await Booking.findOne({
          _id: rider.currentBooking,
          bookingStatus: {
            $in: ["DRIVER_ASSIGNED", "DRIVER_ARRIVED", "TRIP_STARTED"],
          },
        }).session(session);

        if (activeBooking) {
          console.log('Cannot go offline - active trip found:', activeBooking._id);
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Cannot go offline while on an active trip",
          });
        }
      }
      
      // Update to offline
      rider.isOnline = false;
      rider.availabilityStatus = "OFFLINE";
      rider.socketId = null; // Clear socket ID when going offline
      
      console.log('Rider set to OFFLINE');
    }

    // ----- Going ONLINE -----
    if (isOnline === true) {
      // Check if rider is approved
      if (rider.approvalStatus !== 'APPROVED') {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Cannot go online. Account is ${rider.approvalStatus.toLowerCase()}`,
        });
      }

      // Check if rider has an approved cab
      const cab = await Cab.findOne({ 
        riderId, 
        isApproved: true 
      }).session(session);

      if (!cab) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Cannot go online. No approved cab found.",
        });
      }

      // 1️⃣ Clean up stale currentBooking
      if (rider.currentBooking) {
        console.log('Checking stale booking:', rider.currentBooking);
        
        const existingBooking = await Booking.findById(
          rider.currentBooking,
        ).session(session);
        
        if (!existingBooking) {
          // Booking doesn't exist anymore
          console.log('Stale booking - booking not found, clearing reference');
          rider.currentBooking = null;
          rider.isLocked = false;
          rider.lockedUntil = null;
        } else {
          const activeStatuses = [
            "DRIVER_ASSIGNED",
            "DRIVER_ARRIVED",
            "TRIP_STARTED",
          ];
          
          if (!activeStatuses.includes(existingBooking.bookingStatus)) {
            // Booking exists but is not active (completed, cancelled, etc.)
            console.log('Stale booking - booking not active, clearing reference');
            rider.currentBooking = null;
            rider.isLocked = false;
            rider.lockedUntil = null;
          } else {
            // Booking is still active, cannot go online
            console.log('Active booking found - cannot go online');
            await session.abortTransaction();
            return res.status(400).json({
              success: false,
              message: "Cannot go online. You have an active trip.",
            });
          }
        }
      }

      // 2️⃣ Check if rider is locked
      if (rider.isLocked && rider.lockedUntil) {
        const now = new Date();
        if (now < rider.lockedUntil) {
          const minutesLeft = Math.round((rider.lockedUntil - now) / (1000 * 60));
          console.log(`Rider is locked for ${minutesLeft} more minutes`);
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: `Cannot go online. Account is locked for ${minutesLeft} more minutes.`,
          });
        } else {
          // Lock expired
          rider.isLocked = false;
          rider.lockedUntil = null;
        }
      }

      // 3️⃣ Check for any pending booking requests that might have expired
      // This is optional but good for cleanup
      await BookingRequest.updateMany(
        {
          riderId,
          status: 'PENDING',
          expiresAt: { $lt: new Date() }
        },
        {
          status: 'EXPIRED'
        },
        { session }
      );

      // 4️⃣ Set online
      rider.isOnline = true;
      rider.availabilityStatus = "AVAILABLE";
      rider.socketId = req.body.socketId || rider.socketId;
      
      console.log('Rider set to ONLINE with socket ID:', rider.socketId);
    }

    await rider.save({ session });
    await session.commitTransaction();

    console.log('✅ Toggle successful. New status:', {
      isOnline: rider.isOnline,
      availabilityStatus: rider.availabilityStatus
    });

    res.status(200).json({
      success: true,
      message: `Rider is now ${isOnline ? "online" : "offline"}`,
      data: {
        isOnline: rider.isOnline,
        availabilityStatus: rider.availabilityStatus,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("❌ Toggle online status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update online status",
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Get available bookings - Simplified and error-free
// controllers/riderController.js - Updated getAvailableBookings

export const getAvailableBookings = async (req, res) => {
  try {
    const riderId = req.user._id;
    const { lat, lng, radius = 10 } = req.query;

    console.log('========== GET AVAILABLE BOOKINGS ==========');
    console.log(`Rider ID: ${riderId}`);
    console.log(`Location: lat=${lat}, lng=${lng}, radius=${radius}`);

    // 1. Find all pending requests for this rider that haven't expired
    const pendingRequests = await BookingRequest.find({
      riderId,
      status: 'PENDING',
      expiresAt: { $gt: new Date() }
    });

    console.log(`Found ${pendingRequests.length} pending requests:`, 
      pendingRequests.map(r => ({ 
        bookingId: r.bookingId, 
        expiresAt: r.expiresAt,
        bookingType: r.bookingType
      }))
    );

    const bookingIds = pendingRequests.map(req => req.bookingId);

    if (bookingIds.length === 0) {
      console.log('No pending requests found');
      return res.json({
        success: true,
        data: []
      });
    }

    // 2. Get the actual bookings - INCLUDE SCHEDULED status!
    // For scheduled bookings, we want to show them even though they're not SEARCHING_DRIVER yet
    console.log('Looking for bookings with IDs:', bookingIds);
    console.log('Booking status filter:', ['INITIATED', 'SEARCHING_DRIVER', 'SCHEDULED']);

    const bookings = await Booking.find({
      _id: { $in: bookingIds },
      bookingStatus: { $in: ['INITIATED', 'SEARCHING_DRIVER', 'SCHEDULED'] }
    })
    .populate('userId', 'name phone rating')
    .select('pickup drop vehicleType distanceKm estimatedFare bookingStatus createdAt userId bookingType scheduledAt');

    console.log(`Found ${bookings.length} matching bookings:`, 
      bookings.map(b => ({ 
        id: b._id, 
        status: b.bookingStatus,
        vehicleType: b.vehicleType,
        bookingType: b.bookingType
      }))
    );

    // If no bookings found, check if bookings exist but with different status
    if (bookings.length === 0) {
      const allBookings = await Booking.find({
        _id: { $in: bookingIds }
      }).select('_id bookingStatus bookingType');
      
      console.log('All bookings (regardless of status):', 
        allBookings.map(b => ({ id: b._id, status: b.bookingStatus, type: b.bookingType }))
      );
    }

    // 3. Format the response data
    const formattedBookings = bookings.map(booking => {
      const pendingRequest = pendingRequests.find(r => 
        r.bookingId.toString() === booking._id.toString()
      );

      return {
        _id: booking._id,
        pickup: booking.pickup || {},
        drop: booking.drop || {},
        vehicleType: booking.vehicleType,
        distanceKm: booking.distanceKm || 0,
        estimatedFare: booking.estimatedFare || 0,
        bookingStatus: booking.bookingStatus,
        bookingType: booking.bookingType || 'IMMEDIATE',
        scheduledAt: booking.scheduledAt,
        createdAt: booking.createdAt,
        userId: booking.userId ? {
          _id: booking.userId._id,
          name: booking.userId.name || 'Customer',
          phone: booking.userId.phone,
          rating: booking.userId.rating || 4.5
        } : {
          name: 'Customer',
          rating: 4.5
        },
        expiresAt: pendingRequest?.expiresAt || null
      };
    });

    console.log(`Returning ${formattedBookings.length} formatted bookings`);
    console.log('========== END GET AVAILABLE BOOKINGS ==========');

    res.json({
      success: true,
      data: formattedBookings
    });

  } catch (error) {
    console.error('❌ Get available bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available bookings',
      error: error.message
    });
  }
};

// Accept booking request - UPDATED VERSION
// controllers/riderController.js - Updated acceptBookingRequest

export const acceptBookingRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.body;
    const riderId = req.user._id;

    console.log('========== ACCEPT BOOKING REQUEST ==========');
    console.log('1. Request received:', { bookingId, riderId });

    // Validate bookingId
    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    // 1. Find the booking request
    const bookingRequest = await BookingRequest.findOne({
      bookingId,
      riderId,
      status: 'PENDING'
    }).session(session);

    if (!bookingRequest) {
      console.log('❌ No pending booking request found');
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'No pending booking request found'
      });
    }

    console.log('2. Found booking request:', {
      id: bookingRequest._id,
      status: bookingRequest.status,
      expiresAt: bookingRequest.expiresAt,
      bookingType: bookingRequest.bookingType
    });

    // 2. Check if request has expired
    const now = new Date();
    if (now > bookingRequest.expiresAt) {
      console.log('❌ Booking request expired');
      bookingRequest.status = 'EXPIRED';
      await bookingRequest.save({ session });
      await session.commitTransaction();
      return res.status(400).json({
        success: false,
        message: 'Booking request has expired'
      });
    }

    // 3. Get the booking details
    const booking = await Booking.findById(bookingId).session(session);
    
    if (!booking) {
      console.log('❌ Booking not found');
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    console.log('3. Found booking:', {
      id: booking._id,
      status: booking.bookingStatus,
      vehicleType: booking.vehicleType,
      bookingType: booking.bookingType,
      hasRider: !!booking.riderId,
      userId: booking.userId
    });

    // 4. Check if booking is still available
    // Allow acceptance for: INITIATED, SEARCHING_DRIVER, and SCHEDULED
    const allowedStatuses = ['INITIATED', 'SEARCHING_DRIVER', 'SCHEDULED'];
    
    if (!allowedStatuses.includes(booking.bookingStatus)) {
      console.log(`❌ Booking cannot be accepted. Current status: ${booking.bookingStatus}`);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Booking cannot be accepted. Current status: ${booking.bookingStatus}`
      });
    }

    if (booking.riderId) {
      console.log('❌ Booking already has a rider assigned:', booking.riderId);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Booking already has a rider assigned'
      });
    }

    // 5. Get rider's cab
    const cab = await Cab.findOne({ 
      riderId, 
      cabType: booking.vehicleType,
      isApproved: true,
      isAvailable: true
    }).session(session);

    if (!cab) {
      console.log('❌ No available cab found for vehicle type:', booking.vehicleType);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'No available cab found for this vehicle type'
      });
    }

    console.log('4. Found cab:', {
      id: cab._id,
      cabNumber: cab.cabNumber,
      cabType: cab.cabType
    });

    // 6. Check if rider is already on another trip
    const existingTrip = await Booking.findOne({
      riderId,
      bookingStatus: { $in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED'] }
    }).session(session);

    if (existingTrip) {
      console.log('❌ Rider already has an active trip:', existingTrip._id);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'You already have an active trip'
      });
    }

    // 7. Update booking with rider and cab details
    // For scheduled bookings, keep status as SCHEDULED until closer to time
    // Or change to DRIVER_ASSIGNED immediately? Let's keep as DRIVER_ASSIGNED
    booking.riderId = riderId;
    booking.cabId = cab._id;
    booking.bookingStatus = 'DRIVER_ASSIGNED'; // Change to assigned
    booking.acceptedAt = new Date();
    booking.isBroadcastActive = false;
    await booking.save({ session });
    console.log('5. Booking updated successfully');

    // 8. Update the booking request status
    bookingRequest.status = 'ACCEPTED';
    bookingRequest.responseTime = new Date();
    await bookingRequest.save({ session });
    console.log('6. Booking request updated successfully');

    // 9. Reject all other pending requests for this booking
    const rejectResult = await BookingRequest.updateMany(
      {
        bookingId,
        riderId: { $ne: riderId },
        status: 'PENDING'
      },
      {
        status: 'REJECTED',
        responseTime: new Date()
      },
      { session }
    );

    console.log(`7. Rejected ${rejectResult.modifiedCount} other pending requests`);

    // 10. Update rider status
    await Rider.findByIdAndUpdate(
      riderId,
      {
        availabilityStatus: 'ON_TRIP',
        currentBooking: booking._id,
        isLocked: true,
        lockedUntil: new Date(Date.now() + 4 * 60 * 60 * 1000)
      },
      { session }
    );
    console.log('8. Rider status updated');

    // 11. Update cab availability
    cab.isAvailable = false;
    await cab.save({ session });
    console.log('9. Cab availability updated');

    // 12. Get user details for notification
    const User = mongoose.model('User');
    const user = await User.findById(booking.userId).select('name');
    
    // 13. Create notification for the user
    const Notification = mongoose.model('Notification');
    
    // Customize message based on booking type
    let notificationMessage = '';
    if (booking.bookingType === 'SCHEDULED') {
      notificationMessage = `Driver ${req.user.name} has accepted your scheduled ride for ${new Date(booking.scheduledAt).toLocaleString()}.`;
    } else {
      notificationMessage = `Driver ${req.user.name} has accepted your booking. They are on the way!`;
    }
    
    const userNotification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'DRIVER_ASSIGNED',
      title: booking.bookingType === 'SCHEDULED' ? 'Driver Assigned for Scheduled Ride! 📅' : 'Driver Assigned! 🚗',
      message: notificationMessage,
      data: {
        bookingId: booking._id,
        riderId,
        riderName: req.user.name,
        riderPhone: req.user.phone,
        bookingType: booking.bookingType,
        scheduledAt: booking.scheduledAt,
        cabDetails: {
          cabNumber: cab.cabNumber,
          cabModel: cab.cabModel,
          cabType: cab.cabType
        }
      }
    });
    await userNotification.save({ session });

    await session.commitTransaction();
    console.log('10. Transaction committed successfully');

    // 14. Emit socket events
    const io = req.app.get('io');
    if (io) {
      // Notify the user
      io.to(`user-${booking.userId}`).emit('driver-assigned', {
        bookingId: booking._id,
        riderId,
        riderName: req.user.name,
        riderPhone: req.user.phone,
        bookingType: booking.bookingType,
        scheduledAt: booking.scheduledAt,
        cabDetails: {
          cabNumber: cab.cabNumber,
          cabModel: cab.cabModel,
          cabType: cab.cabType
        },
        message: booking.bookingType === 'SCHEDULED' 
          ? 'Driver assigned for your scheduled ride'
          : 'Driver assigned! They are on the way!'
      });

      // Notify other riders that booking is taken
      if (booking.broadcastedTo && booking.broadcastedTo.length > 0) {
        booking.broadcastedTo.forEach(broadcastedRiderId => {
          if (broadcastedRiderId.toString() !== riderId.toString()) {
            io.to(`rider-${broadcastedRiderId}`).emit('booking-taken', {
              bookingId: booking._id
            });
          }
        });
      }
    }

    // 15. Return success response
    const populatedBooking = await Booking.findById(booking._id)
      .populate('userId', 'name phone')
      .populate('riderId', 'name phone')
      .populate('cabId');

    console.log('11. Booking accepted successfully!');

    res.json({
      success: true,
      message: booking.bookingType === 'SCHEDULED' 
        ? 'Scheduled booking accepted successfully' 
        : 'Booking accepted successfully',
      data: {
        booking: populatedBooking,
        cab,
        message: booking.bookingType === 'SCHEDULED'
          ? `Please be at the pickup location on ${new Date(booking.scheduledAt).toLocaleString()}`
          : 'Please proceed to pickup location'
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('========== ERROR IN ACCEPT BOOKING ==========');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Error accepting booking',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

export const rejectBookingRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.params;
    const riderId = req.user._id;

    console.log(`Rider ${riderId} rejecting booking ${bookingId}`);

    // 1. Find the pending booking request
    const bookingRequest = await BookingRequest.findOne({
      bookingId,
      riderId,
      status: 'PENDING'
    }).session(session);

    if (!bookingRequest) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'No pending booking request found'
      });
    }

    // 2. Update request status to REJECTED
    bookingRequest.status = 'REJECTED';
    bookingRequest.responseTime = new Date();
    await bookingRequest.save({ session });

    // 3. Increment rider's rejected rides count (for performance tracking)
    await Rider.findByIdAndUpdate(
      riderId,
      { $inc: { rejectedRides: 1 } },
      { session }
    );

    // 4. Get booking details for potential re-broadcast logic
    const booking = await Booking.findById(bookingId).session(session);
    
    // 5. Check if all riders have rejected this booking
    if (booking) {
      const pendingCount = await BookingRequest.countDocuments({
        bookingId,
        status: 'PENDING'
      }).session(session);

      // If no riders are left with pending requests, update booking status
      if (pendingCount === 0 && booking.bookingStatus === 'SEARCHING_DRIVER') {
        booking.broadcastRetryCount += 1;
        
        if (booking.broadcastRetryCount >= 3) {
          // Max retries reached, mark as no driver found
          booking.bookingStatus = 'NO_DRIVER_FOUND';
          booking.isBroadcastActive = false;
          
          // Notify user
          const notification = new Notification({
            userId: booking.userId,
            bookingId: booking._id,
            type: 'NO_DRIVER_FOUND',
            title: 'No Drivers Available',
            message: 'Sorry, no drivers are available at the moment. Please try again.',
            data: { bookingId: booking._id }
          });
          await notification.save({ session });
        }
        
        await booking.save({ session });
      }
    }

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Booking rejected successfully',
      data: {
        bookingId,
        rejectedRides: req.user.rejectedRides + 1
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Reject booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting booking',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Start ride
// In riderController.js - startRide function
export const startRide = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.params;
    const { otp } = req.body;
    const riderId = req.user._id;

    console.log(`Rider ${riderId} starting ride ${bookingId} with OTP: ${otp}`);

    // 1. Find the booking
    const booking = await Booking.findOne({
      _id: bookingId,
      riderId
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not assigned to you'
      });
    }

    // 2. Check if booking is in correct state to start
    if (!['DRIVER_ASSIGNED', 'DRIVER_ARRIVED'].includes(booking.bookingStatus)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot start ride. Current status: ${booking.bookingStatus}. Required: DRIVER_ASSIGNED or DRIVER_ARRIVED`
      });
    }

    // 3. Verify OTP
    if (!otp) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'OTP is required to start the ride'
      });
    }

    // Convert both to string for comparison
    const dbOtp = booking.otp.toString();
    const requestOtp = otp.toString();

    if (dbOtp !== requestOtp) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please check with customer.'
      });
    }

    // 4. Check OTP expiry (allow 5-minute grace period)
    const now = new Date();
    const otpExpiry = new Date(booking.otpExpiresAt);
    const timeDiffMinutes = (otpExpiry - now) / (1000 * 60);

    if (timeDiffMinutes < -5) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new OTP from customer.'
      });
    }

    // 5. Update booking status
    booking.bookingStatus = 'TRIP_STARTED';
    booking.rideStartTime = new Date();
    booking.otpVerifiedAt = new Date();
    await booking.save({ session });

    // 6. Update rider status (already ON_TRIP from acceptance, but ensure it)
    await Rider.findByIdAndUpdate(
      riderId,
      {
        availabilityStatus: 'ON_TRIP',
        currentBooking: booking._id
      },
      { session }
    );

    // 7. Create notification for user
    const userNotification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'RIDE_STARTED',
      title: 'Ride Started! 🚗',
      message: 'Your ride has started. Enjoy your journey!',
      data: {
        bookingId: booking._id,
        startTime: booking.rideStartTime
      }
    });
    await userNotification.save({ session });

    await session.commitTransaction();

    // 8. Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${booking.userId}`).emit('ride-started', {
        bookingId: booking._id,
        startTime: booking.rideStartTime
      });
    }

    res.json({
      success: true,
      message: 'Ride started successfully',
      data: {
        booking,
        rideStartTime: booking.rideStartTime
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Start ride error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start ride',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Add to riderController.js for debugging
export const debugBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const riderId = req.user._id;

    const booking = await Booking.findOne({
      _id: bookingId,
      riderId,
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        bookingId: booking._id,
        status: booking.bookingStatus,
        riderId: booking.riderId,
        otp: booking.otp,
        otpExpiresAt: booking.otpExpiresAt,
        canStartRide: ["DRIVER_ASSIGNED", "DRIVER_ARRIVED"].includes(
          booking.bookingStatus,
        ),
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("Debug booking error:", error);
    res.status(500).json({
      success: false,
      message: "Debug failed",
    });
  }
};

// Complete ride
// controllers/riderController.js - Updated completeRide with proper payment handling

/**
 * Complete the ride and handle payment based on method
 * - Cash: Mark as pending settlement (due in 3 days)
 * - Online/Razorpay: Process admin commission and mark for payout (due in 7 days)
 */
// controllers/riderController.js - Fixed completeRide function

export const completeRide = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.params;
    const { finalDistance, additionalCharges = 0 } = req.body;
    const riderId = req.user._id;

    console.log('========== COMPLETE RIDE ==========');
    console.log(`Rider ${riderId} completing ride ${bookingId}`);
    console.log('Request data:', { finalDistance, additionalCharges });

    // 1. Find the booking
    const booking = await Booking.findOne({
      _id: bookingId,
      riderId,
      bookingStatus: 'TRIP_STARTED'
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not in TRIP_STARTED status'
      });
    }

    console.log('Booking found:', {
      id: booking._id,
      vehicleType: booking.vehicleType,
      estimatedFare: booking.estimatedFare,
      paymentMethod: booking.paymentMethod
    });

    // 2. Get pricing for fare calculation
    const pricing = await Pricing.findOne({ 
      cabType: booking.vehicleType,
      isActive: true 
    }).session(session);

    if (!pricing) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Pricing configuration not found'
      });
    }

    console.log('Pricing found:', {
      baseFare: pricing.baseFare,
      pricePerKm: pricing.pricePerKm,
      adminCommissionPercent: pricing.adminCommissionPercent
    });

    // 3. Calculate final fare
    let finalFare = booking.estimatedFare;
    let adminCommission = 0;
    let riderEarning = 0;
    let distanceUsed = booking.distanceKm;

    if (finalDistance && finalDistance > 0) {
      // Use actual distance for fare calculation
      const baseFare = pricing.baseFare;
      const pricePerKm = pricing.pricePerKm;
      
      // Calculate fare based on actual distance
      finalFare = baseFare + (finalDistance * pricePerKm) + additionalCharges;
      distanceUsed = finalDistance;
      
      console.log('Fare calculation with actual distance:', {
        baseFare,
        pricePerKm,
        finalDistance,
        additionalCharges,
        calculatedFare: finalFare
      });
    } else {
      // Use estimated fare with charges
      finalFare = booking.estimatedFare + additionalCharges;
      console.log('Fare calculation with estimated distance:', {
        estimatedFare: booking.estimatedFare,
        additionalCharges,
        calculatedFare: finalFare
      });
    }

    // Calculate commission and earnings
    const adminCommissionPercent = pricing.adminCommissionPercent || 20;
    adminCommission = (finalFare * adminCommissionPercent) / 100;
    riderEarning = finalFare - adminCommission;

    console.log('Earnings calculation:', {
      finalFare,
      adminCommissionPercent,
      adminCommission,
      riderEarning
    });

    // 4. Update booking with final details
    booking.bookingStatus = 'TRIP_COMPLETED';
    booking.rideEndTime = new Date();
    booking.finalFare = Math.round(finalFare);
    booking.adminCommissionAmount = Math.round(adminCommission);
    booking.riderEarning = Math.round(riderEarning);
    
    if (finalDistance && finalDistance > 0) {
      booking.distanceKm = finalDistance;
    }
    
    await booking.save({ session });
    console.log('Booking updated with final details');

    // 5. Update rider status and stats
    const rider = await Rider.findByIdAndUpdate(
      riderId,
      {
        availabilityStatus: 'AVAILABLE',
        currentBooking: null,
        isLocked: false,
        lockedUntil: null,
        $inc: { completedRides: 1 }
      },
      { session, new: true }
    );
    console.log('Rider status updated');

    // 6. Update cab availability
    await Cab.findOneAndUpdate(
      { riderId },
      { isAvailable: true },
      { session }
    );
    console.log('Cab availability updated');

    // 7. Create rider earning record with settlement details based on payment method
    const now = new Date();
    let settlementDueDate = null;
    let payoutStatus = 'PENDING';

    // Set settlement rules based on payment method
    if (booking.paymentMethod === 'CASH') {
      // Cash payments: Rider owes money to company, due in 3 days
      settlementDueDate = new Date(now);
      settlementDueDate.setDate(settlementDueDate.getDate() + 3);
      payoutStatus = 'PENDING_SETTLEMENT';
      console.log('Cash payment - settlement due in 3 days:', settlementDueDate);
    } else if (booking.paymentMethod === 'RAZORPAY' || booking.paymentMethod === 'ONLINE') {
      // Online payments: Company owes money to rider, payout in 7 days
      settlementDueDate = new Date(now);
      settlementDueDate.setDate(settlementDueDate.getDate() + 7);
      payoutStatus = 'PENDING_PAYOUT';
      console.log('Online payment - payout due in 7 days:', settlementDueDate);
    } else {
      // Other payment methods
      settlementDueDate = new Date(now);
      settlementDueDate.setDate(settlementDueDate.getDate() + 7);
      payoutStatus = 'PENDING';
    }

    const riderEarningRecord = new RiderEarning({
      bookingId: booking._id,
      riderId,
      totalFare: booking.finalFare,
      adminCommission: booking.adminCommissionAmount,
      riderEarning: booking.riderEarning,
      payoutStatus: payoutStatus,
      settlementDueDate: settlementDueDate,
      paymentMethod: booking.paymentMethod,
      completedAt: new Date()
    });
    await riderEarningRecord.save({ session });
    console.log('Rider earning record created with status:', payoutStatus);

    // 8. Update rider wallet
    if (booking.paymentMethod === 'RAZORPAY' || booking.paymentMethod === 'ONLINE') {
      await RiderWallet.findOneAndUpdate(
        { riderId },
        {
          $inc: { 
            pendingBalance: booking.riderEarning,
            totalEarned: booking.riderEarning
          },
          $push: {
            transactions: {
              type: 'CREDIT',
              amount: booking.riderEarning,
              description: `Earnings from ride ${booking._id} (payout due in 7 days)`,
              referenceId: booking._id,
              referenceModel: 'Booking',
              status: 'PENDING',
              settlementDueDate: settlementDueDate
            }
          },
          updatedAt: new Date()
        },
        { session, upsert: true }
      );
      console.log('Rider wallet updated with pending balance');
    } else if (booking.paymentMethod === 'CASH') {
      await RiderWallet.findOneAndUpdate(
        { riderId },
        {
          $inc: { 
            cashCollected: booking.finalFare,
            totalEarned: booking.riderEarning
          },
          $push: {
            transactions: {
              type: 'CASH_COLLECTED',
              amount: booking.finalFare,
              description: `Cash collected from ride ${booking._id} (due in 3 days)`,
              referenceId: booking._id,
              referenceModel: 'Booking',
              status: 'PENDING_SETTLEMENT',
              settlementDueDate: settlementDueDate
            }
          },
          updatedAt: new Date()
        },
        { session, upsert: true }
      );
      console.log('Rider wallet updated with cash collection record');
    }

    // 9. Update rider activity
    await RiderActivity.findOneAndUpdate(
      { riderId },
      {
        availabilityStatus: 'AVAILABLE',
        isOnline: true,
        lastSeenAt: new Date()
      },
      { session, upsert: true }
    );

    // 10. Get payment details
    const Payment = mongoose.model('Payment');
    const payment = await Payment.findOne({ bookingId: booking._id }).session(session);
    
    if (payment) {
      // Update payment record based on payment method - using valid enum values
      if (booking.paymentMethod === 'CASH') {
        payment.paymentStatus = 'PENDING_SETTLEMENT'; // Now this is valid
        payment.settlementDueDate = settlementDueDate;
        payment.collectedBy = 'RIDER';
        payment.collectedById = riderId;
        payment.collectedByModel = 'Rider';
        payment.metadata = {
          ...payment.metadata,
          cashCollected: booking.finalFare,
          adminCommission: booking.adminCommissionAmount
        };
      } else if (booking.paymentMethod === 'RAZORPAY' || booking.paymentMethod === 'ONLINE') {
        payment.paymentStatus = 'SUCCESS';
        payment.metadata = {
          ...payment.metadata,
          payoutDueDate: settlementDueDate,
          adminCommission: booking.adminCommissionAmount,
          riderEarning: booking.riderEarning
        };
      }
      payment.updatedAt = new Date();
      await payment.save({ session });
      console.log('Payment record updated with status:', payment.paymentStatus);
    } else {
      console.log('No payment record found for booking:', booking._id);
    }

    // 11. Create notifications
    const userNotification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'RIDE_COMPLETED',
      title: 'Ride Completed! 🎉',
      message: `Your ride has been completed. Final fare: ₹${booking.finalFare}`,
      data: {
        bookingId: booking._id,
        finalFare: booking.finalFare,
        distance: booking.distanceKm,
        duration: Math.round(
          (booking.rideEndTime - booking.rideStartTime) / (1000 * 60)
        ),
        paymentMethod: booking.paymentMethod
      }
    });

    let riderNotificationMessage = '';
    if (booking.paymentMethod === 'CASH') {
      riderNotificationMessage = `You collected ₹${booking.finalFare} in cash. Please remit ₹${booking.adminCommissionAmount} to company within 3 days. Your earning: ₹${booking.riderEarning}`;
    } else {
      riderNotificationMessage = `You earned ₹${booking.riderEarning} from this ride. Amount will be credited to your account within 7 days.`;
    }

    const riderNotification = new Notification({
      riderId,
      bookingId: booking._id,
      type: 'RIDE_COMPLETED',
      title: 'Ride Completed! 🎉',
      message: riderNotificationMessage,
      data: {
        bookingId: booking._id,
        riderEarning: booking.riderEarning,
        totalFare: booking.finalFare,
        adminCommission: booking.adminCommissionAmount,
        paymentMethod: booking.paymentMethod,
        settlementDueDate: settlementDueDate
      }
    });

    await userNotification.save({ session });
    await riderNotification.save({ session });
    console.log('Notifications created');

    await session.commitTransaction();
    console.log('Transaction committed successfully');

    // 12. Emit socket events
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${booking.userId}`).emit('ride-completed', {
        bookingId: booking._id,
        finalFare: booking.finalFare,
        riderEarning: booking.riderEarning,
        paymentMethod: booking.paymentMethod
      });
    }

    // 13. Return success response with payment details
    res.json({
      success: true,
      message: 'Ride completed successfully',
      data: {
        booking,
        earnings: {
          finalFare: booking.finalFare,
          adminCommission: booking.adminCommissionAmount,
          riderEarning: booking.riderEarning,
          paymentMethod: booking.paymentMethod,
          settlementDueDate: settlementDueDate,
          payoutStatus: payoutStatus
        },
        payment: {
          method: booking.paymentMethod,
          message: booking.paymentMethod === 'CASH' 
            ? `Please remit ₹${booking.adminCommissionAmount} to company within 3 days`
            : `₹${booking.riderEarning} will be credited to your account within 7 days`
        }
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('========== ERROR IN COMPLETE RIDE ==========');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to complete ride',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Update rider rating (called when user rates rider)
export const updateRiderRating = async (riderId) => {
  try {
    // Calculate new average rating
    const ratings = await Rating.find({ riderId });

    if (ratings.length > 0) {
      const totalRating = ratings.reduce(
        (sum, rating) => sum + rating.rating,
        0,
      );
      const averageRating = totalRating / ratings.length;

      // Update rider's overall rating
      await Rider.findByIdAndUpdate(riderId, {
        overallRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
        totalRatings: ratings.length,
      });
    }
  } catch (error) {
    console.error("Update rider rating error:", error);
  }
};

// Start return ride (for round trips)
export const startReturnRide = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.params;
    const { otp } = req.body;
    const riderId = req.user._id;

    console.log(`Rider ${riderId} starting return ride ${bookingId}`);

    // 1. Find the round trip booking
    const booking = await Booking.findOne({
      _id: bookingId,
      riderId,
      bookingType: 'ROUND_TRIP',
      bookingStatus: 'TRIP_COMPLETED' // First leg completed
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Return ride not available or first leg not completed'
      });
    }

    // 2. Verify return OTP
    if (!otp || booking.returnRideOtp !== otp) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP for return ride'
      });
    }

    // 3. Update booking for return ride
    booking.returnRideStatus = 'TRIP_STARTED';
    booking.returnRideStartTime = new Date();
    booking.returnRideOtpVerifiedAt = new Date();
    booking.bookingStatus = 'RETURN_RIDE_STARTED';
    await booking.save({ session });

    // 4. Update rider status
    await Rider.findByIdAndUpdate(
      riderId,
      {
        availabilityStatus: 'ON_TRIP',
        currentBooking: booking._id
      },
      { session }
    );

    // 5. Create notification
    const notification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'RETURN_RIDE_STARTED',
      title: 'Return Ride Started! 🔄',
      message: 'Your return journey has begun. Safe travels!',
      data: {
        bookingId: booking._id,
        startTime: booking.returnRideStartTime
      }
    });
    await notification.save({ session });

    await session.commitTransaction();

    // 6. Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${booking.userId}`).emit('return-ride-started', {
        bookingId: booking._id,
        startTime: booking.returnRideStartTime
      });
    }

    res.json({
      success: true,
      message: 'Return ride started successfully',
      data: {
        booking,
        returnRideStartTime: booking.returnRideStartTime
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Start return ride error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start return ride',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};


// Complete return ride
export const completeReturnRide = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.params;
    const { returnDistance, additionalCharges = 0 } = req.body;
    const riderId = req.user._id;

    console.log(`Rider ${riderId} completing return ride ${bookingId}`);

    // 1. Find the round trip booking
    const booking = await Booking.findOne({
      _id: bookingId,
      riderId,
      bookingType: 'ROUND_TRIP',
      returnRideStatus: 'TRIP_STARTED'
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Return ride not found or not started'
      });
    }

    // 2. Get pricing for fare calculation
    const pricing = await Pricing.findOne({ 
      cabType: booking.vehicleType,
      isActive: true 
    }).session(session);

    if (!pricing) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Pricing configuration not found'
      });
    }

    // 3. Calculate return ride fare
    const baseFare = pricing.baseFare;
    const pricePerKm = pricing.pricePerKm;
    const adminCommissionPercent = pricing.adminCommissionPercent || 20;

    // Use provided distance or estimated
    const actualReturnDistance = returnDistance || booking.roundTripDetails?.returnDistance || booking.distanceKm;
    
    // Calculate return fare
    const returnFare = baseFare + (actualReturnDistance * pricePerKm) + additionalCharges;
    const returnCommission = (returnFare * adminCommissionPercent) / 100;
    const returnEarning = returnFare - returnCommission;

    // 4. Update total fare (add to existing fare)
    const totalFinalFare = (booking.finalFare || booking.estimatedFare) + returnFare;
    const totalCommission = (booking.adminCommissionAmount || 0) + returnCommission;
    const totalEarning = (booking.riderEarning || 0) + returnEarning;

    // 5. Update booking
    booking.returnRideStatus = 'TRIP_COMPLETED';
    booking.returnRideEndTime = new Date();
    booking.returnRideFinalFare = Math.round(returnFare);
    booking.finalFare = Math.round(totalFinalFare);
    booking.adminCommissionAmount = Math.round(totalCommission);
    booking.riderEarning = Math.round(totalEarning);
    booking.bookingStatus = 'TRIP_COMPLETED';
    
    if (booking.roundTripDetails) {
      booking.roundTripDetails.isReturnRideCompleted = true;
      booking.roundTripDetails.returnActualDistance = actualReturnDistance;
    }
    
    await booking.save({ session });

    // 6. Update rider stats
    await Rider.findByIdAndUpdate(
      riderId,
      {
        availabilityStatus: 'AVAILABLE',
        currentBooking: null,
        isLocked: false,
        lockedUntil: null,
        $inc: { completedRides: 1 }
      },
      { session }
    );

    // 7. Update cab availability
    await Cab.findOneAndUpdate(
      { riderId },
      { isAvailable: true },
      { session }
    );

    // 8. Create rider earning record for return leg
    const returnEarningRecord = new RiderEarning({
      bookingId: booking._id,
      riderId,
      totalFare: returnFare,
      adminCommission: returnCommission,
      riderEarning: returnEarning,
      payoutStatus: 'PENDING',
      completedAt: new Date(),
      tripLeg: 'RETURN'
    });
    await returnEarningRecord.save({ session });

    // 9. Update rider wallet with additional earnings
    await RiderWallet.findOneAndUpdate(
      { riderId },
      {
        $inc: { balance: returnEarning },
        $push: {
          transactions: {
            type: 'CREDIT',
            amount: returnEarning,
            description: `Return ride earnings ${booking._id}`,
            referenceId: booking._id,
            referenceModel: 'Booking'
          }
        },
        updatedAt: new Date()
      },
      { session, upsert: true }
    );

    // 10. Create notification for user
    const notification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'RETURN_RIDE_COMPLETED',
      title: 'Round Trip Completed! 🎉',
      message: `Your round trip is complete. Total fare: ₹${totalFinalFare}`,
      data: {
        bookingId: booking._id,
        totalFare: totalFinalFare,
        returnFare,
        mainFare: booking.finalFare - returnFare
      }
    });
    await notification.save({ session });

    await session.commitTransaction();

    // 11. Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${booking.userId}`).emit('return-ride-completed', {
        bookingId: booking._id,
        totalFare: totalFinalFare,
        returnFare
      });
    }

    res.json({
      success: true,
      message: 'Return ride completed successfully',
      data: {
        booking,
        earnings: {
          mainRideEarning: booking.riderEarning - returnEarning,
          returnRideEarning: returnEarning,
          totalEarning: booking.riderEarning,
          walletBalance: (await RiderWallet.findOne({ riderId }))?.balance || 0
        }
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Complete return ride error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete return ride',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Get rider earnings
export const getRiderEarnings = async (req, res) => {
  try {
    const riderId = req.user._id;
    const { startDate, endDate, page = 1, limit = 20 } = req.query;

    const query = { riderId };

    // Filter by date range
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const earnings = await RiderEarning.find(query)
      .populate("bookingId", "pickup drop finalFare rideStartTime rideEndTime userId")
      .populate({
        path: "bookingId",
        populate: {
          path: "userId",
          select: "name email phone photo"
        }
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Enrich earnings data with customer details
    const enrichedEarnings = earnings.map(earning => ({
      ...earning.toObject(),
      customerName: earning.bookingId?.userId?.name || "N/A",
      customerPhone: earning.bookingId?.userId?.phone || "N/A",
      customerPhoto: earning.bookingId?.userId?.photo || null,
      rideStartTime: earning.bookingId?.rideStartTime || null,
      rideEndTime: earning.bookingId?.rideEndTime || null,
    }));

    const total = await RiderEarning.countDocuments(query);

    // Calculate totals
    const totalEarnings = await RiderEarning.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$riderEarning" } } },
    ]);

    const totalCommission = await RiderEarning.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$adminCommission" } } },
    ]);

    // Get wallet balance
    const wallet = await RiderWallet.findOne({ riderId });

    // Calculate weekly earnings (last 7 days)
    const weeklyEarnings = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayStart = new Date(date.setHours(0, 0, 0, 0));
      const dayEnd = new Date(date.setHours(23, 59, 59, 999));

      const dayEarnings = await RiderEarning.aggregate([
        { $match: { riderId, createdAt: { $gte: dayStart, $lte: dayEnd } } },
        { $group: { _id: null, total: { $sum: "$riderEarning" } } },
      ]);

      weeklyEarnings.push(dayEarnings[0]?.total || 0);
    }

    // Calculate monthly earnings (last 4 months)
    const monthlyEarnings = [];
    for (let i = 3; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );

      const monthEarnings = await RiderEarning.aggregate([
        {
          $match: { riderId, createdAt: { $gte: monthStart, $lte: monthEnd } },
        },
        { $group: { _id: null, total: { $sum: "$riderEarning" } } },
      ]);

      monthlyEarnings.push(monthEarnings[0]?.total || 0);
    }

    res.status(200).json({
      success: true,
      data: {
        earnings: enrichedEarnings,
        summary: {
          totalEarnings: totalEarnings[0]?.total || 0,
          totalCommission: totalCommission[0]?.total || 0,
          walletBalance: wallet?.balance || 0,
          totalRides: total,
        },
        charts: {
          weeklyEarnings,
          monthlyEarnings,
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get rider earnings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get earnings",
    });
  }
};

// Get rider ratings
export const getRiderRatings = async (req, res) => {
  try {
    const riderId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const ratings = await Rating.find({ riderId })
      .populate("userId", "name")
      .populate("bookingId", "pickup drop rideEndTime")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Rating.countDocuments({ riderId });

    // Calculate average rating
    const avgRating = await Rating.aggregate([
      { $match: { riderId } },
      { $group: { _id: null, average: { $avg: "$rating" } } },
    ]);

    // Get rating distribution
    const ratingDistribution = await Rating.aggregate([
      { $match: { riderId } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        ratings,
        summary: {
          averageRating: avgRating[0]?.average || 0,
          totalRatings: total,
          ratingDistribution,
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get rider ratings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get ratings",
    });
  }
};

// Update cab details
export const updateCabDetails = async (req, res) => {
  try {
    const riderId = req.user._id;
    const { cabNumber, cabModel, cabType, seatingCapacity, acAvailable } =
      req.body;
    const files = req.files;

    // Find existing cab
    let cab = await Cab.findOne({ riderId });

    if (!cab) {
      return res.status(404).json({
        success: false,
        message: "Cab not found",
      });
    }

    // Update basic details
    if (cabNumber) cab.cabNumber = cabNumber;
    if (cabModel) cab.cabModel = cabModel;
    if (cabType) cab.cabType = cabType;
    if (seatingCapacity) cab.seatingCapacity = seatingCapacity;
    if (acAvailable !== undefined) cab.acAvailable = acAvailable;

    // Handle file uploads if any
    if (files) {
      const uploadPromises = [];

      if (files.rcFront && files.rcFront[0]) {
        const result = await uploadToCloudinary(files.rcFront[0].buffer, {
          folder: `riders/${riderId}/documents`,
        });
        cab.rcImage.front = result.secure_url;
      }

      if (files.rcBack && files.rcBack[0]) {
        const result = await uploadToCloudinary(files.rcBack[0].buffer, {
          folder: `riders/${riderId}/documents`,
        });
        cab.rcImage.back = result.secure_url;
      }

      // Similar for other documents...
    }

    cab.approvalStatus = "PENDING"; // Reset approval status when updating
    await cab.save();

    res.status(200).json({
      success: true,
      message: "Cab details updated. Waiting for admin approval.",
      data: cab,
    });
  } catch (error) {
    console.error("Update cab details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update cab details",
    });
  }
};

// Get nearby customers for riders
export const getNearbyCustomers = async (req, res) => {
  try {
    const lat = Number(req.query.lat) || 28.6139;
    const lng = Number(req.query.lng) || 77.2100;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ success: false, message: 'Invalid coordinates' });
    }

    const customers = await Booking.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [lng, lat],
          },
          distanceField: "distance",
          maxDistance: 5000,
          spherical: true,
          key: "pickup.location.coordinates",
        },
      },
      {
        $match: {
          createdAt: { $gte: yesterday },
          bookingStatus: {
            $in: ["TRIP_COMPLETED", "DRIVER_ASSIGNED", "TRIP_STARTED"],
          },
        },
      },
    ]);

    res.status(200).json({ success: true, data: customers });
  } catch (err) {
    console.error("getNearbyCustomers error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update trip status (for riders)
export const updateTripStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId, status, otp, actualDistance, additionalCharges } = req.body;
    const riderId = req.user._id;

    console.log("Update trip status:", { bookingId, status, riderId });

    // Find booking
    const booking = await Booking.findOne({
      _id: bookingId,
      riderId: riderId,
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Handle different status updates
    switch (status) {
      case "DRIVER_ARRIVED":
        if (booking.bookingStatus !== "DRIVER_ASSIGNED") {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Invalid status transition",
          });
        }
        booking.bookingStatus = "DRIVER_ARRIVED";
        booking.arrivedAt = new Date();
        break;

      case "TRIP_STARTED":
        if (
          !["DRIVER_ASSIGNED", "DRIVER_ARRIVED", "PAYMENT_DONE"].includes(booking.bookingStatus)
        ) {
          await session.abortTransaction();
          console.log(
            `Invalid status transition: current=${booking.bookingStatus}, expected=DRIVER_ASSIGNED or DRIVER_ARRIVED, or PAYMENT_DONE`,
          );
          return res.status(400).json({
            success: false,
            message: `Cannot start ride. Current status: ${booking.bookingStatus}. Required: DRIVER_ASSIGNED or DRIVER_ARRIVED, or PAYMENT_DONE`,
          });
        }

        // Verify OTP if provided
        // ✅ OTP verification – convert both to string for safe comparison
        if (otp) {
          const dbOtp = booking.otp.toString();
          const requestOtp = otp.toString();
          console.log(
            `🔐 OTP check: DB=${dbOtp} (${typeof booking.otp}), request=${requestOtp} (${typeof otp})`,
          );

          if (dbOtp !== requestOtp) {
            await session.abortTransaction();
            return res.status(400).json({
              success: false,
              message: "Invalid OTP. Please check with customer.",
            });
          }

          // ✅ OTP expiry check (5‑minute grace period)
          const now = new Date();
          const otpExpiry = new Date(booking.otpExpiresAt);
          const timeDiff = (otpExpiry - now) / (1000 * 60); // minutes
          if (timeDiff < -5) {
            await session.abortTransaction();
            return res.status(400).json({
              success: false,
              message:
                "OTP has expired. Please request a new OTP from customer.",
            });
          }
          booking.otpVerifiedAt = new Date();
        } else {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "OTP is required to start the ride.",
          });
        }

        booking.bookingStatus = "TRIP_STARTED";
        booking.rideStartTime = new Date();
        if (otp) booking.otpVerifiedAt = new Date();
        break;

      case "TRIP_COMPLETED":
        if (booking.bookingStatus !== "TRIP_STARTED") {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Invalid status transition",
          });
        }

        // Get pricing for final fare calculation
        const pricing = await Pricing.findOne({
          cabType: booking.vehicleType,
        }).session(session);
        if (!pricing) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Pricing not found",
          });
        }

        // ✅ Validate actualDistance
        if (!actualDistance || actualDistance <= 0) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Actual distance is required and must be greater than 0",
          });
        }

        // ✅ Calculate final fare based on actual distance + additional charges
        const finalFare =
          pricing.baseFare +
          actualDistance * pricing.pricePerKm +
          (parseFloat(additionalCharges) || 0);
        const adminCommission =
          finalFare * (pricing.adminCommissionPercent / 100);
        const riderEarning = finalFare - adminCommission;

        booking.bookingStatus = "TRIP_COMPLETED";
        booking.rideEndTime = new Date();
        booking.finalFare = finalFare;
        booking.adminCommissionAmount = adminCommission;
        booking.riderEarning = riderEarning;

        // Update rider status
        const rider = await Rider.findById(riderId).session(session);
        if (rider) {
          rider.completedRides += 1;
          rider.isLocked = false;
          rider.lockedUntil = null;
          rider.currentBooking = null;
          rider.availabilityStatus = "AVAILABLE";
          await rider.save({ session });
        }

        // ✅ Mark cab as available again
  const cab = await Cab.findOne({ riderId }).session(session);
  if (cab) {
    cab.isAvailable = true;
    await cab.save({ session });
  }

        // Create rider earning record
        const riderEarningRecord = new RiderEarning({
          bookingId: booking._id,
          riderId: riderId,
          totalFare: finalFare,
          adminCommission: adminCommission,
          riderEarning: riderEarning,
          payoutStatus: "PENDING",
        });
        await riderEarningRecord.save({ session });

        // Update rider wallet
        await RiderWallet.findOneAndUpdate(
          { riderId: riderId },
          {
            $inc: { balance: riderEarning },
            updatedAt: new Date(),
          },
          { session, upsert: true },
        );
        break;

      default:
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Invalid status",
        });
    }

    await booking.save({ session });

   

    // Create notification
    let notificationType;
    let notificationMessage = "";

    switch (status) {
      case "DRIVER_ARRIVED":
        notificationType = "DRIVER_ARRIVED";
        notificationMessage = "Your rider has arrived at the pickup location";
        break;
      case "TRIP_STARTED":
        notificationType = "RIDE_STARTED";
        notificationMessage = "Your trip has started";
        break;
      case "TRIP_COMPLETED":
        notificationType = "RIDE_COMPLETED";
        notificationMessage = `Your trip has been completed. Final fare: ₹${booking.finalFare || booking.estimatedFare}`;
        break;
      default:
        notificationType = `BOOKING_${status}`;
        notificationMessage = `Booking status updated to ${status}`;
    }

    const notification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: notificationType,
      title: "Trip Status Updated",
      message: notificationMessage,
    });
    await notification.save({ session });

    await session.commitTransaction();

    // Send WebSocket notification
    const io = req.app.get("io");
    if (io) {
      io.to(`user-${booking.userId}`).emit("trip-status-update", {
        bookingId: booking._id,
        status: booking.bookingStatus,
        updatedAt: booking.updatedAt,
      });
    }

    res.status(200).json({
      success: true,
      message: `Trip status updated to ${status}`,
      data: booking,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Update trip status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update trip status",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    session.endSession();
  }
};

// ========== GET RIDER BY ID (for customer booking page) ==========
export const getRiderById = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch rider – select only fields needed for display
    const rider = await Rider.findById(id).select(
      "name phone photo overallRating totalRatings currentLocation",
    );

    if (!rider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }

    // Fetch associated cab
    const cab = await Cab.findOne({ riderId: rider._id }).select(
      "cabModel cabNumber cabType",
    );

    // Return combined data
    res.status(200).json({
      success: true,
      data: {
        ...rider.toObject(),
        cab: cab || null,
      },
    });
  } catch (error) {
    console.error("Get rider by ID error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch rider details" });
  }
};

// Get nearby riders for customers
export const getNearbyRidersForCustomers = async (req, res) => {
  try {
    const { lat, lng, vehicleType, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Location coordinates are required",
      });
    }

    // Simple query without complex aggregation
    const riders = await Rider.find({
      isOnline: true,
      availabilityStatus: { $in: ["AVAILABLE"] },
      approvalStatus: "APPROVED",
      isLocked: false,
    }).limit(10);

    // Get cabs for these riders
    const riderIds = riders.map((r) => r._id);
    const cabs = await Cab.find({
      riderId: { $in: riderIds },
      isApproved: true,
      cabType: vehicleType,
    });

    // Combine rider and cab data
    const nearbyRiders = riders
      .filter((rider) => {
        return cabs.some(
          (cab) => cab.riderId.toString() === rider._id.toString(),
        );
      })
      .map((rider) => {
        const cab = cabs.find(
          (c) => c.riderId.toString() === rider._id.toString(),
        );
        return {
          _id: rider._id,
          name: rider.name,
          phone: rider.phone,
          overallRating: rider.overallRating || 4.5,
          totalRatings: rider.totalRatings || 0,
          isOnline: rider.isOnline,
          availabilityStatus: rider.availabilityStatus,
          distance: 2.5,
          cab: {
            cabModel: cab.cabModel,
            cabNumber: cab.cabNumber,
            cabType: cab.cabType,
            seatingCapacity: cab.seatingCapacity,
            acAvailable: cab.acAvailable,
          },
        };
      });

    res.status(200).json({
      success: true,
      data: nearbyRiders,
      message: `Found ${nearbyRiders.length} available riders`,
    });
  } catch (error) {
    console.error("Get nearby riders for customers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get nearby riders",
    });
  }
};

// Get rider notifications
export const getRiderNotifications = async (req, res) => {
  try {
    const riderId = req.user._id;
    const { page = 1, limit = 20, unreadOnly } = req.query;

    const query = { riderId };
    if (unreadOnly === "true") {
      query.isRead = false;
    }

    const notifications = await Notification.find(query)
      .populate("bookingId", "bookingStatus pickup drop")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({
      riderId,
      isRead: false,
    });

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get rider notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get notifications",
    });
  }
};


// Add this function to riderController.js

// @desc    Get active booking for rider
// @route   GET /api/riders/active-booking
// @access  Private (Rider)
export const getActiveBooking = async (req, res) => {
  try {
    const riderId = req.user._id;
    
    const activeBooking = await Booking.findOne({
      riderId,
      bookingStatus: { 
        $in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED'] 
      }
    }).populate('userId', 'name phone email');

    res.json({
      success: true,
      data: activeBooking || null
    });
  } catch (error) {
    console.error('Get active booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active booking'
    });
  }
};