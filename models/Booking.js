import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
  // User Details
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: true 
  },
  
  riderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Rider" 
  },
  
  cabId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Cab" 
  },

   // Booking Type (IMMEDIATE or SCHEDULED)
  bookingType: {
    type: String,
    enum: ["IMMEDIATE", "SCHEDULED"],
    required: true,
    default: "IMMEDIATE"
  },

   // Scheduled booking details
  scheduledAt: {
    type: Date,
    required: function() { return this.bookingType === 'SCHEDULED'; }
  },

  // Pickup & Drop Details
  pickup: {
    addressText: String,
    contactName: String,
    contactPhone: String,
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: [0, 0]
      }
    },
    lat: { type: Number, default: 0 },
    lng: { type: Number, default: 0 },
    placeId: String // Add placeId for Google Maps
  },
  
  drop: {
    addressText: String,
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: [0, 0]
      }
    },
    lat: { type: Number, default: 0 },
    lng: { type: Number, default: 0 },
    placeId: String // Add placeId for Google Maps
  },

  // New Rapido-style Status Flow
  bookingStatus: {
    type: String,
    enum: [
      "INITIATED",
      "SCHEDULED",
      "SEARCHING_DRIVER", 
      "DRIVER_ASSIGNED",
      "DRIVER_ARRIVED",
      "TRIP_STARTED",
      "TRIP_COMPLETED",
      "PAYMENT_DONE",
      "CANCELLED",
      "EXPIRED",
      "NO_DRIVER_FOUND" 
    ],
    default: "INITIATED"
  },

  // Broadcast System
  broadcastedTo: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Rider" 
  }],
  broadcastExpiry: Date,
  isBroadcastActive: { 
    type: Boolean, 
    default: false 
  },

   // For scheduled bookings - when to start broadcasting
  broadcastStartTime: Date,

  // OTP System
  otp: { 
    type: String,
    index: true
  },
  otpVerifiedAt: Date,
  otpExpiresAt: Date,

  // Timing
  acceptedAt: Date,
  rideStartTime: Date,
  rideEndTime: Date,

  // Distance & Fare
  distanceKm: { type: Number, required: true, min: 0 },
  estimatedDuration: Number,
  estimatedFare: { type: Number, required: true, min: 0 },
  finalFare: Number,
  adminCommissionAmount: Number,
  riderEarning: Number,

  // Payment
  paymentMethod: {
    type: String,
    enum: ["CASH", "UPI", "CARD", "ONLINE"],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ["PENDING", "PAID", "FAILED"],
    default: "PENDING"
  },

  // Cancellation
  cancelledBy: { type: String, enum: ["USER", "RIDER", "SYSTEM"] },
  cancellationReason: String,
  cancellationCharge: { type: Number, default: 0 },

  // Vehicle Type
  vehicleType: {
    type: String,
    enum: ["HATCHBACK", "SEDAN", "SUV", "PREMIUM"],
    required: true
  },

  // Metadata
  userNotified: { type: Boolean, default: false },
  riderNotified: { type: Boolean, default: false },

  // Retry attempts for broadcasting
  broadcastRetryCount: { type: Number, default: 0 },
  lastBroadcastedAt: Date,

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }

}, { timestamps: true });

// Indexes
bookingSchema.index({ userId: 1 });
bookingSchema.index({ riderId: 1 });
bookingSchema.index({ bookingStatus: 1 });
bookingSchema.index({ broadcastExpiry: 1 });
bookingSchema.index({ "pickup.location.coordinates": "2dsphere" });
bookingSchema.index({ otp: 1 });
bookingSchema.index({ isBroadcastActive: 1, bookingStatus: 1 });

bookingSchema.index({ bookingType: 1, scheduledAt: 1, bookingStatus: 1 });
bookingSchema.index({ scheduledAt: 1, bookingStatus: 1 });
export default mongoose.model("Booking", bookingSchema);