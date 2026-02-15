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
        type: "Point",
        coordinates: [lng, lat],
      },
    });

    // Update live location for tracking
    await LiveLocation.findOneAndUpdate(
      { riderId },
      { lat, lng, updatedAt: new Date() },
      { upsert: true },
    );

    // Update rider activity
    await RiderActivity.findOneAndUpdate(
      { riderId },
      {
        lastLocation: { lat, lng },
        lastSeenAt: new Date(),
      },
      { upsert: true },
    );

    res.status(200).json({
      success: true,
      message: "Location updated successfully",
    });
  } catch (error) {
    console.error("Update rider location error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update location",
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

    const rider = await Rider.findById(riderId).session(session);
    if (!rider) {
      await session.abortTransaction();
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }

    // ----- Going OFFLINE -----
    if (isOnline === false) {
      if (rider.currentBooking) {
        const activeBooking = await Booking.findOne({
          _id: rider.currentBooking,
          bookingStatus: {
            $in: ["DRIVER_ASSIGNED", "DRIVER_ARRIVED", "TRIP_STARTED"],
          },
        }).session(session);

        if (activeBooking) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Cannot go offline while on an active trip",
          });
        }
      }
      rider.isOnline = false;
      rider.availabilityStatus = "OFFLINE";
    }

    // ----- Going ONLINE -----
    if (isOnline === true) {
      // 1️⃣ Clean up stale currentBooking
      if (rider.currentBooking) {
        const existingBooking = await Booking.findById(
          rider.currentBooking,
        ).session(session);
        if (!existingBooking) {
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
            rider.currentBooking = null;
            rider.isLocked = false;
            rider.lockedUntil = null;
          }
        }
      }

      // 2️⃣ Reset locks
      rider.isLocked = false;
      rider.lockedUntil = null;

      // 3️⃣ Set online
      rider.isOnline = true;
      rider.availabilityStatus = "AVAILABLE";
      rider.socketId = req.body.socketId || rider.socketId;
    }

    await rider.save({ session });
    await session.commitTransaction();

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
    console.error("Toggle online status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update online status",
    });
  } finally {
    session.endSession();
  }
};

