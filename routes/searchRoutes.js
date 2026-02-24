import express from 'express';
import Rider from '../models/Rider.js';
import Cab from '../models/Cab.js';
import { authenticateOptional } from '../middleware/authMiddleware.js';

const router = express.Router();

// Search places (autocomplete)
router.get('/places', async (req, res) => {
  try {
    const { input, lat, lng } = req.query;
    
    if (!input) {
      return res.status(400).json({
        success: false,
        message: 'Search input is required'
      });
    }

    // Try to use Google Places Autocomplete API
    try {
      const axios = (await import('axios')).default;
      const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
      
      if (GOOGLE_MAPS_API_KEY) {
        const params = {
          input: input,
          key: GOOGLE_MAPS_API_KEY,
          types: 'address'
        };
        
        // Add location bias if coordinates provided
        if (lat && lng) {
          params.location = `${lat},${lng}`;
          params.radius = 50000; // 50km
        }

        const response = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
          params
        });

        if (response.data.status === 'OK' && response.data.predictions) {
          const predictions = response.data.predictions.map(prediction => ({
            place_id: prediction.place_id,
            description: prediction.description,
            structured_formatting: {
              main_text: prediction.structured_formatting?.main_text || prediction.description,
              secondary_text: prediction.structured_formatting?.secondary_text || ''
            },
            addressText: prediction.description
          }));

          return res.status(200).json({
            success: true,
            data: predictions
          });
        } else {
          console.log('Google Places API status:', response.data.status);
        }
      }
    } catch (googleError) {
      console.log('Google Places Autocomplete API failed:', googleError.message);
    }

    // Fallback - return empty array instead of mock data to force proper handling
    res.status(200).json({
      success: true,
      data: []
    });
  } catch (error) {
    console.error('Search places error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search places'
    });
  }
});

// Reverse geocode (get address from coordinates)
router.get('/reverse-geocode', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    // Try to get actual address from Google Maps API
    try {
      const axios = (await import('axios')).default;
      const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
      
      if (GOOGLE_MAPS_API_KEY) {
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
          params: {
            latlng: `${lat},${lng}`,
            key: GOOGLE_MAPS_API_KEY
          }
        });

        if (response.data.status === 'OK' && response.data.results[0]) {
          const result = response.data.results[0];
          
          // Extract address components
          let city = '', state = '', country = '', postalCode = '';
          result.address_components.forEach(component => {
            if (component.types.includes('locality')) city = component.long_name;
            else if (component.types.includes('administrative_area_level_2')) city = component.long_name;
            else if (component.types.includes('administrative_area_level_1')) state = component.long_name;
            else if (component.types.includes('country')) country = component.long_name;
            else if (component.types.includes('postal_code')) postalCode = component.long_name;
          });

          return res.status(200).json({
            success: true,
            data: {
              address: result.formatted_address,
              addressText: result.formatted_address,
              placeId: result.place_id,
              city: city || 'Unknown',
              state: state || 'Unknown',
              country: country || 'Unknown',
              postalCode: postalCode || '',
              latitude: parseFloat(lat),
              longitude: parseFloat(lng)
            }
          });
        }
      }
    } catch (googleError) {
      console.log('Google API failed, using mock data:', googleError.message);
    }

    // Fallback to mock address if Google API fails
    const mockAddress = {
      address: 'Current Location',
      addressText: 'Current Location',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      country: 'India',
      postalCode: '226001',
      latitude: parseFloat(lat),
      longitude: parseFloat(lng)
    };

    res.status(200).json({
      success: true,
      data: mockAddress
    });
  } catch (error) {
    console.error('Reverse geocode error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reverse geocode'
    });
  }
});

// Get place details
router.get('/place-details', async (req, res) => {
  try {
    const { placeId } = req.query;
    
    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: 'Place ID is required'
      });
    }

    // Try to get actual place details from Google Maps API
    try {
      const axios = (await import('axios')).default;
      const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
      
      if (GOOGLE_MAPS_API_KEY) {
        const response = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
          params: {
            place_id: placeId,
            key: GOOGLE_MAPS_API_KEY,
            fields: 'geometry,address_components,formatted_address'
          }
        });

        if (response.data.status === 'OK' && response.data.result) {
          const result = response.data.result;
          const location = result.geometry?.location;
          
          if (!location) {
            return res.status(400).json({
              success: false,
              message: 'Invalid place - no coordinates found'
            });
          }
          
          // Extract address components
          let city = '', state = '', country = '', postalCode = '';
          if (result.address_components) {
            result.address_components.forEach(component => {
              if (component.types.includes('locality')) city = component.long_name;
              else if (component.types.includes('administrative_area_level_2')) city = component.long_name;
              else if (component.types.includes('administrative_area_level_1')) state = component.long_name;
              else if (component.types.includes('country')) country = component.long_name;
              else if (component.types.includes('postal_code')) postalCode = component.long_name;
            });
          }

          return res.status(200).json({
            success: true,
            data: {
              place_id: result.place_id,
              address: result.formatted_address,
              addressText: result.formatted_address,
              lat: location.lat,
              lng: location.lng,
              city: city || 'Unknown',
              state: state || 'Unknown',
              country: country || 'Unknown',
              postalCode: postalCode || ''
            }
          });
        } else {
          console.log('Google Place Details API status:', response.data.status);
        }
      }
    } catch (googleError) {
      console.log('Google Place Details API failed:', googleError.message);
    }

    // If Google API fails, return error instead of mock data
    return res.status(400).json({
      success: false,
      message: 'Could not get place details. Please try again or select location from map.'
    });
  } catch (error) {
    console.error('Place details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get place details'
    });
  }
});

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