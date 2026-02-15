import mongoose from "mongoose";

const ratingSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: "Rider" },

  rating: { type: Number, min: 1, max: 5 },
  comment: String,

  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Rating", ratingSchema);
