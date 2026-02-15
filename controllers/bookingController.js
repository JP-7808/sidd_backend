import Booking from '../models/Booking.js';
import Rider from '../models/Rider.js';
import Cab from '../models/Cab.js';
import BookingRequest from '../models/BookingRequest.js';
import Notification from '../models/Notification.js';
import Pricing from '../models/Pricing.js';
import mongoose from 'mongoose';
import { calculateDistance, generateOTP } from '../utils/helper.js';

// 1. Create Booking


export const createBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  // ---------- DECLARE OUTSIDE try ----------
  let booking;
  let eligibleRiders = [];
  let bookingType = req.body.bookingType; // ← MOVE HERE

  try {
    const { pickup, drop, vehicleType, paymentMethod, scheduledAt } = req.body;
    const userId = req.user._id;

    // ---------- VALIDATION ----------
    if (!['IMMEDIATE', 'SCHEDULED'].includes(bookingType)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid booking type' });
    }

    if (bookingType === 'SCHEDULED') {
      if (!scheduledAt) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Scheduled time is required' });
      }
      const scheduledTime = new Date(scheduledAt);
      const now = new Date();
      if (scheduledTime < new Date(now.getTime() + 30 * 60000)) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Scheduled time must be at least 30 minutes from now' });
      }
      if (scheduledTime > new Date(now.getTime() + 7 * 24 * 60 * 60000)) {
        await session.abortTransaction();
        return res.status(400).json({ success: false, message: 'Scheduled time cannot be more than 7 days in the future' });
      }
    }

    // ---------- FARE CALCULATION ----------
    const distance = calculateDistance(pickup.lat, pickup.lng, drop.lat, drop.lng);
    const pricing = await Pricing.findOne({ cabType: vehicleType }).session(session);
    if (!pricing) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Pricing not found' });
    }
    const estimatedFare = pricing.baseFare + (distance * pricing.pricePerKm);
    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // ---------- BOOKING STATE ----------
    let bookingStatus = 'SEARCHING_DRIVER';
    let isBroadcastActive = true;
    let broadcastExpiry = new Date(Date.now() + 2 * 60 * 1000);
    let broadcastStartTime = new Date();

    if (bookingType === 'SCHEDULED') {
      bookingStatus = 'SCHEDULED';
      isBroadcastActive = false;
      broadcastStartTime = new Date(scheduledAt);
      broadcastExpiry = new Date(new Date(scheduledAt).getTime() + 30 * 1000);
    }

    // ---------- CREATE BOOKING ----------
    booking = new Booking({
      userId,
      pickup: {
        addressText: pickup.addressText,
        contactName: pickup.contactName,
        contactPhone: pickup.contactPhone,
        location: { type: 'Point', coordinates: [pickup.lng, pickup.lat] },
        lat: pickup.lat,
        lng: pickup.lng,
        placeId: pickup.placeId
      },
      drop: {
        addressText: drop.addressText,
        location: { type: 'Point', coordinates: [drop.lng, drop.lat] },
        lat: drop.lat,
        lng: drop.lng,
        placeId: drop.placeId
      },
      vehicleType,
      paymentMethod,
      distanceKm: distance,
      estimatedFare,
      bookingType,
      scheduledAt: bookingType === 'SCHEDULED' ? new Date(scheduledAt) : null,
      bookingStatus,
      otp,
      otpExpiresAt,
      broadcastExpiry,
      broadcastStartTime,
      isBroadcastActive
    });

    await booking.save({ session });

    // ---------- USER NOTIFICATION ----------
    const notification = new Notification({
      userId,
      bookingId: booking._id,
      type: 'BOOKING_CREATED',
      title: 'Booking Created',
      message: bookingType === 'IMMEDIATE'
        ? 'We are searching for a rider near you'
        : `Scheduled booking for ${new Date(scheduledAt).toLocaleString()}`
    });
    await notification.save({ session });

    // ---------- GEO‑BROADCAST PREPARATION ----------
    if (bookingType === 'IMMEDIATE') {
      const nearbyRiders = await Rider.find({
        isOnline: true,
        availabilityStatus: { $in: ['AVAILABLE', 'ACTIVE'] },
        approvalStatus: 'APPROVED',
        currentLocation: {
          $nearSphere: {
            $geometry: { type: 'Point', coordinates: [pickup.lng, pickup.lat] },
            $maxDistance: 10000
          }
        }
      }).limit(20).session(session);

      console.log(`📍 Found ${nearbyRiders.length} nearby available riders`);

      const cabs = await Cab.find({
        riderId: { $in: nearbyRiders.map(r => r._id) },
        isApproved: true,
        cabType: vehicleType
      }).session(session);

      const cabRiderIds = new Set(cabs.map(cab => cab.riderId.toString()));
      eligibleRiders = nearbyRiders.filter(rider => cabRiderIds.has(rider._id.toString()));

      console.log(`🚗 ${eligibleRiders.length} riders have matching cab type (${vehicleType})`);

      if (eligibleRiders.length > 0) {
        booking.broadcastedTo = eligibleRiders.map(r => r._id);
        await booking.save({ session });

        const bookingRequests = eligibleRiders.map(rider => ({
          bookingId: booking._id,
          riderId: rider._id,
          expiresAt: booking.broadcastExpiry,
          status: 'PENDING'
        }));
        await BookingRequest.insertMany(bookingRequests, { session });
      }
    }

    // ✅ COMMIT TRANSACTION
    await session.commitTransaction();

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error('Create booking error:', error);
    await session.endSession();
    return res.status(500).json({
      success: false,
      message: 'Failed to create booking'
    });
  }

  // ---------- POST‑COMMIT OPERATIONS ----------
  try {
    if (bookingType === 'IMMEDIATE' && eligibleRiders.length > 0) {
      const io = req.app.get('io');
      if (io) {
        const bookingData = {
          bookingId: booking._id,
          pickup: booking.pickup,
          drop: booking.drop,
          estimatedFare: booking.estimatedFare,
          distanceKm: booking.distanceKm,
          vehicleType: booking.vehicleType,
          userId: booking.userId,
          user: {
            name: req.user.name || 'Customer',
            phone: req.user.phone
          },
          broadcastExpiry: booking.broadcastExpiry
        };

        eligibleRiders.forEach(rider => {
          const roomName = `rider-${rider._id}`;
          io.to(roomName).emit('new-booking-request', bookingData);
          if (rider.socketId) {
            io.to(rider.socketId).emit('new-booking-request', bookingData);
          }
        });

        console.log(`📨 Broadcasted booking ${booking._id} to ${eligibleRiders.length} eligible riders (within 10km)`);
      }

      setTimeout(async () => {
        try {
          await checkBroadcastExpiry(booking._id);
        } catch (err) {
          console.error('Broadcast expiry check error:', err);
        }
      }, 31 * 1000);
    }

    // ✅ SUCCESS RESPONSE
    res.status(201).json({
      success: true,
      data: {
        bookingId: booking._id,
        otp: booking.otp,
        estimatedFare: booking.estimatedFare,
        distance: booking.distanceKm,
        bookingType: booking.bookingType,
        ...(booking.bookingType === 'SCHEDULED' && { scheduledAt: booking.scheduledAt })
      },
      message: booking.bookingType === 'IMMEDIATE'
        ? 'Booking created. Searching for riders...'
        : 'Scheduled booking created successfully'
    });

  } catch (postError) {
    console.error('Post‑commit operations error:', postError);
    res.status(201).json({
      success: true,
      data: {
        bookingId: booking._id,
        otp: booking.otp,
        estimatedFare: booking.estimatedFare,
        distance: booking.distanceKm,
        bookingType: booking.bookingType,
        ...(booking.bookingType === 'SCHEDULED' && { scheduledAt: booking.scheduledAt })
      },
      message: booking.bookingType === 'IMMEDIATE'
        ? 'Booking created (but real‑time broadcast may be delayed).'
        : 'Scheduled booking created successfully.'
    });
  } finally {
    await session.endSession();
  }
};

