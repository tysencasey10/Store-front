const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true, trim: true },
  },
  { collection: "users" }
);

module.exports = mongoose.model("User", userSchema);
