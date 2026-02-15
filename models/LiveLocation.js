import mongoose from "mongoose";

const liveLocationSchema = new mongoose.Schema({
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: "Rider" },

  lat: Number,
  lng: Number,

  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model("LiveLocation", liveLocationSchema);
