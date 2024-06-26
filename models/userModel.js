const mongoose = require("mongoose");

const userScheme = new mongoose.Schema({
    email: String,
    passwordHash: String,
    username: String,
    firstName: String,
    lastName: String,
    phoneNum: Number,
    googleId : String,

}, {timestamps: true})

module.exports = mongoose.model("User", userScheme);