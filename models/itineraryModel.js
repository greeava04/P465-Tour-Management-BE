const mongoose = require("mongoose");

const itinerarySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: String,
  destinations: [
    {
      location: String,
      arrivalDate: Date,
      departureDate: Date,
    },
  ],
  activities: [String],
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });


module.exports = mongoose.model("Itinerary", itinerarySchema);