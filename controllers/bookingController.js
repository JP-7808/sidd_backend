// controllers/bookingController.js
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Rider from '../models/Rider.js';
import Cab from '../models/Cab.js';
import Pricing from '../models/Pricing.js';
import BookingRequest from '../models/BookingRequest.js';
import Notification from '../models/Notification.js';
import Payment from '../models/Payment.js';
import { calculateDistance, generateOTP, calculateFare, formatDuration  } from '../utils/helper.js';
import { sendEmail } from '../utils/emailService.js';
import mongoose from 'mongoose';
import { getDistanceMatrix, reverseGeocode } from '../utils/googleMapsHelper.js';

// @desc    Calculate fare for a trip
// @route   POST /api/bookings/calculate-fare
// @access  Public
// controllers/bookingController.js

// @desc    Calculate fare for a trip
// @route   POST /api/bookings/calculate-fare
// @access  Public
export const calculateFareController = async (req, res) => {
  try {
    console.log('Received fare calculation request:', req.body);
    
    const { pickup, drop, vehicleType, tripType } = req.body;

    // Validate required fields
    if (!pickup || !drop) {
      return res.status(400).json({
        success: false,
        message: 'Pickup and drop locations are required'
      });
    }

    if (!vehicleType) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle type is required'
      });
    }

    // Extract coordinates properly
    let pickupLat, pickupLng, dropLat, dropLng;

    // Handle different coordinate formats
    if (pickup.coordinates) {
      // Format: [lng, lat]
      pickupLng = pickup.coordinates[0];
      pickupLat = pickup.coordinates[1];
    } else if (pickup.lat && pickup.lng) {
      // Format: { lat, lng }
      pickupLat = pickup.lat;
      pickupLng = pickup.lng;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid pickup coordinates format'
      });
    }

    if (drop.coordinates) {
      dropLng = drop.coordinates[0];
      dropLat = drop.coordinates[1];
    } else if (drop.lat && drop.lng) {
      dropLat = drop.lat;
      dropLng = drop.lng;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid drop coordinates format'
      });
    }

    console.log('Extracted coordinates:', { pickupLat, pickupLng, dropLat, dropLng });

    // Calculate distance using Haversine formula (simple version)
    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371; // Radius of the earth in km
      const dLat = deg2rad(lat2 - lat1);
      const dLon = deg2rad(lon2 - lon1);
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2); 
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
      const distance = R * c; // Distance in km
      return Math.max(distance, 1.0); // Minimum 1km
    };

    const deg2rad = (deg) => {
      return deg * (Math.PI/180);
    };

    const distanceKm = calculateDistance(pickupLat, pickupLng, dropLat, dropLng);

    // Get pricing from database
    const Pricing = (await import('../models/Pricing.js')).default;
    
    let pricing = await Pricing.findOne({ 
      cabType: vehicleType,
      isActive: true 
    });

    // If no pricing found, use default values
    if (!pricing) {
      console.log('No pricing found for vehicle type:', vehicleType, 'using defaults');
      
    }

    // Calculate fare
    const baseFare = pricing.baseFare;
    const pricePerKm = pricing.pricePerKm;
    
    // Apply trip type multiplier
    let multiplier = 1;
    if (tripType === 'ROUND_TRIP') {
      multiplier = 1.8; // 20% discount on return trip
    }

    const estimatedFare = Math.round((baseFare + (distanceKm * pricePerKm)) * multiplier);

    // Return response
    res.json({
      success: true,
      data: {
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        baseFare,
        pricePerKm,
        estimatedFare,
        vehicleType,
        currency: 'INR',
        tripType: tripType || 'ONE_WAY'
      }
    });

  } catch (error) {
    console.error('Calculate fare error:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating fare',
      error: error.message
    });
  }
};

// @desc    Create a new booking
// @route   POST /api/bookings
// @access  Private (User)
// controllers/bookingController.js

// @desc    Create a new booking
// @route   POST /api/bookings
// @access  Private (User)
// controllers/bookingController.js - Enhanced with debug logs

// @desc    Create a new booking
// @route   POST /api/bookings
// @access  Private (User)
// controllers/bookingController.js

// @desc    Create a new booking (Step 1 - Create and broadcast)
// @route   POST /api/bookings
// @access  Private (User)
// controllers/bookingController.js - Update createBooking function

