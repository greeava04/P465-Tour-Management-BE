const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  destinations: [
    {
      place: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Place', 
        required: true
      },
      time_start: {
        type: Number,       // Unix time - ease of sorting
        required: true
      },
      time_end: Number 
    }
  ],
  hotels: [
    {
      place: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel', 
        required: true
      },
      time_start: {
        type: Number,       // Unix time - ease of sorting
        required: true
      },
      time_end: Number,
      days: Number,
    }
  ],
  flights: [
    {
      place: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Flight', 
        required: true
      },
      time_start: {
        type: Number,       // Unix time - ease of sorting
        required: true
      },
      time_end: Number,
      round_trip: Boolean,
    }
  ],
  things: [
    {
      place: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ThingsToDo', 
        required: true
      },
      time_start: {
        type: Number,       // Unix time - ease of sorting
        required: true
      },
      time_end: Number 
    }
  ],
  totalPrice: {
    type: Number,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  fromItinerary: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Itinerary'
  },
}, { timestamps: true });


module.exports = mongoose.model("Booking", bookingSchema);