// Helper function to broadcast to nearby riders
const broadcastToNearbyRiders = async (booking, session, io) => {
  try {
    // Find nearby available riders
    const nearbyRiders = await Rider.find({
      availabilityStatus: 'AVAILABLE',
      isOnline: true,
      isLocked: false,
      currentLocation: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [booking.pickup.location.coordinates[0], booking.pickup.location.coordinates[1]]
          },
          $maxDistance: 5000 // 5km radius
        }
      },
      approvalStatus: 'APPROVED'
    }).session(session);

    // Filter riders with matching vehicle type
    const ridersWithMatchingVehicle = [];
    for (const rider of nearbyRiders) {
      const cab = await Cab.findOne({
        riderId: rider._id,
        cabType: booking.vehicleType,
        isApproved: true
      }).session(session);
      
      if (cab) {
        ridersWithMatchingVehicle.push(rider);
        booking.broadcastedTo.push(rider._id);
      }
    }

    if (ridersWithMatchingVehicle.length === 0) {
      // No riders available
      booking.bookingStatus = 'CANCELLED';
      booking.cancelledBy = 'SYSTEM';
      booking.cancellationReason = 'No riders available';
      booking.isBroadcastActive = false;
      await booking.save({ session });
      
      throw new Error('No riders available at the moment');
    }

    await booking.save({ session });

    // Broadcast to riders via WebSocket
    ridersWithMatchingVehicle.forEach(rider => {
      if (rider.socketId) {
        io.to(rider.socketId).emit('new-booking', {
          bookingId: booking._id,
          pickup: booking.pickup,
          drop: booking.drop,
          estimatedFare: booking.estimatedFare,
          distance: booking.distanceKm,
          vehicleType: booking.vehicleType,
          bookingType: booking.bookingType,
          broadcastExpiry: booking.broadcastExpiry,
          broadcastStartTime: booking.broadcastStartTime
        });
      }
      
      // Create booking request record with expiry
      const bookingRequest = new BookingRequest({
        bookingId: booking._id,
        riderId: rider._id,
        expiresAt: booking.broadcastExpiry,
        status: 'PENDING'
      });
      bookingRequest.save({ session });
    });

    return ridersWithMatchingVehicle.length;
  } catch (error) {
    console.error('Broadcast error:', error);
    throw error;
  }
};