// @desc    Create a new booking
// @route   POST /api/bookings
// @access  Private (User)
export const createBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    console.log('========== CREATE BOOKING ==========');
    
    const userId = req.user._id;
    const {
      pickup,
      drop,
      vehicleType,
      bookingType,
      scheduledAt,
      paymentMethod,
      distanceKm,
      estimatedFare
    } = req.body;

    // Validate required fields
    if (!pickup || !drop || !vehicleType || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Get user details
    const User = mongoose.model('User');
    const user = await User.findById(userId).session(session);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Format locations
    const pickupLocation = {
      addressText: pickup.addressText,
      contactName: pickup.contactName || user.name,
      contactPhone: pickup.contactPhone || user.phone,
      location: {
        type: 'Point',
        coordinates: pickup.coordinates || [pickup.lng, pickup.lat]
      },
      lat: pickup.lat,
      lng: pickup.lng,
      placeId: pickup.placeId || ''
    };

    const dropLocation = {
      addressText: drop.addressText,
      location: {
        type: 'Point',
        coordinates: drop.coordinates || [drop.lng, drop.lat]
      },
      lat: drop.lat,
      lng: drop.lng,
      placeId: drop.placeId || ''
    };

    // Generate OTP
    const generateOTP = () => {
      return Math.floor(100000 + Math.random() * 900000).toString();
    };
    
    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

    // Create booking with INITIATED status
    const Booking = mongoose.model('Booking');
    
    const bookingData = {
      userId,
      pickup: pickupLocation,
      drop: dropLocation,
      vehicleType,
      bookingType: bookingType || 'IMMEDIATE',
      scheduledAt: bookingType === 'SCHEDULED' ? new Date(scheduledAt) : null,
      distanceKm: distanceKm || 0,
      estimatedFare: estimatedFare || 0,
      paymentMethod,
      bookingStatus: 'INITIATED', // Start with INITIATED
      otp,
      otpExpiresAt,
      broadcastRetryCount: 0,
      isBroadcastActive: false,
      broadcastedTo: []
    };

    const booking = new Booking(bookingData);
    await booking.save({ session });

    // Create payment record (PENDING)
    const Payment = mongoose.model('Payment');
    const payment = new Payment({
      bookingId: booking._id,
      userId,
      amount: estimatedFare || 0,
      paymentMethod,
      paymentType: 'FULL',
      paymentStatus: 'PENDING',
      description: `Payment for booking ${booking._id}`
    });
    await payment.save({ session });

    // Create notification for user
    const Notification = mongoose.model('Notification');
    const notification = new Notification({
      userId,
      bookingId: booking._id,
      type: 'BOOKING_CREATED',
      title: 'Booking Created',
      message: `Your booking has been created. Searching for nearby drivers...`,
      data: { bookingId: booking._id }
    });
    await notification.save({ session });

    await session.commitTransaction();

    // IMPORTANT: Immediately start broadcasting to nearby riders
    let broadcastResult = { success: false, message: 'Broadcast not started', count: 0 };
    
    if (bookingType === 'IMMEDIATE') {
      console.log('🚀 Starting broadcast for immediate booking:', booking._id);
      
      // Call the broadcast function - make sure to pass the io instance from app
      broadcastResult = await broadcastToNearbyRiders(booking._id, req.app.get('io'));
      
      console.log('📢 Broadcast result:', broadcastResult);
    } else {
      console.log('📅 Scheduled booking - will broadcast later:', booking._id);
      // For scheduled bookings, you might want to schedule the broadcast
    }

    res.status(201).json({
      success: true,
      message: 'Booking created successfully. Searching for nearby drivers...',
      data: {
        booking,
        broadcastResult,
        status: 'SEARCHING_DRIVER'
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating booking',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Enhanced broadcast function
// controllers/bookingController.js - Fix broadcastToNearbyRiders function

export const broadcastToNearbyRiders = async (bookingId, io) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    console.log('📢 Starting broadcast for booking:', bookingId);
    
    const Booking = mongoose.model('Booking');
    const Rider = mongoose.model('Rider');
    const Cab = mongoose.model('Cab');
    const BookingRequest = mongoose.model('BookingRequest');
    const Notification = mongoose.model('Notification');

    const booking = await Booking.findById(bookingId).session(session);
    
    if (!booking) {
      console.log('❌ Booking not found:', bookingId);
      return { success: false, message: 'Booking not found' };
    }

    console.log('📦 Booking details:', {
      id: booking._id,
      vehicleType: booking.vehicleType,
      pickup: booking.pickup?.addressText,
      coordinates: booking.pickup?.location?.coordinates
    });

    // Update booking status to SEARCHING_DRIVER
    booking.bookingStatus = 'SEARCHING_DRIVER';
    booking.isBroadcastActive = true;
    await booking.save({ session });

    // Find all cabs of the requested vehicle type
    const cabs = await Cab.find({
      cabType: booking.vehicleType,
      isApproved: true,
      isAvailable: true
    }).select('riderId');

    console.log(`🚗 Found ${cabs.length} cabs of type ${booking.vehicleType}`);

    if (cabs.length === 0) {
      console.log('❌ No cabs found for vehicle type:', booking.vehicleType);
      
      booking.bookingStatus = 'NO_DRIVER_FOUND';
      booking.isBroadcastActive = false;
      await booking.save({ session });
      
      await session.commitTransaction();
      
      return { 
        success: false, 
        message: 'No cabs available for this vehicle type',
        count: 0
      };
    }

    const riderIds = cabs.map(cab => cab.riderId);
    console.log('👤 Potential rider IDs:', riderIds);

    // Find nearby available riders (within 10km)
    const [lng, lat] = booking.pickup.location.coordinates;
    
    console.log('📍 Search coordinates:', { lat, lng });
    
    const nearbyRiders = await Rider.find({
      _id: { $in: riderIds },
      isOnline: true,
      availabilityStatus: 'AVAILABLE',
      approvalStatus: 'APPROVED',
      isActive: true,
      currentLocation: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat]
          },
          $maxDistance: 30000 // 30km radius
        }
      }
    }).select('_id name');

    console.log(`📍 Found ${nearbyRiders.length} nearby available riders:`, 
      nearbyRiders.map(r => ({ id: r._id, name: r.name })));

    if (nearbyRiders.length === 0) {
      console.log('❌ No nearby riders found');
      
      booking.bookingStatus = 'NO_DRIVER_FOUND';
      booking.isBroadcastActive = false;
      await booking.save({ session });
      
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
      
      await session.commitTransaction();
      
      return { 
        success: false, 
        message: 'No riders found nearby',
        count: 0
      };
    }

    const riderIdList = nearbyRiders.map(r => r._id);
    const expiresAt = new Date(Date.now() + 900 * 1000); // 90 seconds

    // Create booking requests for each rider
    const bookingRequests = [];
    for (const riderId of riderIdList) {
      // Check if request already exists
      const existingRequest = await BookingRequest.findOne({
        bookingId: booking._id,
        riderId
      }).session(session);

      if (!existingRequest) {
        bookingRequests.push({
          bookingId: booking._id,
          riderId,
          status: 'PENDING',
          expiresAt
        });
      }
    }

    if (bookingRequests.length > 0) {
      await BookingRequest.insertMany(bookingRequests, { session });
      console.log(`✅ Created ${bookingRequests.length} booking requests`);
    }

    // Update booking
    booking.broadcastedTo = riderIdList;
    booking.broadcastExpiry = expiresAt;
    booking.lastBroadcastedAt = new Date();
    await booking.save({ session });

    await session.commitTransaction();

    // Emit socket events to riders
    if (io) {
      const bookingData = {
        bookingId: booking._id,
        pickup: {
          addressText: booking.pickup.addressText,
          location: booking.pickup.location.coordinates,
          lat: booking.pickup.lat,
          lng: booking.pickup.lng
        },
        drop: {
          addressText: booking.drop.addressText,
          lat: booking.drop.lat,
          lng: booking.drop.lng
        },
        distanceKm: booking.distanceKm,
        estimatedFare: booking.estimatedFare,
        vehicleType: booking.vehicleType,
        expiresAt,
        customerName: (await User.findById(booking.userId))?.name || 'Customer'
      };

      console.log(`📡 Broadcasting to ${riderIdList.length} riders via socket`);
      
      riderIdList.forEach(riderId => {
        console.log(`  → Emitting to rider-${riderId}`);
        io.to(`rider-${riderId}`).emit('new-booking-request', bookingData);
      });
    }

    return { 
      success: true, 
      message: 'Booking broadcasted successfully',
      count: riderIdList.length
    };
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Broadcast error:', error);
    return { success: false, message: error.message };
  } finally {
    session.endSession();
  }
};

