// models/Payment.js
import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema({
  bookingId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Booking",
    required: true 
  },

  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: true 
  },

  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  paymentMethod: {
    type: String,
    enum: ["RAZORPAY", "CASH", "WALLET", "ONLINE"],
    required: true
  },

  paymentType: {
    type: String,
    enum: ["FULL", "PARTIAL", "ADVANCE"],
    required: true
  },

  paymentStatus: {
    type: String,
    enum: [
      "PENDING",
      "SUCCESS",
      "FAILED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "PENDING_SETTLEMENT",
      "SETTLED",
      "PENDING_PAYOUT"
    ],
    default: "PENDING"
  },

  currency: {
    type: String,
    default: "INR"
  },
  
  description: String,
  
  invoiceId: String,

  refundAmount: {
    type: Number,
    default: 0
  },
  
  refundReason: String,
  
  refundedAt: Date,

  settlementDueDate: Date,
  settledAt: Date,
  collectedBy: {
    type: String,
    enum: ["RIDER", "ADMIN", "SYSTEM"]
  },
  collectedById: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'collectedByModel'
  },
  collectedByModel: {
    type: String,
    enum: ["Rider", "User", "Admin"]
  },

  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
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

paymentSchema.index({ bookingId: 1 });
paymentSchema.index({ userId: 1 });
paymentSchema.index({ razorpayPaymentId: 1 });
paymentSchema.index({ paymentStatus: 1 });
paymentSchema.index({ settlementDueDate: 1 });

// Check if model already exists before creating
const Payment = mongoose.models.Payment || mongoose.model("Payment", paymentSchema);

export default Payment;