const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Driver name is required'],
    trim: true
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  area: {
    type: String,
    trim: true,
    default: ''
  },
}, { timestamps: true });

driverSchema.index({ name: 1 });

const DriverModel = require('../storage/model')('Driver', driverSchema);

module.exports = DriverModel;