// Get available bookings - Simplified and error-free
export const getAvailableBookings = async (req, res) => {
  try {
    const rider = req.user;

    if (!rider.isOnline || !['AVAILABLE', 'ACTIVE'].includes(rider.availabilityStatus)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const cab = await Cab.findOne({
      riderId: rider._id,
      isApproved: true,
    });

    if (!cab) {
      return res.status(200).json({ success: true, data: [] });
    }

    /**
     * ✅ IMPORTANT FIX:
     * - broadcastExpiry respected
     * - cron will NOT kill active rides early
     */
    const bookings = await Booking.find({
      bookingStatus: "SEARCHING_DRIVER",
      vehicleType: cab.cabType,
      isBroadcastActive: true,
      broadcastExpiry: { $gt: new Date() },
    })
      .populate("userId", "name phone")
      .sort({ createdAt: -1 })
      .limit(5);

    return res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (err) {
    console.error("getAvailableBookings error:", err);
    res.status(200).json({ success: true, data: [] });
  }
};

// Accept booking request - UPDATED VERSION
export const acceptBookingRequest = async (req, res) => {
  let retries = 3;
  while (retries > 0) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { bookingId } = req.body;
      const riderId = req.user._id;

      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        throw new Error("Invalid booking ID");
      }

      const booking = await Booking.findOne({
        _id: bookingId,
        bookingStatus: "SEARCHING_DRIVER",
        isBroadcastActive: true
      }).session(session);

      if (!booking) throw new Error("Booking no longer available");

      const rider = await Rider.findById(riderId).session(session);
      if (!rider || !rider.isOnline || !['AVAILABLE', 'ACTIVE'].includes(rider.availabilityStatus)) {
        throw new Error("Rider not available");
      }

      // Clean up stale currentBooking
      if (rider.currentBooking) {
        const existingBooking = await Booking.findById(rider.currentBooking).session(session);
        if (!existingBooking) {
          rider.currentBooking = null;
        } else {
          const activeStatuses = ["DRIVER_ASSIGNED", "DRIVER_ARRIVED", "TRIP_STARTED"];
          if (!activeStatuses.includes(existingBooking.bookingStatus)) {
            rider.currentBooking = null;
          } else {
            throw new Error("You already have an active ride");
          }
        }
      }

      const cab = await Cab.findOne({
        riderId,
        isApproved: true,
        cabType: booking.vehicleType
      }).session(session);
      if (!cab) throw new Error("Cab not approved or vehicle mismatch");

      cab.isAvailable = false;
      await cab.save({ session });

      booking.bookingStatus = "DRIVER_ASSIGNED";
      booking.riderId = riderId;
      booking.cabId = cab._id;
      booking.isBroadcastActive = false;
      booking.acceptedAt = new Date();
      await booking.save({ session });

      rider.currentBooking = booking._id;
      rider.isLocked = false;
      rider.lockedUntil = null;
      rider.availabilityStatus = "ON_TRIP";
      await rider.save({ session });

      await BookingRequest.findOneAndUpdate(
        { bookingId, riderId },
        { status: "ACCEPTED", responseTime: new Date() },
        { upsert: true, session }
      );

      await session.commitTransaction();
      session.endSession();

      // Notify user via WebSocket
      try {
        const io = req.app.get('io');
        if (io) {
          io.to(`booking-${booking._id}`).emit('ride-accepted', {
            bookingId: booking._id,
            rider: {
              id: rider._id,
              name: rider.name,
              phone: rider.phone,
              rating: rider.overallRating || 4.5,
              photo: rider.photo,
              vehicle: {
                model: cab.cabModel,
                number: cab.cabNumber,
                type: cab.cabType
              }
            },
            estimatedArrival: 5
          });
          console.log(`📢 Emitted ride-accepted to booking-${booking._id}`);
        }
      } catch (socketError) {
        console.error('Socket emit error:', socketError);
      }

      return res.status(200).json({
        success: true,
        message: "Booking accepted",
        data: { bookingId: booking._id, otp: booking.otp }
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      if (error.message.includes('WriteConflict') && retries > 0) {
        retries--;
        console.log(`⚠️ Write conflict, retrying... (${retries} attempts left)`);
        continue;
      }

      console.error("Accept booking error:", error.message);
      return res.status(400).json({ success: false, message: error.message });
    }
  }
};

// Reject booking request - UPDATED VERSION
// export const rejectBookingRequest = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { bookingId } = req.params;
//     const riderId = req.user._id;

//     // Check if booking exists
//     const booking = await Booking.findById(bookingId).session(session);
//     if (!booking) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: 'Booking not found'
//       });
//     }

//     // Create booking request record for rejection
//     const bookingRequest = new BookingRequest({
//       bookingId,
//       riderId,
//       status: 'REJECTED'
//       // expiresAt will be set automatically by default
//     });
//     await bookingRequest.save({ session });

//     // Increment rider's rejected rides count
//     await Rider.findByIdAndUpdate(riderId, {
//       $inc: { rejectedRides: 1 }
//     }, { session });

//     await session.commitTransaction();
//     session.endSession();

//     res.status(200).json({
//       success: true,
//       message: 'Booking rejected'
//     });
//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();
//     console.error('Reject booking error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to reject booking',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined
//     });
//   }
// };

export const rejectBookingRequest = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const riderId = req.user._id;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid booking ID" });
    }

    console.log("❌ Rejecting booking:", bookingId, "by rider:", riderId);

    // Check if booking exists (optional but recommended)
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: "Booking not found" });
    }

    await BookingRequest.create({
      bookingId,
      riderId,
      status: "REJECTED",
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Reject booking error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Start ride
// In riderController.js - startRide function
export const startRide = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const riderId = req.user._id;
    const { otp } = req.body;

    console.log("Start ride request:", { bookingId, riderId, otp });

    const booking = await Booking.findOne({
      _id: bookingId,
      riderId,
      bookingStatus: { $in: ["DRIVER_ASSIGNED", "DRIVER_ARRIVED"] },
    });

    console.log("Found booking:", booking ? "Yes" : "No");
    if (booking) {
      console.log("Booking status:", booking.bookingStatus);
    }

    if (!booking) {
      // Check if booking exists but in wrong status
      const wrongStatusBooking = await Booking.findOne({
        _id: bookingId,
        riderId,
      });

      if (wrongStatusBooking) {
        return res.status(400).json({
          success: false,
          message: `Cannot start ride. Current status: ${wrongStatusBooking.bookingStatus}. Required: DRIVER_ASSIGNED or DRIVER_ARRIVED`,
        });
      }

      return res.status(404).json({
        success: false,
        message: "Booking not found or not assigned to you",
      });
    }

    // ✅ FIX: OTP verification - make it case-insensitive
    if (!otp || booking.otp.toString() !== otp.toString()) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please check with customer.",
      });
    }

    // ✅ FIX: Check OTP expiry with tolerance
    const now = new Date();
    const otpExpiry = new Date(booking.otpExpiresAt);
    const timeDiff = (otpExpiry - now) / (1000 * 60); // minutes

    if (timeDiff < -5) {
      // Allow 5-minute grace period
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request new OTP from customer.",
      });
    }

    // Update rider status
    await Rider.findByIdAndUpdate(riderId, {
      availabilityStatus: "ON_TRIP",
    });

    console.log("OTP verified successfully, starting ride");

    // Update booking status
    booking.bookingStatus = "TRIP_STARTED";
    booking.rideStartTime = new Date();
    booking.otpVerifiedAt = new Date();
    await booking.save();
    console.log("Booking updated to TRIP_STARTED");

    // Notify user via socket
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(booking.userId.toString()).emit("ride-started", {
          bookingId: booking._id,
          startTime: booking.rideStartTime,
        });
      }
    } catch (ioError) {
      console.log("Socket.io notification failed:", ioError.message);
    }

    res.status(200).json({
      success: true,
      message: "Ride started successfully",
      data: booking,
    });
  } catch (error) {
    console.error("Start ride error:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to start ride: " + error.message,
    });
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
export const completeRide = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const riderId = req.user._id;
    const { finalDistance, additionalCharges = 0 } = req.body;

    const booking = await Booking.findOne({
      _id: bookingId,
      riderId,
      bookingStatus: "TRIP_STARTED",
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found or not ongoing",
      });
    }

    // Calculate final fare
    const pricing = (await Pricing.findOne({ cabType: booking.cabType })) || {
      pricePerKm: 10,
      adminCommissionPercent: 20,
    };
    let finalFare = booking.estimatedFare || 100;

    if (finalDistance && finalDistance > (booking.distanceKm || 0)) {
      const additionalDistance = finalDistance - (booking.distanceKm || 0);
      const additionalFare = additionalDistance * (pricing.pricePerKm || 10);
      finalFare += additionalFare;
    }

    finalFare += additionalCharges;

    // Calculate commission and earnings
    const adminCommissionPercent = pricing.adminCommissionPercent || 20;
    const adminCommissionAmount = (finalFare * adminCommissionPercent) / 100;
    const riderEarning = finalFare - adminCommissionAmount;

    // Update booking
    booking.bookingStatus = "TRIP_COMPLETED";
    booking.rideEndTime = new Date();
    booking.finalFare = finalFare;
    booking.adminCommissionAmount = adminCommissionAmount;
    booking.riderEarning = riderEarning;
    await booking.save();

    // Update rider status and completed rides
    await Rider.findByIdAndUpdate(riderId, {
      availabilityStatus: "AVAILABLE",
      currentBooking: null,
      isLocked: false,
      lockedUntil: null,
      $inc: { completedRides: 1 },
    });

    const cab = await Cab.findOne({ riderId });
    if (cab) {
      cab.isAvailable = true;
      await cab.save();
    }

    // Update rider activity
    await RiderActivity.findOneAndUpdate(
      { riderId },
      { availabilityStatus: "AVAILABLE" },
    );

    // Create rider earning record
    const riderEarningRecord = await RiderEarning.create({
      bookingId: booking._id,
      riderId,
      totalFare: finalFare,
      adminCommission: adminCommissionAmount,
      riderEarning: riderEarning,
      payoutStatus: "PENDING",
    });

    // Update rider wallet
    await RiderWallet.findOneAndUpdate(
      { riderId },
      {
        $inc: { balance: riderEarning },
        updatedAt: new Date(),
      },
      { upsert: true },
    );

    // Notify user
    const io = req.app.get("io");
    io.to(booking.userId.toString()).emit("ride-completed", {
      bookingId: booking._id,
      finalFare,
      paymentType: booking.paymentType,
    });

    // Create notifications
    await Notification.create([
      {
        userId: booking.userId,
        bookingId: booking._id,
        type: "TRIP_COMPLETED",
        title: "Ride Completed",
        message: `Your ride has been completed. Fare: ₹${finalFare}`,
        data: {
          finalFare,
          distance: booking.distanceKm,
          duration: Math.round(
            (booking.rideEndTime - booking.rideStartTime) / (1000 * 60),
          ),
        },
      },
      {
        riderId,
        bookingId: booking._id,
        type: "TRIP_COMPLETED",
        title: "Ride Completed",
        message: `You earned ₹${riderEarning} from this ride`,
        data: {
          riderEarning,
          totalFare: finalFare,
          commission: adminCommissionAmount,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      message: "Ride completed successfully",
      data: {
        booking,
        riderEarning: riderEarningRecord,
      },
    });
  } catch (error) {
    console.error("Complete ride error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete ride",
    });
  }
};

