// In-memory mock riders with locations
export const mockRiders = [
  {
    _id: '507f1f77bcf86cd799439012',
    name: 'Rajesh Kumar',
    phone: '9876543210',
    rating: 4.5,
    vehicleNumber: 'KA01AB1234',
    vehicleModel: 'Maruti Swift',
    vehicleType: 'HATCHBACK',
    isOnline: true,
    isAvailable: true,
    currentLocation: {
      lat: 28.6139,
      lng: 77.2090
    }
  },
  {
    _id: '507f1f77bcf86cd799439013',
    name: 'Amit Singh',
    phone: '9876543211',
    rating: 4.2,
    vehicleNumber: 'KA02CD5678',
    vehicleModel: 'Honda City',
    vehicleType: 'SEDAN',
    isOnline: true,
    isAvailable: true,
    currentLocation: {
      lat: 28.7041,
      lng: 77.1025
    }
  },
  {
    _id: '507f1f77bcf86cd799439014',
    name: 'Priya Sharma',
    phone: '9876543212',
    rating: 4.8,
    vehicleNumber: 'KA03EF9012',
    vehicleModel: 'Mahindra XUV500',
    vehicleType: 'SUV',
    isOnline: true,
    isAvailable: true,
    currentLocation: {
      lat: 19.0760,
      lng: 72.8777
    }
  },
  {
    _id: '507f1f77bcf86cd799439015',
    name: 'Suresh Reddy',
    phone: '9876543213',
    rating: 4.6,
    vehicleNumber: 'KA04GH3456',
    vehicleModel: 'Toyota Innova',
    vehicleType: 'SUV',
    isOnline: true,
    isAvailable: true,
    currentLocation: {
      lat: 12.9716,
      lng: 77.5946
    }
  },
  {
    _id: '507f1f77bcf86cd799439016',
    name: 'Deepak Joshi',
    phone: '9876543214',
    rating: 4.3,
    vehicleNumber: 'KA05IJ7890',
    vehicleModel: 'Hyundai i20',
    vehicleType: 'HATCHBACK',
    isOnline: true,
    isAvailable: true,
    currentLocation: {
      lat: 22.5726,
      lng: 88.3639
    }
  }
];

// Function to calculate distance between two points
export const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Find nearby riders
export const findNearbyRiders = (userLat, userLng, vehicleType = null, maxDistance = 5) => {
  return mockRiders.filter(rider => {
    if (!rider.isOnline || !rider.isAvailable) return false;
    
    const distance = calculateDistance(userLat, userLng, rider.currentLocation.lat, rider.currentLocation.lng);
    
    if (distance > maxDistance) return false;
    
    if (vehicleType && rider.vehicleType !== vehicleType) return false;
    
    return true;
  }).map(rider => ({
    ...rider,
    distance: calculateDistance(userLat, userLng, rider.currentLocation.lat, rider.currentLocation.lng)
  })).sort((a, b) => a.distance - b.distance);
};

// Get rider by ID
export const getRiderById = (riderId) => {
  return mockRiders.find(rider => rider._id === riderId);
};

// Update rider availability
export const updateRiderAvailability = (riderId, isAvailable) => {
  const rider = mockRiders.find(r => r._id === riderId);
  if (rider) {
    rider.isAvailable = isAvailable;
  }
};