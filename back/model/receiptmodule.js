const mongoose = require('mongoose');

// A payment voucher — money received from a customer. Posts to the customer
// ledger as a credit (reduces what they owe).
const receiptSchema = new mongoose.Schema({
  receipt_no: { type: String, trim: true, default: '' },
  date: { type: Date, default: Date.now },
  customer: {
    name: { type: String, required: [true, 'Customer name is required'], trim: true },
  },
  amount: { type: Number, required: true, min: 0 },
  mode: { type: String, trim: true, default: 'cash' }, // cash | bank | upi | cheque
  note: { type: String, trim: true, default: '' },
}, { timestamps: true });

receiptSchema.index({ 'customer.name': 1, date: -1 });

module.exports = require('../storage/model')('Receipt', receiptSchema);