// New function to handle scheduled booking broadcasts
export const processScheduledBookings = async () => {
  try {
    const now = new Date();
    const fifteenMinutesLater = new Date(now.getTime() + 15 * 60000);
    
    // Find scheduled bookings that should start broadcasting
    const scheduledBookings = await Booking.find({
      bookingType: 'SCHEDULED',
      bookingStatus: 'SCHEDULED',
      scheduledAt: {
        $lte: fifteenMinutesLater,
        $gte: now
      },
      isBroadcastActive: false
    }).limit(10);

    for (const booking of scheduledBookings) {
      const session = await mongoose.startSession();
      session.startTransaction();
      
      try {
        // Update booking status
        booking.bookingStatus = 'SEARCHING_DRIVER';
        booking.isBroadcastActive = true;
        booking.broadcastExpiry = new Date(Date.now() + 30 * 1000);
        booking.broadcastStartTime = new Date();
        
        await booking.save({ session });

        // Get WebSocket instance (we'll need to pass io instance)
        // This would typically be called from server.js where io is available
        // We'll handle this differently in practice
        
        await session.commitTransaction();
        
        console.log(`Started broadcast for scheduled booking ${booking._id}`);
      } catch (error) {
        await session.abortTransaction();
        console.error('Error processing scheduled booking:', error);
      } finally {
        session.endSession();
      }
    }
  } catch (error) {
    console.error('Error in processScheduledBookings:', error);
  }
};

// Update the checkBroadcastExpiry function to handle retries
const checkBroadcastExpiry = async (bookingId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const booking = await Booking.findById(bookingId).session(session);
    
    if (!booking || !['SEARCHING_DRIVER', 'SCHEDULED'].includes(booking.bookingStatus)) {
      await session.abortTransaction();
      return;
    }

    // Check if broadcast has expired
    if (new Date() > booking.broadcastExpiry) {
      // If we've tried less than 3 times, retry with extended radius
      if (booking.broadcastRetryCount < 3) {
        booking.broadcastRetryCount += 1;
        booking.broadcastExpiry = new Date(Date.now() + 30 * 1000);
        booking.lastBroadcastedAt = new Date();
        
        await booking.save({ session });
        
        // TODO: Re-broadcast with extended radius
        // This would require re-fetching riders with larger radius
      } else {
        // Max retries reached, cancel booking
        booking.bookingStatus = 'CANCELLED';
        booking.cancelledBy = 'SYSTEM';
        booking.cancellationReason = 'No rider accepted in time';
        booking.isBroadcastActive = false;
        
        await booking.save({ session });
        
        // Notify user
        const notification = new Notification({
          userId: booking.userId,
          bookingId: booking._id,
          type: 'BOOKING_CANCELLED',
          title: 'Booking Cancelled',
          message: 'No rider accepted your request in time'
        });
        await notification.save({ session });
      }
    }
    
    await session.commitTransaction();
    
  } catch (error) {
    await session.abortTransaction();
    console.error('Broadcast expiry check error:', error);
  } finally {
    session.endSession();
  }
};

