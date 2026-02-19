import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  
  email: { 
    type: String, 
    unique: true,
    required: true,
    lowercase: true,
    trim: true
  },
  
  phone: {
    type: String,
    required: true,
    unique: true
  },

  photo: {
    type: String,
    default: null
  },

  password: {
    type: String,
    required: function() { return !this.googleId; }
  },
  
  googleId: {
    type: String,
    sparse: true
  },

  isEmailVerified: { 
    type: Boolean, 
    default: false 
  },

  otp: {
    type: String
  },
  otpExpires: {
    type: Date
  },

  phoneOTP: {
    type: String
  },
  phoneOTPExpires: {
    type: Date
  },

  role: {
    type: String, 
    enum: ["USER", "ADMIN"],
    default: "USER" 
  },

  isActive: {
    type: Boolean,
    default: true
  },

  notificationToken: {
    type: String,
    default: null
  },


  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpires: {
    type: Date,
    select: false
  },

  lastLogin: Date,

  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  tokenVersion: {
    type: Number,
    default: 0,
    select: false
  }
  
}, { timestamps: true });

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ googleId: 1 });

export default mongoose.model("User", userSchema);