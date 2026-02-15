import mongoose from "mongoose";

const userAddressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },

  label: {
    type: String,
    enum: ["HOME", "OFFICE", "OTHER"],
    default: "OTHER"
  },

  title: {
    type: String,
    required: true,
    trim: true
  },

  addressLine: {
    type: String,
    required: true,
    trim: true
  },
  
  landmark: String,
  
  city: {
    type: String,
    required: true
  },
  
  state: {
    type: String,
    required: true
  },
  
  pincode: {
    type: String,
    required: true
  },

  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number], // [lng, lat]
      index: "2dsphere"
    }
  },

  contactName: String,
  
  contactPhone: String,

  isDefault: { 
    type: Boolean, 
    default: false 
  },

  isActive: {
    type: Boolean,
    default: true
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

userAddressSchema.index({ userId: 1, isDefault: 1 });
userAddressSchema.index({ "location.coordinates": "2dsphere" });

export default mongoose.model("UserAddress", userAddressSchema);