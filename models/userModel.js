const mongoose = require("mongoose");

const userScheme = new mongoose.Schema({
    email: String,
    passwordHash: String,

}, {timestamps: true})

module.exports = mongoose.model("User", userScheme);