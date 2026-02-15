import express from 'express';
import Rider from '../models/Rider.js';
import Booking from '../models/Booking.js';
import mongoose from 'mongoose';

const router = express.Router();

// Test route to manually trigger booking notification
router.post('/trigger-booking', async (req, res) => {
  try {
    const io = req.app.get('io');
    
    if (!io) {
      return res.status(500).json({
        success: false,
        message: 'Socket.io not available'
      });
    }

    // Create a real test booking in database
    const testBooking = new Booking({
      userId: new mongoose.Types.ObjectId(),
      pickup: {
        addressText: 'Test Pickup Location',
        location: {
          type: 'Point',
          coordinates: [72.8777, 19.0760]
        },
        lat: 19.0760,
        lng: 72.8777
      },
      drop: {
        addressText: 'Test Drop Location',
        location: {
          type: 'Point', 
          coordinates: [72.8656, 19.0896]
        },
        lat: 19.0896,
        lng: 72.8656
      },
      vehicleType: 'SEDAN',
      paymentMethod: 'CASH',
      distanceKm: 2.5,
      estimatedFare: 150,
      bookingType: 'IMMEDIATE',
      bookingStatus: 'SEARCHING_DRIVER',
      otp: '1234',
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      broadcastExpiry: new Date(Date.now() + 30 * 1000),
      broadcastStartTime: new Date(),
      isBroadcastActive: true
    });

    await testBooking.save();

    // Get all online riders
    const onlineRiders = await Rider.find({ 
      isOnline: true,
      approvalStatus: 'APPROVED'
    });

    console.log('🧪 Found online riders for test:', onlineRiders.length);

    const testBookingData = {
      bookingId: testBooking._id,
      pickup: testBooking.pickup,
      drop: testBooking.drop,
      estimatedFare: testBooking.estimatedFare,
      distanceKm: testBooking.distanceKm,
      vehicleType: testBooking.vehicleType,
      userId: testBooking.userId,
      user: {
        name: 'Test Customer',
        phone: '+91 98765 43210'
      }
    };

    let notificationsSent = 0;

    // Send to all online riders
    onlineRiders.forEach(rider => {
      const roomName = `rider-${rider._id}`;
      
      console.log('🧪 Sending test booking to rider:', rider._id, 'in room:', roomName);
      
      // Method 1: Room-based
      io.to(roomName).emit('new-booking-request', testBookingData);
      
      // Method 2: Direct socket if available
      if (rider.socketId) {
        io.to(rider.socketId).emit('new-booking-request', testBookingData);
      }
      
      notificationsSent++;
    });

    // Method 3: Global broadcast
    io.emit('global-booking-request', testBookingData);
    
    // Method 4: Riders room broadcast
    io.to('riders').emit('new-booking-request', testBookingData);

    console.log('🧪 Test booking broadcasted to', notificationsSent, 'riders');

    res.json({
      success: true,
      message: `Test booking notification sent to ${notificationsSent} riders`,
      data: {
        bookingId: testBooking._id,
        onlineRiders: onlineRiders.length,
        notificationsSent,
        testBookingData
      }
    });

  } catch (error) {
    console.error('🧪 Test booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test booking',
      error: error.message
    });
  }
});

// Test route to check socket connections
router.get('/socket-status', (req, res) => {
  try {
    const io = req.app.get('io');
    const userSockets = req.app.get('userSockets');
    const riderSockets = req.app.get('riderSockets');

    if (!io) {
      return res.status(500).json({
        success: false,
        message: 'Socket.io not available'
      });
    }

    const connectedSockets = [];
    io.sockets.sockets.forEach((socket, id) => {
      connectedSockets.push({
        id,
        rooms: Array.from(socket.rooms)
      });
    });

    res.json({
      success: true,
      data: {
        totalConnections: io.sockets.sockets.size,
        userSockets: userSockets ? Object.fromEntries(userSockets) : {},
        riderSockets: riderSockets ? Object.fromEntries(riderSockets) : {},
        connectedSockets
      }
    });

  } catch (error) {
    console.error('Socket status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get socket status',
      error: error.message
    });
  }
});

export default router;