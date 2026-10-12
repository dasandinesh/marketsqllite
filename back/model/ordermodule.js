const mongoose = require('mongoose');

const productLineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  comment: { type: String, trim: true, default: '' },
  tamil: { type: String, trim: true, default: '' }, // snapshot of the product's Tamil name at billing time.
  quantity: { type: Number, default: 0, min: 0 }, // weight
  bags: { type: Number, default: 0, min: 0 },
  scale: { type: String, trim: true, default: '' }, // unit (mixer/bag/box/…)
  single_price: { type: Number, default: 0, min: 0 }, // rate
  base_price: { type: Number, default: 0, min: 0 }, // amount = (weight || bags) * rate
  bagRate: { type: Number, default: 0, min: 0 },
  bagAmount: { type: Number, default: 0, min: 0 }, // bags * bagRate
  wage: { type: Number, default: 0, min: 0 }, // per-bag wage rate
  wageAmount: { type: Number, default: 0, min: 0 }, // bags * wage
  commission: { type: Number, default: 0, min: 0 }, // per-bag commission rate
  commissionAmount: { type: Number, default: 0, min: 0 }, // bags * commission
}, { _id: true });

const orderSchema = new mongoose.Schema({
  customer: {
    name: { type: String, required: [true, 'Customer name is required'], trim: true },
  },
  bill_details: {
    order_sno: { type: String, trim: true, default: '' }, // Bill No.
    order_no: { type: String, trim: true, default: '' },
    mainParty: { type: String, trim: true, default: '' },
    date: { type: Date, default: Date.now },
    bill_date: { type: Date },
    total_quantity: { type: Number, default: 0 },
    bag_quantity: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 }, // sum of line amounts
    bagAmountTotal: { type: Number, default: 0 },
    wageTotal: { type: Number, default: 0 },
    commissionTotal: { type: Number, default: 0 },
    freight: { type: Number, default: 0 }, // manual header-level charge
    bill_amount: { type: Number, default: 0 }, // Grand Total = subtotal + bagAmountTotal + wageTotal + commissionTotal + freight
    balance: { type: Number, default: 0 }, // customer's balance snapshot at billing time (display only, not adjusted here)
    debit: { type: Number, default: 0 }, // Debit (Paymt)
    credit: { type: Number, default: 0 }, // Credit (Cash)
    remark: { type: String, trim: true, default: '' },
    billed: { type: Boolean, default: false }, // Confirm
  },
  products: { type: [productLineSchema], default: [] },
}, { timestamps: true });

orderSchema.index({ 'bill_details.date': -1, 'bill_details.order_sno': 1 });

module.exports = require('../storage/model')('Order', orderSchema);
