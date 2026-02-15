import mongoose from "mongoose";

const adminSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  role: {
    type: String,
    default: "ADMIN"
  },

  isActive: {
    type: Boolean,
    default: true
  },

  tokenVersion: {
    type: Number,
    default: 0,
    select: false
  }
});

export default mongoose.model("Admin", adminSchema);
