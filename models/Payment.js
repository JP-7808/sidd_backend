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

  // Razorpay
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
    enum: ["RAZORPAY", "CASH", "WALLET"],
    required: true
  },

  paymentType: {
    type: String,
    enum: ["FULL", "PARTIAL", "ADVANCE"],
    required: true
  },

  paymentStatus: {
    type: String,
    enum: ["PENDING", "SUCCESS", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"],
    default: "PENDING"
  },

  // Payment Details
  currency: {
    type: String,
    default: "INR"
  },
  
  description: String,
  
  invoiceId: String,

  // Refunds
  refundAmount: {
    type: Number,
    default: 0
  },
  
  refundReason: String,
  
  refundedAt: Date,

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

export default mongoose.model("Payment", paymentSchema);