const mongoose = require('mongoose');

const normalizeName = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

const unitSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Unit name is required'],
    maxlength: [100, 'Unit name must be 100 characters or fewer'],
    set: normalizeName,
  },
  nameKey: {
    type: String,
    required: true,
    unique: true,
  },
  deleted: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

// Keep display names readable while enforcing case-insensitive uniqueness.
unitSchema.pre('validate', function () {
  if (typeof this.name === 'string') {
    this.name = normalizeName(this.name);
    this.nameKey = this.name.toLowerCase();
  }
});

module.exports = require('../storage/model')('Unit', unitSchema);
