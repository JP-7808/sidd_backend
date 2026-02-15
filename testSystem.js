import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './models/Booking.js';
import Rider from './models/Rider.js';
import Cab from './models/Cab.js';

dotenv.config();

const testBookingSystem = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check for available riders
    const availableRiders = await Rider.find({
      isOnline: true,
      availabilityStatus: 'AVAILABLE',
      approvalStatus: 'APPROVED'
    });

    console.log(`\n📊 System Status:`);
    console.log(`Available Riders: ${availableRiders.length}`);

    if (availableRiders.length > 0) {
      console.log('\n🚗 Available Riders:');
      for (let i = 0; i < availableRiders.length; i++) {
        const rider = availableRiders[i];
        const cab = await Cab.findOne({ riderId: rider._id, isApproved: true });
        console.log(`${i + 1}. ${rider.name} - ${cab?.cabType || 'No Approved Cab'} - Online: ${rider.isOnline}`);
      }
    }

    // Check for active bookings
    const activeBookings = await Booking.find({
      bookingStatus: { $in: ['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'TRIP_STARTED'] }
    }).populate('userId', 'name').populate('riderId', 'name');

    console.log(`\n📋 Active Bookings: ${activeBookings.length}`);
    
    if (activeBookings.length > 0) {
      console.log('\n🎯 Active Bookings:');
      activeBookings.forEach((booking, index) => {
        console.log(`${index + 1}. ${booking.bookingStatus} - User: ${booking.userId?.name || 'Unknown'} - Rider: ${booking.riderId?.name || 'Unassigned'}`);
      });
    }

    // Check cabs by type
    const cabsByType = await Cab.aggregate([
      { $match: { isApproved: true } },
      { $group: { _id: '$cabType', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    console.log('\n🚙 Approved Cabs by Type:');
    cabsByType.forEach(cab => {
      console.log(`${cab._id}: ${cab.count} cabs`);
    });

    console.log('\n✅ System check completed!');
    console.log('\n💡 Tips:');
    console.log('- Make sure riders are online and approved');
    console.log('- Ensure cabs are approved and match vehicle types');
    console.log('- Check that pricing data exists for all vehicle types');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

testBookingSystem();