import BookingRequest from "../models/BookingRequest.js";
import Booking from '../models/Booking.js';
import Rider from '../models/Rider.js';
import Cab from '../models/Cab.js';
import Pricing from '../models/Pricing.js';
import { calculateDistance } from './helper.js';
import mongoose from 'mongoose';

/**
 * Find nearby available riders for a booking
 * @param {Object} pickupLocation - {lng, lat}
 * @param {string} vehicleType - Vehicle type required
 * @param {number} radiusKm - Search radius in km
 * @returns {Array} Array of available riders
 */
export const findNearbyRiders = async (pickupLocation, vehicleType, radiusKm = 5) => {
  try {
    // Convert radius to meters for MongoDB
    const radiusMeters = radiusKm * 1000;

    // Find riders within radius
    const nearbyRiders = await Rider.find({
      approvalStatus: 'APPROVED',
      isOnline: true,
      isLocked: false,
      availabilityStatus: 'AVAILABLE',
      currentLocation: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [pickupLocation.lng, pickupLocation.lat]
          },
          $maxDistance: radiusMeters
        }
      }
    });

    // Filter riders with matching vehicle type
    const availableRiders = [];
    
    for (const rider of nearbyRiders) {
      const cab = await Cab.findOne({
        riderId: rider._id,
        cabType: vehicleType,
        isApproved: true
      });

      if (cab) {
        availableRiders.push({
          rider,
          cab,
          distance: calculateDistance(
            pickupLocation.lat, pickupLocation.lng,
            rider.currentLocation.coordinates[1], rider.currentLocation.coordinates[0]
          )
        });
      }
    }

    // Sort by distance (closest first)
    availableRiders.sort((a, b) => a.distance - b.distance);

    return availableRiders;
  } catch (error) {
    console.error('Error finding nearby riders:', error);
    return [];
  }
};

/**
 * Calculate fare for a trip
 * @param {number} distance - Distance in km
 * @param {string} vehicleType - Vehicle type
 * @returns {Object} Fare details
 */
export const calculateFareDetails = async (distance, vehicleType) => {
  try {
    const pricing = await Pricing.findOne({ cabType: vehicleType });
    
    if (!pricing) {
      throw new Error(`Pricing not found for vehicle type: ${vehicleType}`);
    }

    const baseFare = pricing.baseFare || 50;
    const pricePerKm = pricing.pricePerKm || 10;
    const commissionPercent = pricing.adminCommissionPercent || 20;

    const totalFare = Math.round(baseFare + (distance * pricePerKm));
    const adminCommission = Math.round(totalFare * (commissionPercent / 100));
    const riderEarning = totalFare - adminCommission;

    return {
      totalFare,
      baseFare,
      pricePerKm,
      commissionPercent,
      adminCommission,
      riderEarning,
      distance
    };
  } catch (error) {
    console.error('Error calculating fare:', error);
    throw error;
  }
};

/**
 * Lock rider for a booking (atomic operation)
 * @param {string} riderId - Rider ID
 * @param {string} bookingId - Booking ID
 * @returns {boolean} Success
 */
export const lockRider = async (riderId, bookingId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Try to lock the rider (prevent race conditions)
    const result = await Rider.findOneAndUpdate(
      {
        _id: riderId,
        isLocked: false,
        availabilityStatus: 'AVAILABLE'
      },
      {
        isLocked: true,
        lockedUntil: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        currentBooking: bookingId,
        availabilityStatus: 'ON_TRIP'
      },
      { session, new: true }
    );

    if (!result) {
      await session.abortTransaction();
      return false;
    }

    await session.commitTransaction();
    return true;
  } catch (error) {
    await session.abortTransaction();
    console.error('Error locking rider:', error);
    return false;
  } finally {
    session.endSession();
  }
};

/**
 * Unlock rider after trip completion
 * @param {string} riderId - Rider ID
 * @returns {boolean} Success
 */
export const unlockRider = async (riderId) => {
  try {
    await Rider.findByIdAndUpdate(riderId, {
      isLocked: false,
      lockedUntil: null,
      currentBooking: null,
      availabilityStatus: 'AVAILABLE'
    });
    
    return true;
  } catch (error) {
    console.error('Error unlocking rider:', error);
    return false;
  }
};

/**
 * Check if booking broadcast has expired
 * @param {string} bookingId - Booking ID
 * @returns {boolean} Is expired
 */
export const isBroadcastExpired = async (bookingId) => {
  try {
    const booking = await Booking.findById(bookingId);
    
    if (!booking) return true;
    
    if (!booking.broadcastExpiry) return true;
    
    return new Date() > booking.broadcastExpiry;
  } catch (error) {
    console.error('Error checking broadcast expiry:', error);
    return true;
  }
};

/**
 * Cancel expired broadcasts
 * @returns {number} Number of cancelled bookings
 */
export const cancelExpiredBroadcasts = async () => {
  try {
    const expiredBookings = await Booking.find({
      bookingStatus: 'SEARCHING_DRIVER',
      isBroadcastActive: true,
      broadcastExpiry: { $lt: new Date() }
    });

    for (const booking of expiredBookings) {
      const pendingRequests = await BookingRequest.countDocuments({
        bookingId: booking._id,
        status: 'PENDING'
      });

      if (pendingRequests > 0) continue;

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // 1️⃣ Update booking
        booking.bookingStatus = 'NO_DRIVER_FOUND';
        booking.isBroadcastActive = false;
        booking.cancelledBy = 'SYSTEM';
        booking.cancellationReason = 'No rider accepted in time';
        await booking.save({ session });

        // 2️⃣ Unlock riders who were tentatively linked
        await Rider.updateMany(
          { currentBooking: booking._id },
          {
            $set: {
              availabilityStatus: 'AVAILABLE',
              currentBooking: null,
              isLocked: false,
              lockedUntil: null
            }
          },
          { session }
        );

        // 3️⃣ Expire booking requests
        await BookingRequest.updateMany(
          { bookingId: booking._id, status: 'PENDING' },
          { status: 'EXPIRED' },
          { session }
        );

        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        console.error('Cancel expired booking error:', err);
      } finally {
        session.endSession();
      }
    }
  } catch (error) {
    console.error('Error cancelling expired broadcasts:', error);
  }
};




/**
 * Validate OTP for trip start
 * @param {string} bookingId - Booking ID
 * @param {string} otp - OTP entered
 * @returns {Object} Validation result
 */
export const validateTripOTP = async (bookingId, otp) => {
  try {
    const booking = await Booking.findById(bookingId);
    
    if (!booking) {
      return { valid: false, message: 'Booking not found' };
    }
    
    if (booking.otp !== otp) {
      return { valid: false, message: 'Invalid OTP' };
    }
    
    if (new Date() > booking.otpExpiresAt) {
      return { valid: false, message: 'OTP has expired' };
    }
    
    if (booking.bookingStatus !== 'DRIVER_ASSIGNED' && booking.bookingStatus !== 'DRIVER_ARRIVED') {
      return { valid: false, message: 'Booking not in correct state for OTP verification' };
    }
    
    return { valid: true, booking };
  } catch (error) {
    console.error('Error validating OTP:', error);
    return { valid: false, message: 'Error validating OTP' };
  }
};