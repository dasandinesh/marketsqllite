const mongoose = require('mongoose');
const productSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Product name is required'],
    trim: true 
  },
  Malayalam: {
    type: String,
    trim: true,
    default: ''
  },
  Tamil: {
    type: String,
    trim: true,
    default: ''
  },
  Unit: {
    type: String,
    trim: true,
    default: ''
  },


  Price: {
    type: Number,
    required: [true, 'Price is required'],
    min: 0
  },


  pags: {
    type: Number,
    default: 0
  },
  Wages: {
    type: Number,
    default: 0
  },
  commission: {
    type: Number,
    default: 0 
  },
});



// Create index for better query performance
productSchema.index({ name: 1 });

// Default global model (legacy)
const ProductModel = require('../storage/model')('Product', productSchema);
// Expose schema for tenant-aware binding
ProductModel.productSchema = productSchema;

module.exports = ProductModel;