// Add this function to broadcast booking
const broadcastBookingToNearbyRiders = async (booking, io) => {
  try {
    if (!io) {
      console.log('Socket.io instance not available');
      return;
    }

    // Find nearby riders with cabs matching vehicle type
    const cabs = await Cab.find({
      cabType: booking.vehicleType,
      isApproved: true
    }).populate({
      path: 'riderId',
      match: {
        isOnline: true,
        availabilityStatus: 'AVAILABLE',
        approvalStatus: 'APPROVED',
        isLocked: false,
        currentLocation: {
          $nearSphere: {
            $geometry: {
              type: 'Point',
              coordinates: booking.pickup.location.coordinates
            },
            $maxDistance: 10000 // 10km radius
          }
        }
      }
    });

    // Filter out cabs without valid riders
    const validCabs = cabs.filter(cab => cab.riderId);
    const riderIds = validCabs.map(cab => cab.riderId._id);

    if (riderIds.length > 0) {
      // Add riders to broadcastedTo array
      await Booking.findByIdAndUpdate(booking._id, {
        $addToSet: { broadcastedTo: { $each: riderIds } }
      });

      // Send WebSocket notifications
      validCabs.forEach(cab => {
        const rider = cab.riderId;
        io.to(`rider-${rider._id}`).emit('new-booking-request', {
          bookingId: booking._id,
          pickup: booking.pickup,
          drop: booking.drop,
          estimatedFare: booking.estimatedFare,
          distanceKm: booking.distanceKm,
          vehicleType: booking.vehicleType
        });
      });

      console.log(`Broadcasted booking ${booking._id} to ${riderIds.length} riders`);
    } else {
      console.log(`No available riders found for booking ${booking._id}`);
    }
  } catch (error) {
    console.error('Broadcast booking error:', error);
  }
};


// 2. Get Booking Status
export const getBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const booking = await Booking.findOne({ _id: id, userId })
      .populate('riderId', 'name phone photo rating')
      .populate('cabId', 'cabType cabModel cabNumber');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get booking details'
    });
  }
};

// 3. Track Booking (Real-time)
export const trackBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id)
      .populate('riderId', 'name phone')
      .select('bookingStatus riderId pickup drop');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Track booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track booking'
    });
  }
};

// 4. Get OTP for Trip Start
export const getBookingOTP = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const booking = await Booking.findOne({
      _id: id,
      userId,
      bookingStatus: { $in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED'] }
    }).select('otp riderId');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'OTP not available or booking not in correct state'
      });
    }

    res.status(200).json({
      success: true,
      data: { otp: booking.otp }
    });
  } catch (error) {
    console.error('Get OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get OTP'
    });
  }
};

// 5. Cancel Booking
export const cancelBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const { reason } = req.body;

    const booking = await Booking.findOne({
      _id: id,
      userId,
      bookingStatus: { $in: ['INITIATED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED'] }
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Booking cannot be cancelled at this stage'
      });
    }

    // Calculate cancellation charge
    let cancellationCharge = 0;
    if (booking.bookingStatus === 'DRIVER_ASSIGNED') {
      cancellationCharge = booking.estimatedFare * 0.1; // 10% charge
    }

    // Update booking
    booking.bookingStatus = 'CANCELLED';
    booking.cancelledBy = 'USER';
    booking.cancellationReason = reason;
    booking.cancellationCharge = cancellationCharge;
    booking.isBroadcastActive = false;
    
    await booking.save({ session });

    // If rider was assigned, unlock them
    if (booking.riderId) {
      await Rider.findByIdAndUpdate(booking.riderId, {
        isLocked: false,
        lockedUntil: null,
        currentBooking: null,
        availabilityStatus: 'AVAILABLE'
      }).session(session);

      // Notify rider via WebSocket
      const io = req.app.get('io');
      const rider = await Rider.findById(booking.riderId).session(session);
      if (rider && rider.socketId) {
        io.to(rider.socketId).emit('booking-cancelled', {
          bookingId: booking._id
        });
      }
    }

    // Create notification
    const notification = new Notification({
      userId,
      bookingId: booking._id,
      type: 'BOOKING_CANCELLED',
      title: 'Booking Cancelled',
      message: `Your booking has been cancelled. ${cancellationCharge > 0 ? `Cancellation charge: ₹${cancellationCharge}` : ''}`
    });
    await notification.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { cancellationCharge }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  } finally {
    session.endSession();
  }
};

