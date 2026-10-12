const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  createDate: { type: Date, default: Date.now },
  phone: { type: String },
  door: { type: String },
  street: { type: String },
  area: { type: String },
  district: { type: String },
  state: { type: String },
  pincode: { type: String },
  oldBalance: { type: Number, default: 0 }   // running balance — updated by every sale and receipt
}, { timestamps: true });

// Default global model (legacy)
const CustomerModel = require('../storage/model')('Customer', customerSchema);


module.exports = CustomerModel;
