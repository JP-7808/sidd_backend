import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Pricing from './models/Pricing.js';

dotenv.config();

const defaultPricing = [
  {
    cabType: 'HATCHBACK',
    baseFare: 50,
    pricePerKm: 10,
    adminCommissionPercent: 20
  },
  {
    cabType: 'SEDAN',
    baseFare: 60,
    pricePerKm: 12,
    adminCommissionPercent: 20
  },
  {
    cabType: 'SUV',
    baseFare: 80,
    pricePerKm: 15,
    adminCommissionPercent: 20
  },
  {
    cabType: 'PREMIUM',
    baseFare: 100,
    pricePerKm: 20,
    adminCommissionPercent: 20
  },
  {
    cabType: 'LUXURY',
    baseFare: 150,
    pricePerKm: 25,
    adminCommissionPercent: 20
  }
];

const seedPricing = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing pricing
    await Pricing.deleteMany({});
    console.log('Cleared existing pricing data');

    // Insert default pricing
    await Pricing.insertMany(defaultPricing);
    console.log('✅ Default pricing data seeded successfully');

    // Display seeded data
    const pricing = await Pricing.find({});
    console.log('\n📋 Seeded Pricing Data:');
    pricing.forEach(p => {
      console.log(`${p.cabType}: Base ₹${p.baseFare}, Per KM ₹${p.pricePerKm}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding pricing data:', error);
    process.exit(1);
  }
};

seedPricing();