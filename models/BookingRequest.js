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
    enum: ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED","TIMEOUT","CANCELLED"],
    default: "PENDING"
  },

 responseTime: {
      type: Date,
      default: null
    },

  expiresAt: { 
    type: Date, 
    required: true,
    default: () => new Date(Date.now() + 90 * 1000),
    index: true 
  },

  createdAt: { type: Date, default: Date.now }
});

// Compound index for faster queries
bookingRequestSchema.index({ bookingId: 1, riderId: 1 }, { unique: true });
bookingRequestSchema.index({ riderId: 1, createdAt: -1 });
bookingRequestSchema.index({ status: 1, expiresAt: 1 });
bookingRequestSchema.index({ bookingId: 1, status: 1 });
bookingRequestSchema.index({ expiresAt: 1 });
bookingRequestSchema.index({ status: 1, createdAt: -1 });

// This runs even when old documents are saved
bookingRequestSchema.pre("validate", function (next) {
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  next();
});
export default mongoose.model("BookingRequest", bookingRequestSchema);
