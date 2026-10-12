const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  name: {
    type: String, // vehicle name / registration number
    required: [true, 'Vehicle name is required'],
    trim: true
  },
  ownerName: {
    type: String,
    trim: true,
    default: ''
  },
  vehicleType: {
    type: String,
    trim: true,
    default: ''
  },
}, { timestamps: true });

vehicleSchema.index({ name: 1 });

const VehicleModel = require('../storage/model')('Vehicle', vehicleSchema);

module.exports = VehicleModel;
