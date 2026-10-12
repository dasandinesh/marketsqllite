const mongoose = require('mongoose');

// One document per running sequence, e.g. { _id: 'sale', seq: 42 }.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const CounterModel = require('../storage/model')('Counter', counterSchema);

// Atomically bump a sequence and return the new value.
CounterModel.next = async function next(name) {
  const doc = await CounterModel.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
};

module.exports = CounterModel;
