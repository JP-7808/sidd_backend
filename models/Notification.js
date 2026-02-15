import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  
  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider"
  },
  
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking"
  },

  type: {
    type: String,
    enum: [
      "BOOKING_CREATED",
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVED',
      "BOOKING_ACCEPTED",
      'BOOKING_REJECTED',
      "BOOKING_CANCELLED",
      "RIDER_ASSIGNED",
      "RIDE_STARTED",
      "RIDE_COMPLETED",
      'RIDE_CANCELLED',
      "PAYMENT_SUCCESS",
      'PAYMENT_FAILED',
      "PROMOTIONAL",
      "RIDER_APPROVED"
    ],
    required: true
  },

  title: {
    type: String,
    required: true
  },
  
  message: {
    type: String,
    required: true
  },

  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  isRead: {
    type: Boolean,
    default: false
  },
  
  isEmailSent: {
    type: Boolean,
    default: false
  },
  
  isPushSent: {
    type: Boolean,
    default: false
  },

  emailSentAt: Date,
  
  pushSentAt: Date,

  createdAt: {
    type: Date,
    default: Date.now
  }
});

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ riderId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ bookingId: 1 });
notificationSchema.index({ isRead: 1 });
notificationSchema.index({ type: 1 });

export default mongoose.model("Notification", notificationSchema);