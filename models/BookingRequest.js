import mongoose from "mongoose";

const bookingRequestSchema = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: true
  },

  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider",
    required: true
  },

  status: {
    type: String,
    enum: ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "TIMEOUT", "CANCELLED"],
    default: "PENDING"
  },

  responseTime: {
    type: Date,
    default: null
  },

  expiresAt: { 
    type: Date, 
    required: true,
    index: true 
  },

  // Add booking type to help with display
  bookingType: {
    type: String,
    enum: ["IMMEDIATE", "SCHEDULED"],
    default: "IMMEDIATE"
  },

  scheduledAt: {
    type: Date,
    default: null
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Compound index for faster queries
bookingRequestSchema.index({ bookingId: 1, riderId: 1 }, { unique: true });
bookingRequestSchema.index({ riderId: 1, createdAt: -1 });
bookingRequestSchema.index({ status: 1, expiresAt: 1 });
bookingRequestSchema.index({ bookingId: 1, status: 1 });
bookingRequestSchema.index({ expiresAt: 1 });
bookingRequestSchema.index({ status: 1, createdAt: -1 });
bookingRequestSchema.index({ bookingType: 1 }); // Add index for booking type

// Set default expiry
bookingRequestSchema.pre("validate", function (next) {
  if (!this.expiresAt) {
    // Default to 90 seconds for immediate, 30 minutes for scheduled
    const expiryTime = this.bookingType === 'SCHEDULED' ? 30 * 60 * 1000 : 90 * 1000;
    this.expiresAt = new Date(Date.now() + expiryTime);
  }
  next();
});

export default mongoose.model("BookingRequest", bookingRequestSchema);