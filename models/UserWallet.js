import mongoose from "mongoose";

const userWalletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    unique: true,
    required: true
  },

  balance: {
    type: Number,
    default: 0,
    min: 0
  },

  transactions: [{
    type: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
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
      enum: ["Payment", "Booking", "Refund"]
    },
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

userWalletSchema.index({ userId: 1 });

export default mongoose.model("UserWallet", userWalletSchema);