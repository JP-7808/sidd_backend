import Rider from '../models/Rider.js';
import Cab from '../models/Cab.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Pricing from '../models/Pricing.js'; // ADD THIS IMPORT
import UserAddress from '../models/UserAddress.js'; // ADD THIS IMPORT

// Helper function: Calculate distance between two coordinates
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
  return distance;
};

const deg2rad = (deg) => {
  return deg * (Math.PI/180);
};

// Search nearby cabs
export const searchNearbyCabs = async (req, res) => {
  try {
    const { lat, lng, cabType, maxDistance = 50 } = req.query;

    console.log('🔍 Search nearby cabs called:', { lat, lng, cabType, maxDistance });

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Location coordinates are required'
      });
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    
    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates provided'
      });
    }

    // SIMPLE QUERY - Get all approved and available cabs
    let cabs = await Cab.find({
      isApproved: true,
      isAvailable: true
    })
    .select('cabType cabModel cabNumber seatingCapacity acAvailable riderId')
    .limit(50);

    console.log(`🚗 Found ${cabs.length} total cabs in database`);

    // Get rider details for each cab
    const riderIds = cabs.map(c => c.riderId);
    const riders = await Rider.find({ _id: { $in: riderIds } })
      .select('name photo currentLocation overallRating totalRatings completedRides');

    // Combine rider and cab data
    const riderMap = {};
    riders.forEach(r => {
      riderMap[r._id.toString()] = r;
    });

    const availableCabs = cabs.map(cab => {
      const rider = riderMap[cab.riderId?.toString()];
      if (!rider) return null;

      // Calculate distance
      let distance = 0;
      if (rider.currentLocation && 
          rider.currentLocation.coordinates && 
          rider.currentLocation.coordinates.length >= 2) {
        const riderLng = rider.currentLocation.coordinates[0];
        const riderLat = rider.currentLocation.coordinates[1];
        
        if (!isNaN(riderLat) && !isNaN(riderLng)) {
          distance = calculateDistance(
            parsedLat,
            parsedLng,
            riderLat,
            riderLng
          );
        }
      }

      return {
        rider: {
          id: rider._id,
          name: rider.name,
          photo: rider.photo,
          rating: rider.overallRating || 0,
          totalRatings: rider.totalRatings || 0,
          completedRides: rider.completedRides || 0,
          distance: parseFloat(distance.toFixed(2))
        },
        cab: {
          id: cab._id,
          type: cab.cabType,
          model: cab.cabModel,
          number: cab.cabNumber,
          seatingCapacity: cab.seatingCapacity,
          acAvailable: cab.acAvailable
        },
        estimatedArrival: Math.max(3, Math.round((distance / 30) * 60))
      };
    }).filter(cab => cab !== null);

    // Sort by distance
    availableCabs.sort((a, b) => a.rider.distance - b.rider.distance);

    // Group by cab type
    const byCabType = availableCabs.reduce((acc, cab) => {
      const type = cab.cab.type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(cab);
      return acc;
    }, {});

    console.log(`✅ Available cabs: ${availableCabs.length}`);

    res.status(200).json({
      success: true,
      data: {
        availableCabs,
        byCabType,
        total: availableCabs.length,
        counts: Object.keys(byCabType).reduce((acc, type) => {
          acc[type] = byCabType[type].length;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('❌ Search nearby cabs error:', error);
    console.error('🔍 Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to search nearby cabs',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Search booking history (no changes needed)
export const searchBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      query,
      status,
      tripType,
      bookingType,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const searchQuery = { userId };

    // Text search
    if (query) {
      searchQuery.$or = [
        { 'pickup.addressText': { $regex: query, $options: 'i' } },
        { 'drop.addressText': { $regex: query, $options: 'i' } }
      ];
    }

    // Filters
    if (status) searchQuery.bookingStatus = status;
    if (tripType) searchQuery.tripType = tripType;
    if (bookingType) searchQuery.bookingType = bookingType;
    
    if (startDate && endDate) {
      searchQuery.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const bookings = await Booking.find(searchQuery)
      .populate('riderId', 'name photo')
      .populate('cabId', 'cabType cabNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      data: {
        bookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Search bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search bookings'
    });
  }
};

// Search users (admin only) - no changes needed
export const searchUsers = async (req, res) => {
  try {
    const {
      query,
      role,
      isActive,
      isEmailVerified,
      page = 1,
      limit = 20
    } = req.query;

    const searchQuery = {};

    // Text search
    if (query) {
      searchQuery.$or = [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
        { phone: { $regex: query, $options: 'i' } }
      ];
    }

    // Filters
    if (role) searchQuery.role = role;
    if (isActive !== undefined) searchQuery.isActive = isActive === 'true';
    if (isEmailVerified !== undefined) searchQuery.isEmailVerified = isEmailVerified === 'true';

    const users = await User.find(searchQuery)
      .select('-password -otp -otpExpires -tokenVersion')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users'
    });
  }
};

// Search riders (admin only) - no changes needed
export const searchRiders = async (req, res) => {
  try {
    const {
      query,
      approvalStatus,
      availabilityStatus,
      isOnline,
      page = 1,
      limit = 20
    } = req.query;

    const searchQuery = {};

    // Text search
    if (query) {
      searchQuery.$or = [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
        { phone: { $regex: query, $options: 'i' } },
        { aadhaarNumber: { $regex: query, $options: 'i' } },
        { drivingLicenseNumber: { $regex: query, $options: 'i' } }
      ];
    }

    // Filters
    if (approvalStatus) searchQuery.approvalStatus = approvalStatus;
    if (availabilityStatus) searchQuery.availabilityStatus = availabilityStatus;
    if (isOnline !== undefined) searchQuery.isOnline = isOnline === 'true';

    const riders = await Rider.find(searchQuery)
      .select('-password -tokenVersion')
      .populate({
        path: 'cab',
        model: 'Cab'
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Rider.countDocuments(searchQuery);

    res.status(200).json({
      success: true,
      data: {
        riders,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Search riders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search riders'
    });
  }
};

// Autocomplete addresses - no changes needed
export const autocompleteAddress = async (req, res) => {
  try {
    const { query, userId } = req.query;
    
    if (!query || query.length < 2) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    // Search in user's saved addresses
    const userAddresses = userId ? await UserAddress.find({
      userId,
      $or: [
        { addressLine: { $regex: query, $options: 'i' } },
        { landmark: { $regex: query, $options: 'i' } },
        { city: { $regex: query, $options: 'i' } },
        { title: { $regex: query, $options: 'i' } }
      ],
      isActive: true
    }).limit(10) : [];

    // Format results
    const results = userAddresses.map(address => ({
      type: 'SAVED_ADDRESS',
      id: address._id,
      address: address.addressLine,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      location: address.location,
      label: address.label,
      title: address.title
    }));

    // Here you would typically integrate with Google Places API
    // For now, return only saved addresses
    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Autocomplete address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to autocomplete address'
    });
  }
};

// Search available cab types - FIXED
export const searchCabTypes = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Location coordinates are required'
      });
    }

    console.log('🔍 Search cab types called:', { lat, lng });

    // Parse coordinates
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    // Find nearby riders
    let nearbyRiders = [];
    
    try {
      nearbyRiders = await Rider.find({
        isOnline: true,
        isLocked: false,
        approvalStatus: 'APPROVED',
        currentLocation: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [parsedLng, parsedLat]
            },
            $maxDistance: 10 * 1000 // 10km radius
          }
        }
      }).select('_id');
    } catch (geoError) {
      console.warn('⚠️ Cab types geo query failed:', geoError.message);
      // Fallback to simple query
      nearbyRiders = await Rider.find({
        isOnline: true,
        isLocked: false,
        approvalStatus: 'APPROVED'
      }).select('_id').limit(20);
    }

    const riderIds = nearbyRiders.map(r => r._id);
    
    console.log(`👥 Found ${riderIds.length} riders for cab types`);

    // Get available cab types from these riders
    const cabTypes = await Cab.aggregate([
      {
        $match: {
          riderId: { $in: riderIds },
          approvalStatus: 'APPROVED', // CORRECTED: was isApproved: true
        }
      },
      {
        $group: {
          _id: "$cabType",
          count: { $sum: 1 },
          minSeating: { $min: "$seatingCapacity" },
          maxSeating: { $max: "$seatingCapacity" }
        }
      },
      {
        $project: {
          cabType: "$_id",
          count: 1,
          seatingRange: {
            min: "$minSeating",
            max: "$maxSeating"
          },
          _id: 0
        }
      },
      { $sort: { cabType: 1 } }
    ]);

    console.log(`🚗 Found ${cabTypes.length} cab types`);

    // Get pricing for each cab type
    let pricing = [];
    try {
      pricing = await Pricing.find({});
    } catch (pricingError) {
      console.warn('⚠️ Pricing not available:', pricingError.message);
    }

    // Combine cab types with pricing
    const availableCabTypes = cabTypes.map(cabType => {
      const priceInfo = pricing.find(p => p.cabType === cabType.cabType);
      return {
        ...cabType,
        pricing: priceInfo || null,
        estimatedWaitTime: Math.round((cabType.count > 0 ? 5 : 15) + Math.random() * 10) // minutes
      };
    });

    res.status(200).json({
      success: true,
      data: {
        availableCabTypes,
        totalAvailable: cabTypes.reduce((sum, type) => sum + type.count, 0)
      }
    });
  } catch (error) {
    console.error('❌ Search cab types error:', error);
    console.error('🔍 Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to search cab types'
    });
  }
};