// @desc    Get booking details
// @route   GET /api/bookings/:id
// @access  Private
export const getBookingDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    const booking = await Booking.findById(id)
      .populate('userId', 'name email phone photo')
      .populate('riderId', 'name email phone photo overallRating')
      .populate('cabId', 'cabNumber cabModel cabType images');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization
    if (userRole === 'USER' && booking.userId._id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    if (userRole === 'RIDER' && (!booking.riderId || booking.riderId._id.toString() !== userId.toString())) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    // Get payment details
    const payment = await Payment.findOne({ bookingId: id });

    res.json({
      success: true,
      data: {
        ...booking.toObject(),
        payment
      }
    });
  } catch (error) {
    console.error('Get booking details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking details'
    });
  }
};

// @desc    Get user bookings
// @route   GET /api/bookings/user/my-bookings
// @access  Private (User)
export const getUserBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { userId };
    if (status) {
      query.bookingStatus = status;
    }

    const bookings = await Booking.find(query)
      .populate('riderId', 'name phone photo overallRating')
      .populate('cabId', 'cabNumber cabModel cabType')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get user bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings'
    });
  }
};

// @desc    Get rider bookings
// @route   GET /api/bookings/rider/my-bookings
// @access  Private (Rider)
export const getRiderBookings = async (req, res) => {
  try {
    const riderId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { riderId };
    if (status) {
      query.bookingStatus = status;
    }

    const bookings = await Booking.find(query)
      .populate('userId', 'name phone photo')
      .populate('cabId', 'cabNumber cabModel cabType')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get rider bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings'
    });
  }
};

