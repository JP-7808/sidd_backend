import mongoose from "mongoose";

const pricingSchema = new mongoose.Schema({
  cabType: {
    type: String,
    enum: ["HATCHBACK", "SEDAN", "SUV", "PREMIUM", "LUXURY"],
    required: true,
    unique: true
  },

  pricePerKm: {
    type: Number,
    required: true,
    min: 0
  },
  
  baseFare: {
    type: Number,
    required: true,
    min: 0
  },

  adminCommissionPercent: {
    type: Number,
    default: 20,
    min: 0,
    max: 100
  },

  isActive: {
    type: Boolean,
    default: true
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model("Pricing", pricingSchema);
