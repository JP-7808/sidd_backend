import cron from 'node-cron';
import Booking from './models/Booking.js';
import { processScheduledBookings } from './controllers/bookingController.js';
import { cancelExpiredBroadcasts } from './utils/bookingUtils.js';

// Schedule job to process scheduled bookings every minute
cron.schedule('* * * * *', async () => {
  console.log('Checking for scheduled bookings...');
  await processScheduledBookings();
});

// Schedule job to cancel expired broadcasts every 30 seconds
cron.schedule('*/60 * * * * *', async () => {
  console.log('Checking for expired broadcasts...');
  await cancelExpiredBroadcasts();
});

// Schedule job to clean up old pending booking requests
cron.schedule('0 * * * *', async () => { // Every hour
  try {
    const BookingRequest = (await import('./models/BookingRequest.js')).default;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    await BookingRequest.deleteMany({
      status: 'PENDING',
      createdAt: { $lt: oneHourAgo }
    });
    
    console.log('Cleaned up old pending booking requests');
  } catch (error) {
    console.error('Error cleaning up booking requests:', error);
  }
});

export default cron;