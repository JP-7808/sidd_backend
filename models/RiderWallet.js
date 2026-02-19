// models/RiderWallet.js
import mongoose from "mongoose";

const riderWalletSchema = new mongoose.Schema({
  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider",
    unique: true,
    required: true
  },

  balance: {
    type: Number,
    default: 0,
    min: 0
  },

  pendingBalance: {
    type: Number,
    default: 0,
    min: 0
  },

  cashCollected: {
    type: Number,
    default: 0,
    min: 0
  },

  totalEarned: {
    type: Number,
    default: 0
  },

  transactions: [{
    type: {
      type: String,
      enum: ["CREDIT", "DEBIT", "CASH_COLLECTED", "SETTLEMENT", "PAYOUT"],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'transactions.referenceModel'
    },
    referenceModel: {
      type: String,
      enum: ["Booking", "RiderEarning", "Payout", "Settlement"]
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "SETTLED", "PENDING_SETTLEMENT"],
      default: "COMPLETED"
    },
    settlementDueDate: Date,
    settledAt: Date,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

riderWalletSchema.index({ riderId: 1 });

// Check if model already exists before creating
const RiderWallet = mongoose.models.RiderWallet || mongoose.model("RiderWallet", riderWalletSchema);

export default RiderWallet;