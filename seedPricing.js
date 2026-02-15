import mongoose from 'mongoose';
import Pricing from './models/Pricing.js';
import dotenv from 'dotenv';

dotenv.config();

const seedPricing = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing pricing
    await Pricing.deleteMany({});

    // Create default pricing
    const pricingData = [
      {
        cabType: 'HATCHBACK',
        baseFare: 50,
        pricePerKm: 8,
        adminCommissionPercent: 15
      },
      {
        cabType: 'SEDAN',
        baseFare: 80,
        pricePerKm: 12,
        adminCommissionPercent: 18
      },
      {
        cabType: 'SUV',
        baseFare: 120,
        pricePerKm: 18,
        adminCommissionPercent: 20
      }
    ];

    await Pricing.insertMany(pricingData);
    console.log('✅ Pricing data seeded successfully');

    process.exit(0);
  } catch (error) {
    console.error('❌ Pricing seed error:', error);
    process.exit(1);
  }
};

seedPricing();