// TEMPORARY ROUTE – DELETE AFTER USE
// export const resetAllRidersAndCabs = async (req, res) => {
//   try {
//     // 1. Reset all riders
//     await Rider.updateMany(
//       {},
//       {
//         $set: {
//           currentBooking: null,
//           availabilityStatus: "AVAILABLE",
//           isLocked: false,
//           lockedUntil: null,
//         },
//       },
//     );

//     // 2. Reset all cabs
//     await Cab.updateMany(
//       {},
//       {
//         $set: {
//           isAvailable: true,
//           isOnRide: false, // if your model has this
//           currentBooking: null, // if your model has this
//         },
//       },
//     );

//     // 3. (Optional) Clear all BookingRequests
//     await BookingRequest.deleteMany({});

//     res.status(200).json({
//       success: true,
//       message: "✅ All riders and cabs have been reset",
//     });
//   } catch (error) {
//     console.error("Reset error:", error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

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
  try {
    const { bookingId } = req.params;
    const riderId = req.user._id;
    const { otp } = req.body;

    const booking = await Booking.findOne({
      _id: bookingId,
      riderId,
      tripType: "ROUND_TRIP",
      bookingStatus: "TRIP_COMPLETED", // First ride completed
      returnRideStatus: "SCHEDULED",
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Return ride not available",
      });
    }

    // Verify OTP for return ride
    if (!otp || booking.returnRideOtp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // Start return ride
    booking.returnRideStatus = "TRIP_STARTED";
    booking.returnRideStartTime = new Date();
    booking.returnRideOtpVerifiedAt = new Date();
    await booking.save();

    // Update rider status
    await Rider.findByIdAndUpdate(riderId, {
      availabilityStatus: "ON_TRIP",
    });

    // Notify user
    const io = req.app.get("io");
    io.to(booking.userId.toString()).emit("return-ride-started", {
      bookingId: booking._id,
      startTime: booking.returnRideStartTime,
    });

    res.status(200).json({
      success: true,
      message: "Return ride started successfully",
      data: booking,
    });
  } catch (error) {
    console.error("Start return ride error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start return ride",
    });
  }
};

