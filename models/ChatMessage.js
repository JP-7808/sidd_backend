import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema({
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: true
  },
  
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  
  senderType: {
    type: String,
    enum: ["CUSTOMER", "RIDER"],
    required: true
  },
  
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  
  receiverType: {
    type: String,
    enum: ["CUSTOMER", "RIDER"],
    required: true
  },
  
  message: {
    type: String,
    required: true,
    trim: true
  },
  
  isRead: {
    type: Boolean,
    default: false
  },
  
  readAt: Date
}, { 
  timestamps: true 
});

// Indexes
chatMessageSchema.index({ bookingId: 1, createdAt: -1 });
chatMessageSchema.index({ senderId: 1 });
chatMessageSchema.index({ receiverId: 1 });
chatMessageSchema.index({ isRead: 1 });

export default mongoose.model("ChatMessage", chatMessageSchema);