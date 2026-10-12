const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  createDate: { type: Date, default: Date.now },
  phone: { type: String },
  door: { type: String },
  street: { type: String },
  area: { type: String },
  district: { type: String },
  state: { type: String },
  pincode: { type: String },
  oldBalance: { type: Number, default: 0 }
}, { timestamps: true });

// Default global model (legacy)
const CompanyModel = require('../storage/model')('Company', companySchema);


module.exports = CompanyModel;
