// Add this to bookingRoutes.js for debugging
export const debugBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    const booking = await Booking.findById(bookingId);
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