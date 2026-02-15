import mongoose from 'mongoose';
import Booking from './models/Booking.js';
import Rider from './models/Rider.js';

mongoose.connect('mongodb://localhost:27017/tour_travel');

const clearStaleBookings = async () => {
  try {
    // Get all riders
    const riders = await Rider.find({});
    console.log('Found riders:', riders.length);
    
    for (const rider of riders) {
      console.log(`\nChecking rider: ${rider.name} (${rider._id})`);
      
      // Find active bookings for this rider
      const activeBookings = await Booking.find({
        riderId: rider._id,
        bookingStatus: { $in: ['ACCEPTED', 'ONGOING'] }
      });
      
      console.log(`Active bookings: ${activeBookings.length}`);
      
      if (activeBookings.length > 0) {
        console.log('Active bookings found:');
        activeBookings.forEach(booking => {
          console.log(`- ${booking._id}: ${booking.bookingStatus}`);
        });
        
        // Uncomment the next lines to clear stale bookings
        // await Booking.updateMany(
        //   { riderId: rider._id, bookingStatus: { $in: ['ACCEPTED', 'ONGOING'] } },
        //   { bookingStatus: 'CANCELLED' }
        // );
        // console.log('Cleared stale bookings');
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

clearStaleBookings();