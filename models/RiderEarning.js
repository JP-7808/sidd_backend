// models/RiderEarning.js
import mongoose from "mongoose";

// DO NOT import Payment here - it causes circular dependency
// Instead, just define the schema

const riderEarningSchema = new mongoose.Schema({
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

  totalFare: {
    type: Number,
    required: true
  },
  
  adminCommission: {
    type: Number,
    required: true
  },
  
  riderEarning: {
    type: Number,
    required: true
  },

  payoutStatus: {
    type: String,
    enum: [
      "PENDING",
      "PENDING_SETTLEMENT",
      "PENDING_PAYOUT",
      "SETTLED",
      "PAID",
      "CANCELLED"
    ],
    default: "PENDING"
  },

  paymentMethod: {
    type: String,
    enum: ["CASH", "RAZORPAY", "ONLINE", "WALLET"],
    required: true
  },

  settlementDueDate: {
    type: Date,
    default: null
  },

  settledAt: {
    type: Date,
    default: null
  },

  paidAt: {
    type: Date,
    default: null
  },

  completedAt: {
    type: Date,
    default: Date.now
  },

  tripLeg: {
    type: String,
    enum: ["MAIN", "RETURN"],
    default: "MAIN"
  },

  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Check if model already exists before creating
const RiderEarning = mongoose.models.RiderEarning || mongoose.model("RiderEarning", riderEarningSchema);

export default RiderEarning;