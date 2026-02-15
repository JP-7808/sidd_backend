import mongoose from "mongoose";

const riderWalletSchema = new mongoose.Schema({
  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider",
    unique: true
  },

  balance: {
    type: Number,
    default: 0
  },

  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model("RiderWallet", riderWalletSchema);