// @desc    Find nearby available riders
// @route   GET /api/bookings/nearby-riders
// @access  Private (Admin/System)
// @desc    Find nearby available riders
// @route   GET /api/bookings/nearby-riders
// @access  Private
export const findNearbyRiders = async (req, res) => {
  try {
    const { lat, lng, vehicleType, radius = 10 } = req.query; // radius in km

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Location coordinates required'
      });
    }

    // Convert radius from km to meters for MongoDB $near query
    const maxDistance = radius * 1000;

    // Find riders with matching cab type
    const Cab = (await import('../models/Cab.js')).default;
    const Rider = (await import('../models/Rider.js')).default;

    const cabs = await Cab.find({
      cabType: vehicleType,
      isApproved: true,
      isAvailable: true
    }).select('riderId');

    const riderIds = cabs.map(cab => cab.riderId);

    // Find online and available riders with location within radius
    const riders = await Rider.find({
      _id: { $in: riderIds },
      isOnline: true,
      availabilityStatus: 'AVAILABLE',
      approvalStatus: 'APPROVED',
      isActive: true,
      currentLocation: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: maxDistance
        }
      }
    }).select('name phone overallRating currentLocation');

    // Calculate actual distance for each rider (optional)
    const ridersWithDistance = await Promise.all(riders.map(async (rider) => {
      const [riderLng, riderLat] = rider.currentLocation.coordinates;
      const distance = await calculateDistance(
        { lat, lng },
        { lat: riderLat, lng: riderLng }
      );
      
      return {
        ...rider.toObject(),
        distance: {
          km: parseFloat(distance.toFixed(2)),
          text: `${distance.toFixed(1)} km`
        }
      };
    }));

    res.json({
      success: true,
      data: ridersWithDistance.sort((a, b) => a.distance.km - b.distance.km)
    });
  } catch (error) {
    console.error('Find nearby riders error:', error);
    res.status(500).json({
      success: false,
      message: 'Error finding nearby riders'
    });
  }
};

// @desc    Broadcast booking to nearby riders
// @route   POST /api/bookings/:id/broadcast
// @access  Private (System/Admin)
export const broadcastBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await broadcastToNearbyRiders(id);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Broadcast booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error broadcasting booking'
    });
  }
};



