const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    orderID: { type: String, required: true, index: true },
    productID: { type: String, required: true, index: true },
    username: { type: String, required: true, index: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    reviewText: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "reviews" }
);

reviewSchema.index({ orderID: 1, productID: 1 }, { unique: true });

module.exports = mongoose.model("Review", reviewSchema);
