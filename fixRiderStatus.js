import mongoose from 'mongoose';
import Rider from './models/Rider.js';
import dotenv from 'dotenv';

dotenv.config();

const fixRiderAvailabilityStatus = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Update all riders with AVAILABLE status to ACTIVE
    const result = await Rider.updateMany(
      { availabilityStatus: 'AVAILABLE' },
      { $set: { availabilityStatus: 'ACTIVE' } }
    );

    console.log(`✅ Updated ${result.modifiedCount} riders with AVAILABLE status to ACTIVE`);

    // Also fix any other invalid enum values
    const invalidRiders = await Rider.find({
      availabilityStatus: { $nin: ['ACTIVE', 'INACTIVE', 'ON_TRIP'] }
    });

    if (invalidRiders.length > 0) {
      await Rider.updateMany(
        { availabilityStatus: { $nin: ['ACTIVE', 'INACTIVE', 'ON_TRIP'] } },
        { $set: { availabilityStatus: 'INACTIVE' } }
      );
      console.log(`✅ Fixed ${invalidRiders.length} riders with invalid availability status`);
    }

    console.log('✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  }
};

fixRiderAvailabilityStatus();