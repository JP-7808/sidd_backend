import mongoose from "mongoose";

const emailTemplateSchema = new mongoose.Schema({
  templateName: {
    type: String,
    required: true,
    unique: true,
    enum: [
      "BOOKING_CONFIRMATION_USER",
      "BOOKING_REQUEST_RIDER",
      "BOOKING_ACCEPTED_USER",
      "BOOKING_CANCELLED",
      "PAYMENT_SUCCESS",
      "RIDER_REGISTRATION",
      "RIDER_APPROVED",
      "RIDER_REJECTED",
      "OTP_VERIFICATION",
      "RIDE_STARTED",
      "RIDE_COMPLETED",
      "RIDER_SUSPENDED",
      "PASSWORD_RESET",
      "WELCOME_USER",
      "WELCOME_RIDER",
      "PAYMENT_FAILED",
      "REFUND_PROCESSED",
      "ROUND_TRIP_SCHEDULED",
      "RETURN_RIDE_REMINDER"
    ]
  },

  subject: {
    type: String,
    required: true
  },

  htmlContent: {
    type: String,
    required: true
  },

  variables: [String],

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

// Create indexes
emailTemplateSchema.index({ templateName: 1 });
emailTemplateSchema.index({ isActive: 1 });

export default mongoose.model("EmailTemplate", emailTemplateSchema);