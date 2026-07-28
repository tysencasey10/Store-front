const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    description: { type: String, required: true },
    productID: { type: String, required: true, unique: true, index: true },
    image: { type: String, required: true },
    manufacturer: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
  },
  { collection: "products" }
);

module.exports = mongoose.model("Product", productSchema);
