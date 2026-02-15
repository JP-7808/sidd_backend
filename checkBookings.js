import mongoose from 'mongoose';
import Booking from './models/Booking.js';

mongoose.connect('mongodb://localhost:27017/tour_travel');

const checkActiveBookings = async () => {
  try {
    const activeBookings = await Booking.find({
      bookingStatus: { $in: ['ACCEPTED', 'ONGOING'] }
    });
    
    console.log('Active bookings found:', activeBookings.length);
    activeBookings.forEach(booking => {
      console.log(`ID: ${booking._id}, Status: ${booking.bookingStatus}, Rider: ${booking.riderId}`);
    });
    
    // Also check all bookings to see the current state
    const allBookings = await Booking.find({}).sort({ createdAt: -1 }).limit(10);
    console.log('\nRecent bookings:');
    allBookings.forEach(booking => {
      console.log(`ID: ${booking._id}, Status: ${booking.bookingStatus}, Rider: ${booking.riderId || 'None'}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

checkActiveBookings();