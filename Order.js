const mongoose = require("mongoose");

const orderLineSchema = new mongoose.Schema(
  {
    productID: { type: String, required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    total: { type: Number, required: true, min: 0 },
    itemNotes: { type: String, default: "" },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderID: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true, default: Date.now },
    items: { type: [orderLineSchema], required: true, default: [] },
    total: { type: Number, required: true, min: 0 },
  },
  { collection: "orders" }
);

module.exports = mongoose.model("Order", orderSchema);