// @desc    Accept booking (by rider)
// @route   POST /api/bookings/:id/accept
// @access  Private (Rider)
export const acceptBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const riderId = req.user._id;

    // Find booking
    const booking = await Booking.findById(id).session(session);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking can be accepted
    if (booking.bookingStatus !== 'SEARCHING_DRIVER' && booking.bookingStatus !== 'SCHEDULED') {
      return res.status(400).json({
        success: false,
        message: `Booking cannot be accepted in ${booking.bookingStatus} status`
      });
    }

    if (booking.riderId) {
      return res.status(400).json({
        success: false,
        message: 'Booking already has a rider assigned'
      });
    }

    // Check if rider was broadcasted to
    if (!booking.broadcastedTo.some(id => id.toString() === riderId.toString())) {
      return res.status(403).json({
        success: false,
        message: 'You were not invited to this booking'
      });
    }

    // Check if rider has a pending request
    const bookingRequest = await BookingRequest.findOne({
      bookingId: id,
      riderId,
      status: 'PENDING'
    }).session(session);

    if (!bookingRequest) {
      return res.status(400).json({
        success: false,
        message: 'No pending request found for this booking'
      });
    }

    // Check if request expired
    if (new Date() > bookingRequest.expiresAt) {
      bookingRequest.status = 'EXPIRED';
      await bookingRequest.save({ session });
      
      return res.status(400).json({
        success: false,
        message: 'Booking request has expired'
      });
    }

    // Get rider's cab
    const cab = await Cab.findOne({ 
      riderId, 
      cabType: booking.vehicleType,
      isApproved: true,
      isAvailable: true
    }).session(session);

    if (!cab) {
      return res.status(400).json({
        success: false,
        message: 'No available cab found for this vehicle type'
      });
    }

    // Check if rider is already on another trip
    const activeBooking = await Booking.findOne({
      riderId,
      bookingStatus: { $in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED'] }
    }).session(session);

    if (activeBooking) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active trip'
      });
    }

    // Update booking
    booking.riderId = riderId;
    booking.cabId = cab._id;
    booking.bookingStatus = 'DRIVER_ASSIGNED';
    booking.acceptedAt = new Date();
    booking.isBroadcastActive = false;
    await booking.save({ session });

    // Update booking request
    bookingRequest.status = 'ACCEPTED';
    bookingRequest.responseTime = new Date();
    await bookingRequest.save({ session });

    // Reject all other pending requests for this booking
    await BookingRequest.updateMany(
      {
        bookingId: id,
        riderId: { $ne: riderId },
        status: 'PENDING'
      },
      {
        status: 'REJECTED',
        responseTime: new Date()
      },
      { session }
    );

    // Update rider status
    await Rider.findByIdAndUpdate(
      riderId,
      {
        availabilityStatus: 'ON_TRIP',
        currentBooking: booking._id
      },
      { session }
    );

    // Update cab availability
    await Cab.findByIdAndUpdate(
      cab._id,
      { isAvailable: false },
      { session }
    );

    // Create notification for user
    const notification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'DRIVER_ASSIGNED',
      title: 'Driver Assigned',
      message: `Driver ${req.user.name} has been assigned to your booking`,
      data: {
        bookingId: booking._id,
        riderId,
        riderName: req.user.name
      }
    });
    await notification.save({ session });

    await session.commitTransaction();

    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      // Notify user
      io.to(`user-${booking.userId}`).emit('rider-assigned', {
        bookingId: booking._id,
        riderId,
        riderName: req.user.name,
        riderPhone: req.user.phone,
        cabDetails: cab
      });

      // Notify other riders that booking is taken
      booking.broadcastedTo.forEach(broadcastedRiderId => {
        if (broadcastedRiderId.toString() !== riderId.toString()) {
          io.to(`rider-${broadcastedRiderId}`).emit('booking-taken', {
            bookingId: booking._id
          });
        }
      });
    }

    res.json({
      success: true,
      message: 'Booking accepted successfully',
      data: {
        booking,
        cab
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Accept booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error accepting booking'
    });
  } finally {
    session.endSession();
  }
};

