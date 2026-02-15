import mongoose from "mongoose";

const riderEarningSchema = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking"
  },

  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider"
  },

  totalFare: Number,
  adminCommission: Number,
  riderEarning: Number,

  payoutStatus: {
    type: String,
    enum: ["PENDING", "PAID"],
    default: "PENDING"
  },

  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("RiderEarning", riderEarningSchema);
