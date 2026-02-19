// utils/googleMapsHelper.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Geocode an address to get coordinates
 * @param {string} address - Full address string
 * @returns {Promise<Object>} Location data with coordinates and placeId
 */
export const geocodeAddress = async (address) => {
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address,
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK') {
      const result = response.data.results[0];
      const { lat, lng } = result.geometry.location;
      
      return {
        lat,
        lng,
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
        location: {
          type: 'Point',
          coordinates: [lng, lat] // GeoJSON format [longitude, latitude]
        }
      };
    } else {
      throw new Error(`Geocoding failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    throw error;
  }
};

/**
 * Reverse geocode coordinates to get address
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<Object>} Address details
 */
export const reverseGeocode = async (lat, lng) => {
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        latlng: `${lat},${lng}`,
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK') {
      const result = response.data.results[0];
      return {
        addressText: result.formatted_address,
        placeId: result.place_id,
        lat,
        lng
      };
    } else {
      throw new Error(`Reverse geocoding failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    throw error;
  }
};

/**
 * Calculate distance and duration between two points using Google Maps Distance Matrix API
 * @param {Object} origin - { lat, lng } or address string
 * @param {Object} destination - { lat, lng } or address string
 * @returns {Promise<Object>} Distance and duration
 */
export const getDistanceMatrix = async (origin, destination) => {
  try {
    const formatParam = (param) => {
      if (typeof param === 'string') return param;
      if (param.lat && param.lng) return `${param.lat},${param.lng}`;
      return `${param.lat},${param.lng}`;
    };

    const originStr = formatParam(origin);
    const destStr = formatParam(destination);

    const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
      params: {
        origins: originStr,
        destinations: destStr,
        key: GOOGLE_MAPS_API_KEY,
        units: 'metric'
      }
    });

    if (response.data.status === 'OK') {
      const element = response.data.rows[0].elements[0];
      
      if (element.status === 'OK') {
        return {
          distance: {
            text: element.distance.text,
            value: element.distance.value / 1000 // Convert meters to kilometers
          },
          duration: {
            text: element.duration.text,
            value: element.duration.value / 60 // Convert seconds to minutes
          }
        };
      } else {
        throw new Error(`Distance matrix element failed: ${element.status}`);
      }
    } else {
      throw new Error(`Distance matrix failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error('Distance matrix error:', error);
    throw error;
  }
};

/**
 * Get place details from Google Places API
 * @param {string} placeId - Google Maps Place ID
 * @returns {Promise<Object>} Place details
 */
export const getPlaceDetails = async (placeId) => {
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: {
        place_id: placeId,
        key: GOOGLE_MAPS_API_KEY,
        fields: 'formatted_address,geometry,name,address_component'
      }
    });

    if (response.data.status === 'OK') {
      const result = response.data.result;
      const { lat, lng } = result.geometry.location;
      
      return {
        name: result.name,
        formattedAddress: result.formatted_address,
        lat,
        lng,
        placeId,
        location: {
          type: 'Point',
          coordinates: [lng, lat]
        }
      };
    } else {
      throw new Error(`Place details failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error('Place details error:', error);
    throw error;
  }
};

/**
 * Autocomplete places (for frontend suggestions)
 * @param {string} input - Search input
 * @param {Object} options - Additional options like location bias
 * @returns {Promise<Array>} Place predictions
 */
export const autocompletePlaces = async (input, options = {}) => {
  try {
    const params = {
      input,
      key: GOOGLE_MAPS_API_KEY,
      ...options
    };

    const response = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', params);

    if (response.data.status === 'OK' || response.data.status === 'ZERO_RESULTS') {
      return response.data.predictions.map(prediction => ({
        placeId: prediction.place_id,
        description: prediction.description,
        mainText: prediction.structured_formatting.main_text,
        secondaryText: prediction.structured_formatting.secondary_text,
        types: prediction.types
      }));
    } else {
      throw new Error(`Autocomplete failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error('Autocomplete error:', error);
    throw error;
  }
};