// @desc    Reject booking (by rider)
// @route   POST /api/bookings/:id/reject
// @access  Private (Rider)
export const rejectBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const riderId = req.user._id;

    const bookingRequest = await BookingRequest.findOne({
      bookingId: id,
      riderId,
      status: 'PENDING'
    }).session(session);

    if (!bookingRequest) {
      return res.status(404).json({
        success: false,
        message: 'No pending request found'
      });
    }

    bookingRequest.status = 'REJECTED';
    bookingRequest.responseTime = new Date();
    await bookingRequest.save({ session });

    // Increment rejected rides count for rider
    await Rider.findByIdAndUpdate(
      riderId,
      { $inc: { rejectedRides: 1 } },
      { session }
    );

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Booking rejected successfully'
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Reject booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting booking'
    });
  } finally {
    session.endSession();
  }
};

// @desc    Driver arrived at pickup location
// @route   POST /api/bookings/:id/driver-arrived
// @access  Private (Rider)
export const driverArrived = async (req, res) => {
  try {
    const { id } = req.params;
    const riderId = req.user._id;

    const booking = await Booking.findOne({
      _id: id,
      riderId,
      bookingStatus: 'DRIVER_ASSIGNED'
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or cannot be updated'
      });
    }

    booking.bookingStatus = 'DRIVER_ARRIVED';
    await booking.save();

    // Notify user
    const notification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'DRIVER_ARRIVED',
      title: 'Driver Arrived',
      message: 'Your driver has arrived at the pickup location',
      data: { bookingId: booking._id }
    });
    await notification.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${booking.userId}`).emit('trip-status-changed', {
        bookingId: booking._id,
        status: 'DRIVER_ARRIVED'
      });
    }

    res.json({
      success: true,
      message: 'Driver arrival confirmed',
      data: booking
    });
  } catch (error) {
    console.error('Driver arrived error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating booking status'
    });
  }
};

// @desc    Verify OTP and start trip
// @route   POST /api/bookings/:id/verify-otp
// @access  Private (Rider)
export const verifyOtpAndStartTrip = async (req, res) => {
  try {
    const { id } = req.params;
    const { otp } = req.body;
    const riderId = req.user._id;

    const booking = await Booking.findOne({
      _id: id,
      riderId,
      bookingStatus: 'DRIVER_ARRIVED'
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or cannot be started'
      });
    }

    // Verify OTP
    if (booking.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (new Date() > booking.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    booking.bookingStatus = 'TRIP_STARTED';
    booking.otpVerifiedAt = new Date();
    booking.rideStartTime = new Date();
    await booking.save();

    // Notify user
    const notification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'RIDE_STARTED',
      title: 'Trip Started',
      message: 'Your trip has started',
      data: { bookingId: booking._id }
    });
    await notification.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${booking.userId}`).emit('trip-status-changed', {
        bookingId: booking._id,
        status: 'TRIP_STARTED'
      });
    }

    res.json({
      success: true,
      message: 'Trip started successfully',
      data: booking
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting trip'
    });
  }
};

