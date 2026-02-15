import mongoose from "mongoose";

const cabSchema = new mongoose.Schema({
  riderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Rider",
    required: true 
  },

  cabType: {
    type: String,
    enum: ["HATCHBACK", "SEDAN", "SUV", "PREMIUM"],
    required: true
  },

  cabNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  
  cabModel: {
    type: String,
    required: true
  },
  
  images: [
    {
      url: {
        type: String,
        required: true
      },
      type: {
        type: String,
        enum: ["FRONT", "BACK", "SIDE", "INTERIOR", "OTHER"],
        default: "OTHER"
      }
    }
  ],
  
  // Documents
  rcImage: {
    front: String,
    back: String
  },
  
  insuranceImage: {
    front: String,
    back: String
  },
  
  permitImage: String,
  
  fitnessImage: String,

  // Vehicle Details
  yearOfManufacture: Number,
  
  seatingCapacity: {
    type: Number,
    required: true,
    min: 2,
    max: 8
  },

  // Status
  isApproved: { 
    type: Boolean, 
    default: false 
  },
  
  isAvailable: { 
    type: Boolean, 
    default: true 
  },

  // Air Conditioning
  acAvailable: {
    type: Boolean,
    default: true
  },

  // Metadata
  approvalStatus: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED"],
    default: "PENDING"
  },
  
  rejectionReason: String,
  
  approvedAt: Date,

  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

cabSchema.index({ riderId: 1 });
cabSchema.index({ cabNumber: 1 });
cabSchema.index({ isApproved: 1, isAvailable: 1 });

export default mongoose.model("Cab", cabSchema);