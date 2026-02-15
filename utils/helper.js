// Helper functions for booking calculations

// Calculate distance between two coordinates using Haversine formula
export const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  // Return minimum 1km for very short distances
  return Math.max(distance, 1.0);
};

export const generateOTP = () => {
  // Generate 6-digit OTP (100000 to 999999)
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const calculateFare = (distance, vehicleType) => {
  const baseFares = {
    HATCHBACK: 50,
    SEDAN: 60,
    SUV: 80,
    PREMIUM: 100,
    LUXURY: 150
  };
  
  const perKmRates = {
    HATCHBACK: 10,
    SEDAN: 12,
    SUV: 15,
    PREMIUM: 20,
    LUXURY: 25
  };
  
  const baseFare = baseFares[vehicleType] || 60;
  const perKmRate = perKmRates[vehicleType] || 12;
  
  return Math.round(baseFare + (distance * perKmRate));
};