// @desc    Complete trip
// @route   POST /api/bookings/:id/complete
// @access  Private (Rider)
export const completeTrip = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { finalFare, actualDistanceKm } = req.body;
    const riderId = req.user._id;

    const booking = await Booking.findOne({
      _id: id,
      riderId,
      bookingStatus: 'TRIP_STARTED'
    }).session(session);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or cannot be completed'
      });
    }

    // Update booking
    booking.bookingStatus = 'TRIP_COMPLETED';
    booking.rideEndTime = new Date();
    
    if (finalFare) {
      booking.finalFare = finalFare;
    }
    
    if (actualDistanceKm) {
      booking.distanceKm = actualDistanceKm;
    }

    await booking.save({ session });

    // Update rider stats
    await Rider.findByIdAndUpdate(
      riderId,
      {
        $inc: { completedRides: 1 },
        availabilityStatus: 'AVAILABLE',
        currentBooking: null
      },
      { session }
    );

    // Update cab availability
    await Cab.findByIdAndUpdate(
      booking.cabId,
      { isAvailable: true },
      { session }
    );

    // For cash payments, mark as completed
    if (booking.paymentMethod === 'CASH') {
      await Payment.findOneAndUpdate(
        { bookingId: booking._id },
        {
          paymentStatus: 'SUCCESS',
          updatedAt: new Date()
        },
        { session }
      );
    }

    // Notify user
    const notification = new Notification({
      userId: booking.userId,
      bookingId: booking._id,
      type: 'RIDE_COMPLETED',
      title: 'Trip Completed',
      message: 'Your trip has been completed successfully',
      data: { 
        bookingId: booking._id,
        finalFare: finalFare || booking.estimatedFare
      }
    });
    await notification.save({ session });

    await session.commitTransaction();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${booking.userId}`).emit('trip-status-changed', {
        bookingId: booking._id,
        status: 'TRIP_COMPLETED',
        finalFare: finalFare || booking.estimatedFare
      });
    }

    res.json({
      success: true,
      message: 'Trip completed successfully',
      data: booking
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Complete trip error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing trip'
    });
  } finally {
    session.endSession();
  }
};

// @desc    Cancel booking
// @route   POST /api/bookings/:id/cancel
// @access  Private (User/Rider)
export const cancelBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;
    const userRole = req.user.role;

    const booking = await Booking.findById(id).session(session);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization
    if (userRole === 'USER' && booking.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking'
      });
    }

    if (userRole === 'RIDER' && booking.riderId?.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking'
      });
    }

    // Check if booking can be cancelled
    const cancellableStatuses = ['SCHEDULED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED'];
    if (!cancellableStatuses.includes(booking.bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Booking cannot be cancelled in ${booking.bookingStatus} status`
      });
    }

    // Calculate cancellation charge (if applicable)
    let cancellationCharge = 0;
    if (booking.bookingStatus === 'DRIVER_ASSIGNED' || booking.bookingStatus === 'DRIVER_ARRIVED') {
      // Apply cancellation fee if driver already assigned
      cancellationCharge = Math.min(50, booking.estimatedFare * 0.1); // ₹50 or 10% of fare
    }

    // Update booking
    booking.bookingStatus = 'CANCELLED';
    booking.cancelledBy = userRole;
    booking.cancellationReason = reason;
    booking.cancellationCharge = cancellationCharge;
    booking.isBroadcastActive = false;
    await booking.save({ session });

    // Update rider status if assigned
    if (booking.riderId) {
      await Rider.findByIdAndUpdate(
        booking.riderId,
        {
          availabilityStatus: 'AVAILABLE',
          currentBooking: null
        },
        { session }
      );

      // Update cab availability
      if (booking.cabId) {
        await Cab.findByIdAndUpdate(
          booking.cabId,
          { isAvailable: true },
          { session }
        );
      }
    }

    // Reject all pending requests
    await BookingRequest.updateMany(
      { bookingId: id, status: 'PENDING' },
      { status: 'CANCELLED', responseTime: new Date() },
      { session }
    );

    // Create notification
    const notification = new Notification({
      userId: booking.userId,
      riderId: booking.riderId,
      bookingId: booking._id,
      type: 'BOOKING_CANCELLED',
      title: 'Booking Cancelled',
      message: `Booking cancelled by ${userRole.toLowerCase()}. ${reason ? `Reason: ${reason}` : ''}`,
      data: { 
        bookingId: booking._id,
        cancelledBy: userRole,
        reason
      }
    });
    await notification.save({ session });

    await session.commitTransaction();

    // Emit socket events
    const io = req.app.get('io');
    if (io) {
      if (booking.userId) {
        io.to(`user-${booking.userId}`).emit('booking-cancelled', {
          bookingId: booking._id,
          cancelledBy: userRole,
          reason
        });
      }
      
      if (booking.riderId) {
        io.to(`rider-${booking.riderId}`).emit('booking-cancelled', {
          bookingId: booking._id,
          cancelledBy: userRole,
          reason
        });
      }
    }

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        bookingId: booking._id,
        cancellationCharge,
        refundAmount: cancellationCharge > 0 ? booking.estimatedFare - cancellationCharge : booking.estimatedFare
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling booking'
    });
  } finally {
    session.endSession();
  }
};

