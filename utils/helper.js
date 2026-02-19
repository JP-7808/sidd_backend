// utils/helper.js
import { getDistanceMatrix } from './googleMapsHelper.js';

// Generate 6-digit OTP
export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Calculate fare based on distance and vehicle type
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

// Calculate distance using Google Maps (more accurate than Haversine)
export const calculateDistance = async (origin, destination) => {
  try {
    const result = await getDistanceMatrix(origin, destination);
    return result.distance.value; // Returns distance in kilometers
  } catch (error) {
    console.error('Error calculating distance with Google Maps:', error);
    // Fallback to Haversine formula if Google Maps fails
    return calculateHaversineDistance(origin, destination);
  }
};

// Fallback: Haversine formula for distance calculation
export const calculateHaversineDistance = (lat1, lng1, lat2, lng2) => {
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

// Format duration in minutes
export const formatDuration = (minutes) => {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours} hr ${mins} min`;
};