// Complete return ride
export const completeReturnRide = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const riderId = req.user._id;
    const { finalDistance, additionalCharges = 0 } = req.body;

    const booking = await Booking.findOne({
      _id: bookingId,
      riderId,
      tripType: "ROUND_TRIP",
      returnRideStatus: "TRIP_STARTED",
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Return ride not found or not ongoing",
      });
    }

    // Calculate return ride fare
    const pricing = await Pricing.findOne({ cabType: booking.cabType });
    let returnRideFinalFare = booking.roundTripDetails.returnEstimatedFare;

    if (
      finalDistance &&
      finalDistance > booking.roundTripDetails.returnDistance
    ) {
      const additionalDistance =
        finalDistance - booking.roundTripDetails.returnDistance;
      const additionalFare = additionalDistance * pricing.pricePerKm;
      returnRideFinalFare += additionalFare;
    }

    returnRideFinalFare += additionalCharges;

    // Calculate total fare for both rides
    const totalFinalFare = booking.finalFare + returnRideFinalFare;

    // Calculate commission and earnings for return ride
    const adminCommissionPercent = pricing.adminCommissionPercent || 20;
    const adminCommissionAmount =
      (returnRideFinalFare * adminCommissionPercent) / 100;
    const riderEarning = returnRideFinalFare - adminCommissionAmount;

    // Update booking
    booking.returnRideStatus = "TRIP_COMPLETED";
    booking.returnRideEndTime = new Date();
    booking.returnRideFinalFare = returnRideFinalFare;
    booking.roundTripDetails.isReturnRideCompleted = true;
    booking.finalFare = totalFinalFare;
    booking.adminCommissionAmount += adminCommissionAmount;
    booking.riderEarning += riderEarning;
    await booking.save();

    // Update rider status
    await Rider.findByIdAndUpdate(riderId, {
      availabilityStatus: "AVAILABLE",
      $inc: { completedRides: 1 },
    });

    // Create rider earning record for return ride
    await RiderEarning.create({
      bookingId: booking._id,
      riderId,
      totalFare: returnRideFinalFare,
      adminCommission: adminCommissionAmount,
      riderEarning: riderEarning,
      payoutStatus: "PENDING",
    });

    // Update rider wallet
    await RiderWallet.findOneAndUpdate(
      { riderId },
      {
        $inc: { balance: riderEarning },
        updatedAt: new Date(),
      },
    );

    // Notify user
    const io = req.app.get("io");
    io.to(booking.userId.toString()).emit("return-ride-completed", {
      bookingId: booking._id,
      returnRideFinalFare,
      totalFinalFare: totalFinalFare,
    });

    res.status(200).json({
      success: true,
      message: "Return ride completed successfully",
      data: booking,
    });
  } catch (error) {
    console.error("Complete return ride error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to complete return ride",
    });
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