// @desc    Update live location of rider during trip
// @route   POST /api/bookings/:id/location
// @access  Private (Rider)
export const updateLiveLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const { lat, lng } = req.body;
    const riderId = req.user._id;

    const booking = await Booking.findOne({
      _id: id,
      riderId,
      bookingStatus: { $in: ['DRIVER_ARRIVED', 'TRIP_STARTED'] }
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Active booking not found'
      });
    }

    // Update rider's current location
    await Rider.findByIdAndUpdate(riderId, {
      currentLocation: {
        type: 'Point',
        coordinates: [lng, lat]
      }
    });

    // Emit location to user
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${booking.userId}`).emit('rider-location-update', {
        bookingId: booking._id,
        location: { lat, lng }
      });
    }

    res.json({
      success: true,
      message: 'Location updated'
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating location'
    });
  }
};

// @desc    Generate invoice for booking
// @route   GET /api/bookings/:id/invoice
// @access  Private
export const generateInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    const booking = await Booking.findById(id)
      .populate('userId', 'name email phone')
      .populate('riderId', 'name phone')
      .populate('cabId', 'cabNumber cabModel');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization
    if (userRole === 'USER' && booking.userId._id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this invoice'
      });
    }

    if (userRole === 'RIDER' && (!booking.riderId || booking.riderId._id.toString() !== userId.toString())) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this invoice'
      });
    }

    // Get payment details
    const payment = await Payment.findOne({ bookingId: id });

    // Generate invoice data
    const invoice = {
      invoiceNumber: `INV-${booking._id.toString().slice(-8).toUpperCase()}`,
      bookingId: booking._id,
      date: booking.createdAt,
      completedAt: booking.rideEndTime || booking.updatedAt,
      
      customer: {
        name: booking.userId.name,
        email: booking.userId.email,
        phone: booking.userId.phone
      },
      
      driver: booking.riderId ? {
        name: booking.riderId.name,
        phone: booking.riderId.phone,
        cabNumber: booking.cabId?.cabNumber,
        cabModel: booking.cabId?.cabModel
      } : null,
      
      trip: {
        pickup: booking.pickup.addressText,
        drop: booking.drop.addressText,
        distance: booking.distanceKm,
        vehicleType: booking.vehicleType,
        startTime: booking.rideStartTime,
        endTime: booking.rideEndTime,
        duration: booking.rideStartTime && booking.rideEndTime 
          ? Math.round((booking.rideEndTime - booking.rideStartTime) / 60000) 
          : null
      },
      
      fare: {
        baseFare: 0,
        distanceFare: 0,
        totalFare: booking.finalFare || booking.estimatedFare,
        cancellationCharge: booking.cancellationCharge || 0,
        discount: 0,
        tax: 0,
        grandTotal: (booking.finalFare || booking.estimatedFare) - (booking.cancellationCharge || 0)
      },
      
      payment: payment ? {
        method: payment.paymentMethod,
        status: payment.paymentStatus,
        transactionId: payment.razorpayPaymentId || payment._id,
        paidAt: payment.updatedAt
      } : null,
      
      status: booking.bookingStatus
    };

    res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error('Generate invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating invoice'
    });
  }
};

// Helper function to send booking confirmation email
const sendBookingConfirmationEmail = async (booking, user) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Booking Confirmed! 🎉</h2>
      <p>Dear ${user.name},</p>
      <p>Your cab booking has been confirmed. Here are your booking details:</p>
      
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Booking Details</h3>
        <p><strong>Booking ID:</strong> ${booking._id}</p>
        <p><strong>Pickup:</strong> ${booking.pickup.addressText}</p>
        <p><strong>Destination:</strong> ${booking.drop.addressText}</p>
        <p><strong>Distance:</strong> ${booking.distanceKm.toFixed(2)} km</p>
        <p><strong>Estimated Fare:</strong> ₹${booking.estimatedFare}</p>
        <p><strong>Vehicle Type:</strong> ${booking.vehicleType}</p>
        <p><strong>Booking Type:</strong> ${booking.bookingType}</p>
        ${booking.scheduledAt ? `<p><strong>Scheduled Time:</strong> ${new Date(booking.scheduledAt).toLocaleString()}</p>` : ''}
        <p><strong>OTP:</strong> <span style="font-size: 20px; font-weight: bold;">${booking.otp}</span></p>
        <p style="color: #666;">Share this OTP with your driver to start the trip</p>
      </div>
      
      <p>We'll notify you when a driver accepts your booking. Thank you for choosing our service!</p>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #999; font-size: 12px;">This is an automated message, please do not reply.</p>
    </div>
  `;

  return await sendEmail({
    to: user.email,
    subject: `Booking Confirmed - ${booking._id}`,
    html
  });
};
