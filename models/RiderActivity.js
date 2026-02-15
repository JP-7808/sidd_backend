import mongoose from "mongoose";

const riderActivitySchema = new mongoose.Schema({
  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider"
  },

  isOnline: Boolean,
  availabilityStatus: String,

  lastLocation: {
    lat: Number,
    lng: Number
  },

  lastSeenAt: Date
});

export default mongoose.model("RiderActivity", riderActivitySchema);
