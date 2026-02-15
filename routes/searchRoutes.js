import express from 'express';
import Rider from '../models/Rider.js';
import Cab from '../models/Cab.js';
import { authenticateOptional } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get nearby cabs (frontend compatibility)
router.get('/cabs/nearby', authenticateOptional, async (req, res) => {
  try {
    const { lat, lng, cabType, maxDistance = 10 } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Location coordinates are required'
      });
    }

    // For development - return mock data if no real data found
    let availableCabs = [];
    
    try {
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
            $maxDistance: maxDistance * 1000 // Convert km to meters
          }
        },
        approvalStatus: 'APPROVED'
      }).populate('currentBooking').limit(20);

      // Get cabs for these riders
      const riderIds = nearbyRiders.map(rider => rider._id);
      let cabQuery = { riderId: { $in: riderIds }, isApproved: true };
      
      if (cabType) {
        cabQuery.cabType = cabType;
      }

      const cabs = await Cab.find(cabQuery).populate('riderId', 'name phone rating totalRatings');

      availableCabs = cabs.map(cab => ({
        rider: {
          id: cab.riderId._id,
          name: cab.riderId.name,
          phone: cab.riderId.phone,
          rating: cab.riderId.rating || 4.5,
          totalRatings: cab.riderId.totalRatings || 100,
          distance: 0.5 // Calculate actual distance if needed
        },
        cab: {
          id: cab._id,
          type: cab.cabType,
          model: cab.cabModel,
          number: cab.cabNumber,
          seatingCapacity: cab.seatingCapacity,
          acAvailable: cab.acAvailable
        },
        estimatedArrival: Math.floor(Math.random() * 10) + 2 // 2-12 minutes
      }));
    } catch (dbError) {
      console.log('Database query failed, using mock data:', dbError.message);
    }

    // If no real cabs found, return mock data for development
    if (availableCabs.length === 0) {
      availableCabs = [
        {
          rider: {
            id: 'mock_rider_1',
            name: 'Raj Kumar',
            phone: '+91-9876543210',
            rating: 4.8,
            totalRatings: 150,
            distance: 0.5
          },
          cab: {
            id: 'mock_cab_1',
            type: cabType || 'SEDAN',
            model: 'Maruti Swift',
            number: 'MH 01 AB 1234',
            seatingCapacity: 4,
            acAvailable: true
          },
          estimatedArrival: 3
        },
        {
          rider: {
            id: 'mock_rider_2',
            name: 'Amit Singh',
            phone: '+91-9876543211',
            rating: 4.5,
            totalRatings: 89,
            distance: 1.2
          },
          cab: {
            id: 'mock_cab_2',
            type: cabType || 'HATCHBACK',
            model: 'Hyundai i20',
            number: 'MH 01 CD 5678',
            seatingCapacity: 4,
            acAvailable: true
          },
          estimatedArrival: 5
        },
        {
          rider: {
            id: 'mock_rider_3',
            name: 'Suresh Yadav',
            phone: '+91-9876543212',
            rating: 4.9,
            totalRatings: 200,
            distance: 0.8
          },
          cab: {
            id: 'mock_cab_3',
            type: cabType || 'SUV',
            model: 'Mahindra XUV300',
            number: 'MH 01 EF 9012',
            seatingCapacity: 6,
            acAvailable: true
          },
          estimatedArrival: 4
        }
      ];
    }

    res.status(200).json({
      success: true,
      data: {
        availableCabs,
        count: availableCabs.length
      }
    });
  } catch (error) {
    console.error('Get nearby cabs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby cabs',
      error: error.message
    });
  }
});

// Get available cab types
router.get('/cab-types', authenticateOptional, async (req, res) => {
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
          $maxDistance: 10000 // 10km
        }
      },
      approvalStatus: 'APPROVED'
    });

    const riderIds = nearbyRiders.map(rider => rider._id);
    const cabs = await Cab.find({
      riderId: { $in: riderIds },
      isApproved: true
    });

    // Group by cab type
    const cabTypes = {};
    cabs.forEach(cab => {
      if (!cabTypes[cab.cabType]) {
        cabTypes[cab.cabType] = {
          cabType: cab.cabType,
          count: 0,
          icon: cab.cabType === 'HATCHBACK' ? '🚘' :
                cab.cabType === 'SEDAN' ? '🚗' :
                cab.cabType === 'SUV' ? '🚙' : '🏎️'
        };
      }
      cabTypes[cab.cabType].count++;
    });

    res.status(200).json({
      success: true,
      data: {
        availableCabTypes: Object.values(cabTypes)
      }
    });
  } catch (error) {
    console.error('Get cab types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cab types'
    });
  }
});

export default router;