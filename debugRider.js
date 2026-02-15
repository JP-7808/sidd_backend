// Debug function to check rider status
export const debugRiderStatus = async (req, res) => {
  try {
    const riderId = req.user._id;
    
    const rider = await Rider.findById(riderId);
    const cab = await Cab.findOne({ riderId, isApproved: true });
    
    const status = {
      rider: {
        id: riderId,
        name: rider.name,
        isOnline: rider.isOnline,
        availabilityStatus: rider.availabilityStatus,
        approvalStatus: rider.approvalStatus
      },
      cab: cab ? {
        cabType: cab.cabType,
        isApproved: cab.isApproved
      } : null,
      canSeeBookings: rider.isOnline && rider.availabilityStatus === 'AVAILABLE' && rider.approvalStatus === 'APPROVED' && cab?.isApproved
    };
    
    res.json({
      success: true,
      data: status,
      message: status.canSeeBookings ? 'Rider can see bookings' : 'Rider cannot see bookings'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};