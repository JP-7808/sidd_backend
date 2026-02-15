// Add this to bookingRoutes.js for testing
export const testBroadcast = async (req, res) => {
  try {
    const io = req.app.get('io');
    
    if (!io) {
      return res.status(500).json({
        success: false,
        message: 'Socket.io not available'
      });
    }

    const testBooking = {
      bookingId: 'test-' + Date.now(),
      pickup: {
        addressText: 'Test Pickup Location',
        lat: 19.0760,
        lng: 72.8777
      },
      drop: {
        addressText: 'Test Drop Location',
        lat: 19.0860,
        lng: 72.8877
      },
      estimatedFare: 150,
      distanceKm: 5.2,
      vehicleType: 'SEDAN',
      user: {
        name: 'Test Customer',
        phone: '+91 98765 43210'
      }
    };

    console.log('🧪 Broadcasting test booking to all riders...');
    
    // Broadcast to all connected sockets
    io.emit('global-booking-request', testBooking);
    
    // Also try specific rider rooms
    const Rider = (await import('../models/Rider.js')).default;
    const onlineRiders = await Rider.find({ isOnline: true }).limit(10);
    
    onlineRiders.forEach(rider => {
      io.to(`rider-${rider._id}`).emit('new-booking-request', testBooking);
      console.log(`📡 Sent to rider-${rider._id}`);
    });

    res.json({
      success: true,
      message: `Test booking broadcasted to ${onlineRiders.length} riders + global`,
      data: testBooking
    });

  } catch (error) {
    console.error('Test broadcast error:', error);
    res.status(500).json({
      success: false,
      message: 'Test broadcast failed'
    });
  }
};