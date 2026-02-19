// routes/pricingRoutes.js (create this file if it doesn't exist)
import express from 'express';
import Pricing from '../models/Pricing.js';

const router = express.Router();

// @desc    Get all vehicle types with pricing
// @route   GET /api/pricing/vehicle-types
// @access  Public
router.get('/vehicle-types', async (req, res) => {
  try {
    const pricing = await Pricing.find({ isActive: true });
    
    // Format the response
    const vehiclePricing = {};
    pricing.forEach(item => {
      vehiclePricing[item.cabType] = {
        baseFare: item.baseFare,
        pricePerKm: item.pricePerKm,
        adminCommissionPercent: item.adminCommissionPercent
      };
    });
    
    res.json({
      success: true,
      data: vehiclePricing
    });
  } catch (error) {
    console.error('Get vehicle pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicle pricing'
    });
  }
});

export default router;