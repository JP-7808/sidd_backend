import mongoose from "mongoose";

const riderSchema = new mongoose.Schema({
  // Personal Details
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  
  phone: {
    type: String,
    required: true,
    unique: true
  },
  
  password: {
    type: String,
    required: true
  },

  phoneOTP: {
    type: String
  },
  phoneOTPExpires: {
    type: Date
  },

  photo: {
    type: String,
    required: true
  },

  // KYC Documents
  aadhaarNumber: {
    type: String,
    required: true,
    unique: true
  },
  
  aadhaarImage: {
    front: String,
    back: String
  },
  
  drivingLicenseNumber: {
    type: String,
    required: true,
    unique: true
  },
  
  drivingLicenseImage: {
    front: String,
    back: String
  },
  
  policeVerificationImage: String,

  // Home Address
  homeAddress: {
    addressLine: String,
    landmark: String,
    city: String,
    state: String,
    pincode: String,
    location: {
      lat: Number,
      lng: Number
    },
    isVerified: {
      type: Boolean,
      default: false
    }
  },

  isActive: {
    type: Boolean,
    default: true
  },

  isLocked: {
    type: Boolean,
    default: false
  },
  lockedUntil: Date,
  currentBooking: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Booking" 
  },

  rejectedRides: {
  type: Number,
  default: 0
},

  // Status Management
  approvalStatus: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"],
    default: "PENDING"
  },
  
  availabilityStatus: {
    type: String,
    enum: ["AVAILABLE", "ON_TRIP", "OFFLINE"],
    default: "OFFLINE"
  },

  // Add socketId for real-time communication
  socketId: String,

  isOnline: {
    type: Boolean,
    default: false
  },

  // Location Tracking
  currentLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    }
  },

  // Rating & Performance
  overallRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  
  totalRatings: {
    type: Number,
    default: 0
  },
  
  completedRides: {
    type: Number,
    default: 0
  },

  // Notifications
  notificationToken: {
    type: String,
    default: null
  },

  // Metadata
  rejectionReason: String,
  
  approvedAt: Date,
  
  lastLogin: Date,

  role: {
    type: String,
    enum: ['RIDER'],
    default: 'RIDER'
  },
  


  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  },
  tokenVersion: {
    type: Number,
    default: 0,
    select: false
  }
}, { timestamps: true });

riderSchema.index({ email: 1 });
riderSchema.index({ phone: 1 });
riderSchema.index({ currentLocation: "2dsphere" });
riderSchema.index({ approvalStatus: 1, availabilityStatus: 1, isOnline: 1 });
riderSchema.index({ isOnline: 1, availabilityStatus: 1 });
riderSchema.index({ isLocked: 1, lockedUntil: 1 });

export default mongoose.model("Rider", riderSchema);