// 6. Calculate Fare Estimate
export const calculateFareEstimate = async (req, res) => {
  try {
    const { pickup, drop, vehicleType } = req.body;

    // Check if all required fields are present
    if (!pickup || !drop || !vehicleType) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: pickup, drop, or vehicleType'
      });
    }

    // Check if coordinates are valid
    if (typeof pickup !== 'object' || typeof drop !== 'object' ||
        typeof pickup.lat !== 'number' || typeof pickup.lng !== 'number' || 
        typeof drop.lat !== 'number' || typeof drop.lng !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates provided'
      });
    }

    // Calculate distance
    const distance = calculateDistance(
      pickup.lat, pickup.lng,
      drop.lat, drop.lng
    );

    // Get pricing - with fallback defaults
    let pricing = await Pricing.findOne({ cabType: vehicleType });
    
    // If no pricing found in DB, use defaults
    if (!pricing) {
      // Default pricing based on vehicle type
      const defaultPricing = {
        HATCHBACK: { baseFare: 50, pricePerKm: 10 },
        SEDAN: { baseFare: 60, pricePerKm: 12 },
        SUV: { baseFare: 80, pricePerKm: 15 },
        LUXURY: { baseFare: 100, pricePerKm: 20 }
      };
      
      const defaults = defaultPricing[vehicleType] || defaultPricing.SEDAN;
      pricing = {
        baseFare: defaults.baseFare,
        pricePerKm: defaults.pricePerKm,
        adminCommissionPercent: 20
      };
      
      // Save default to database for future use
      await Pricing.create({
        cabType: vehicleType,
        baseFare: defaults.baseFare,
        pricePerKm: defaults.pricePerKm,
        adminCommissionPercent: 20
      });
    }

    // Calculate fare
    const estimatedFare = pricing.baseFare + (distance * pricing.pricePerKm);
    
    // Round to nearest rupee
    const roundedFare = Math.round(estimatedFare);

    res.status(200).json({
      success: true,
      data: {
        distance: parseFloat(distance.toFixed(2)),
        estimatedFare: roundedFare,
        baseFare: pricing.baseFare,
        pricePerKm: pricing.pricePerKm,
        estimatedDuration: Math.round((distance / 25) * 60), // Assuming 25 km/h average speed
        vehicleType,
        breakdown: {
          baseFare: pricing.baseFare,
          distanceFare: Math.round(distance * pricing.pricePerKm)
        }
      }
    });

  } catch (error) {
    console.error('Calculate fare error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate fare',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Add this function to bookingController.js, after calculateFareEstimate function:

// 8. Get Available Bookings for Riders
// ============================================================
// 8. Get Available Bookings for Riders – with Geospatial + Fallback
// ============================================================
// ============================================================
// 8. Get Available Bookings for Riders – NO broadcastedTo filter
// ============================================================
export const getAvailableBookingsForRiders = async (req, res) => {
  try {
    const riderId = req.user._id;
    const { lat, lng, radius = 10 } = req.query;

    console.log('🔍 Getting available bookings for rider:', riderId, { lat, lng, radius });

    // ---------- RIDER VALIDATION ----------
    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(404).json({ success: false, message: 'Rider not found' });
    }

    if (!rider.isOnline || !['AVAILABLE', 'ACTIVE'].includes(rider.availabilityStatus)) {
      return res.status(200).json({
        success: true,
        data: [],
        message: `Go online first. Current status: ${rider.availabilityStatus}`
      });
    }

    // ---------- CAB VALIDATION ----------
    const cab = await Cab.findOne({ riderId, isApproved: true });
    if (!cab) {
      return res.status(400).json({
        success: false,
        message: 'No approved cab found for rider'
      });
    }
    console.log('🚗 Rider cab:', { cabType: cab.cabType, cabNumber: cab.cabNumber });

    // ---------- LOCATION RESOLUTION ----------
    let searchLat = parseFloat(lat);
    let searchLng = parseFloat(lng);
    if (!searchLat || !searchLng) {
      if (rider.currentLocation?.coordinates) {
        searchLng = rider.currentLocation.coordinates[0];
        searchLat = rider.currentLocation.coordinates[1];
      } else {
        return res.status(400).json({
          success: false,
          message: 'Location coordinates required'
        });
      }
    }
    console.log('📍 Search location:', { searchLat, searchLng, radius });

    // ---------- BASE QUERY (COMMON FILTERS) ----------
    const baseQuery = {
      bookingStatus: 'SEARCHING_DRIVER',
      vehicleType: cab.cabType,
      isBroadcastActive: true,
      broadcastExpiry: { $gt: new Date() }
      // ❌ NO broadcastedTo filter – rider sees all available bookings
    };

    // ---------- 1️⃣ PRIMARY: GEOSPATIAL QUERY (within radius) ----------
    let availableBookings = [];
    let usedFallback = false;

    if (searchLat && searchLng && !isNaN(searchLat) && !isNaN(searchLng)) {
      const geospatialQuery = {
        ...baseQuery,
        'pickup.location': {
          $nearSphere: {
            $geometry: { type: 'Point', coordinates: [searchLng, searchLat] },
            $maxDistance: radius * 1000
          }
        }
      };

      console.log('🔍 Geospatial query:', JSON.stringify(geospatialQuery, null, 2));
      availableBookings = await Booking.find(geospatialQuery)
        .populate('userId', 'name phone rating')
        .sort({ createdAt: -1 })
        .limit(10);
    }

    // ---------- 2️⃣ FALLBACK: NO GEOSPATIAL ----------
    if (availableBookings.length === 0) {
      console.log('⚠️ No nearby bookings – falling back to non‑geospatial query');
      usedFallback = true;

      const fallbackQuery = {
        ...baseQuery
        // intentionally NO pickup.location filter
      };

      console.log('🔍 Fallback query:', JSON.stringify(fallbackQuery, null, 2));
      availableBookings = await Booking.find(fallbackQuery)
        .populate('userId', 'name phone rating')
        .sort({ createdAt: -1 })
        .limit(10);
    }

    console.log(`📋 Found ${availableBookings.length} bookings ${usedFallback ? '(fallback)' : '(geospatial)'}`);

    // ---------- 3️⃣ ENRICH WITH DISTANCE FROM RIDER ----------
    const bookingsWithDistance = availableBookings.map(booking => {
      let distanceFromRider = 0;
      if (booking.pickup?.location?.coordinates?.length >= 2) {
        const [lng, lat] = booking.pickup.location.coordinates;
        if (!isNaN(lat) && !isNaN(lng)) {
          distanceFromRider = calculateDistance(searchLat, searchLng, lat, lng);
        }
      }
      return {
        ...booking.toObject(),
        distanceFromRider: parseFloat(distanceFromRider.toFixed(2))
      };
    });

    // ❌ REMOVED: Do NOT update broadcastedTo – it hides the booking immediately

    // ---------- 4️⃣ RESPONSE ----------
    res.status(200).json({
      success: true,
      data: bookingsWithDistance,
      message: `Found ${bookingsWithDistance.length} available bookings${usedFallback ? ' (nationwide, none nearby)' : ''}`,
      ...(usedFallback && { notice: 'No bookings near your location – showing all matching bookings' })
    });

  } catch (error) {
    console.error('❌ Get available bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get available bookings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// 9. Update Booking Status (Generic status update for riders/admins)
export const updateBookingStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { status, otp, actualDistance, reason } = req.body;
    const userId = req.user._id;
    const userRole = req.user.role;

    // Find booking
    const booking = await Booking.findById(id).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Authorization check
    if (userRole === 'RIDER') {
      if (booking.riderId.toString() !== userId.toString()) {
        await session.abortTransaction();
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this booking'
        });
      }
    }

    // Validate status transition
  const validTransitions = {
  SEARCHING_DRIVER: ['CANCELLED'],
  DRIVER_ASSIGNED: ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['TRIP_STARTED', 'CANCELLED'],
  TRIP_STARTED: ['TRIP_COMPLETED', 'CANCELLED'],
  TRIP_COMPLETED: ['PAYMENT_DONE'],
  PAYMENT_DONE: [],
  CANCELLED: []
};


    const allowedStatuses = validTransitions[booking.bookingStatus] || [];
    if (!allowedStatuses.includes(status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${booking.bookingStatus} to ${status}`
      });
    }

    // Handle specific status transitions
    switch (status) {
      case 'DRIVER_ASSIGNED':
        // Already handled by acceptBookingRequest
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Use /accept endpoint for driver assignment'
        });

      case 'DRIVER_ARRIVED':
        if (!otp) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: 'OTP is required for marking arrival'
          });
        }

        if (booking.otp !== otp) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: 'Invalid OTP'
          });
        }

        if (new Date() > booking.otpExpiresAt) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: 'OTP has expired'
          });
        }

        booking.bookingStatus = 'DRIVER_ARRIVED';
        booking.otpVerifiedAt = new Date();
        break;

      case 'TRIP_STARTED':
        booking.bookingStatus = 'TRIP_STARTED';
        booking.rideStartTime = new Date();
        break;

      case 'TRIP_COMPLETED':
        if (!actualDistance) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: 'Actual distance is required for trip completion'
          });
        }

        // Get pricing
        const Pricing = (await import('../models/Pricing.js')).default;
        const pricing = await Pricing.findOne({ cabType: booking.vehicleType }).session(session);
        
        if (!pricing) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: 'Pricing not found for vehicle type'
          });
        }

        // Calculate final fare
        const finalFare = pricing.baseFare + (actualDistance * pricing.pricePerKm);
        const adminCommission = finalFare * (pricing.adminCommissionPercent / 100);
        const riderEarning = finalFare - adminCommission;

        booking.bookingStatus = 'TRIP_COMPLETED';
        booking.rideEndTime = new Date();
        booking.finalFare = finalFare;
        booking.adminCommissionAmount = adminCommission;
        booking.riderEarning = riderEarning;

        // Update rider stats
        const rider = await Rider.findById(booking.riderId).session(session);
        if (rider) {
          rider.completedRides += 1;
          rider.isLocked = false;
          rider.lockedUntil = null;
          rider.currentBooking = null;
          rider.availabilityStatus = 'AVAILABLE';
          await rider.save({ session });
        }

        // Create rider earning record
        const RiderEarning = (await import('../models/RiderEarning.js')).default;
        const riderEarningRecord = new RiderEarning({
          bookingId: booking._id,
          riderId: booking.riderId,
          totalFare: finalFare,
          adminCommission: adminCommission,
          riderEarning: riderEarning,
          payoutStatus: 'PENDING'
        });
        await riderEarningRecord.save({ session });

        // Update rider wallet
        const RiderWallet = (await import('../models/RiderWallet.js')).default;
        await RiderWallet.findOneAndUpdate(
          { riderId: booking.riderId },
          { 
            $inc: { balance: riderEarning },
            updatedAt: new Date()
          },
          { session, upsert: true }
        );
        break;

      case 'CANCELLED':
        booking.bookingStatus = 'CANCELLED';
        booking.cancelledBy = userRole === 'RIDER' ? 'RIDER' : 'USER';
        booking.cancellationReason = reason || 'No reason provided';
        booking.isBroadcastActive = false;

        // If rider was assigned, unlock them
        if (booking.riderId) {
          await Rider.findByIdAndUpdate(booking.riderId, {
            isLocked: false,
            lockedUntil: null,
            currentBooking: null,
            availabilityStatus: 'AVAILABLE'
          }).session(session);
        }
        break;

      case 'PAYMENT_DONE':
        booking.bookingStatus = 'PAYMENT_DONE';
        booking.paymentStatus = 'PAID';
        break;

      default:
        booking.bookingStatus = status;
    }

    await booking.save({ session });

    // Create notification
    const Notification = (await import('../models/Notification.js')).default;
    let notificationMessage = '';
    
    switch (status) {
      case 'DRIVER_ARRIVED':
        notificationMessage = 'Your rider has arrived at the pickup location';
        break;
      case 'TRIP_STARTED':
        notificationMessage = 'Your trip has started';
        break;
      case 'TRIP_COMPLETED':
        notificationMessage = `Your trip has been completed. Final fare: ₹${booking.finalFare}`;
        break;
      case 'CANCELLED':
        notificationMessage = `Booking cancelled: ${booking.cancellationReason}`;
        break;
      default:
        notificationMessage = `Booking status updated to ${status}`;
    }

    let notificationType;
switch (status) {
  case 'DRIVER_ARRIVED':
    notificationType = 'DRIVER_ARRIVED';
    break;
  case 'TRIP_STARTED':
    notificationType = 'RIDE_STARTED';
    break;
  case 'TRIP_COMPLETED':
    notificationType = 'RIDE_COMPLETED';
    break;
  case 'CANCELLED':
    notificationType = 'BOOKING_CANCELLED';
    break;
  case 'PAYMENT_DONE':
    notificationType = 'PAYMENT_SUCCESS';
    break;
  default:
    notificationType = `BOOKING_${status}`; // fallback – may still be invalid for some
}

    
const notification = new Notification({
  userId: booking.userId,
  riderId: booking.riderId,
  bookingId: booking._id,
  type: notificationType,      // ✅ now using the mapped type
  title: 'Booking Status Updated',
  message: notificationMessage // ✅ stays the same
});
await notification.save({ session });

    await session.commitTransaction();

    // Send WebSocket notification
    const io = req.app.get('io');
    io.to(`user-${booking.userId.toString()}`).emit('booking-status-updated', {
      bookingId: booking._id,
      status: booking.bookingStatus,
      updatedAt: booking.updatedAt
    });

    if (booking.riderId) {
      io.to(`rider-${booking.riderId.toString()}`).emit('booking-status-updated', {
        bookingId: booking._id,
        status: booking.bookingStatus,
        updatedAt: booking.updatedAt
      });
    }

    res.status(200).json({
      success: true,
      message: `Booking status updated to ${status}`,
      data: booking
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
};

// Debug booking function
export const debugBooking = async (req, res) => {
  try {
    const { id } = req.params;
    
    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Get all online riders
    const onlineRiders = await Rider.find({ isOnline: true });
    
    // Get riders with matching cabs
    const cabs = await Cab.find({
      riderId: { $in: onlineRiders.map(r => r._id) },
      isApproved: true,
      cabType: booking.vehicleType
    });

    const matchingRiders = onlineRiders.filter(rider => 
      cabs.some(cab => cab.riderId.toString() === rider._id.toString())
    );

    res.json({
      success: true,
      data: {
        booking: {
          id: booking._id,
          status: booking.bookingStatus,
          vehicleType: booking.vehicleType,
          isBroadcastActive: booking.isBroadcastActive,
          broadcastExpiry: booking.broadcastExpiry,
          broadcastedTo: booking.broadcastedTo
        },
        onlineRiders: onlineRiders.length,
        matchingRiders: matchingRiders.length,
        riderDetails: matchingRiders.map(r => ({
          id: r._id,
          name: r.name,
          isOnline: r.isOnline,
          availabilityStatus: r.availabilityStatus,
          approvalStatus: r.approvalStatus
        }))
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
export const getNearbyCabs = async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Location coordinates are required'
      });
    }

    const nearbyRiders = await Rider.find({
      availabilityStatus: 'AVAILABLE',
      isOnline: true,
      isLocked: false,
      currentLocation: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: 5000 // 5km
        }
      },
      approvalStatus: 'APPROVED'
    }).select('currentLocation').limit(20);

    // Get cab details for riders
    const riderIds = nearbyRiders.map(rider => rider._id);
    const cabs = await Cab.find({
      riderId: { $in: riderIds },
      isApproved: true
    }).populate('riderId', 'name');

    res.status(200).json({
      success: true,
      data: {
        count: nearbyRiders.length,
        cabs: cabs.map(cab => ({
          cabType: cab.cabType,
          cabModel: cab.cabModel,
          riderName: cab.riderId.name,
          location: cab.riderId.currentLocation
        }))
      }
    });
  } catch (error) {
    console.error('Get nearby cabs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby cabs'
    });
  }
};