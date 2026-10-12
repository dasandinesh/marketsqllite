const Order = require('../model/ordermodule');
const Counter = require('../model/countermodule');

const number = (value) => Number(value) || 0;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Bag rate / wage / commission are per-bag handling charges — they only make sense for
// items that are actually counted and handled in bags/boxes. A loose, weight-sold scale
// like "mixters" never incurs them, even if a stray bag count was entered on that line.
const BAG_SCALES = new Set(['bag', 'o bag', 'box', 'leaves']);
const isBagScale = (scale) => BAG_SCALES.has((scale || '').trim().toLowerCase());

const prepareOrder = (body = {}) => {
  const products = Array.isArray(body.products) ? body.products.filter((item) => item && item.name).map((item) => {
    const quantity = number(item.quantity);
    const bags = number(item.bags);
    const single_price = number(item.single_price);
    const scale = item.scale || '';
    const bagBased = isBagScale(scale);
    const bagRate = number(item.bagRate);
    const wage = number(item.wage);
    const commission = number(item.commission);
    const billQty = quantity || bags; // weight-billed items use quantity; bag-billed items fall back to bag count.
    return {
      name: item.name,
      comment: item.comment || '',
      tamil: item.tamil || '',
      quantity,
      bags,
      scale,
      single_price,
      base_price: billQty * single_price,
      bagRate,
      bagAmount: bagBased ? bags * bagRate : 0,
      wage,
      wageAmount: bagBased ? bags * wage : 0,
      commission,
      commissionAmount: bagBased ? bags * commission : 0,
    };
  }) : [];

  const subtotal = products.reduce((total, item) => total + item.base_price, 0);
  const bagAmountTotal = products.reduce((total, item) => total + item.bagAmount, 0);
  const wageTotal = products.reduce((total, item) => total + item.wageAmount, 0);
  const commissionTotal = products.reduce((total, item) => total + item.commissionAmount, 0);
  const bill = body.bill_details || {};
  const freight = number(bill.freight);
  const grandTotal = subtotal + bagAmountTotal + wageTotal + commissionTotal + freight;

  return {
    customer: { name: body.customer?.name ?? body.customerName },
    products,
    bill_details: {
      order_sno: bill.order_sno || '',
      order_no: bill.order_no || '',
      mainParty: bill.mainParty || '',
      date: bill.date || new Date(),
      bill_date: bill.bill_date || undefined,
      total_quantity: products.reduce((total, item) => total + item.quantity, 0),
      bag_quantity: products.reduce((total, item) => total + item.bags, 0),
      weight: number(bill.weight),
      subtotal,
      bagAmountTotal,
      wageTotal,
      commissionTotal,
      freight,
      bill_amount: grandTotal,
      balance: number(bill.balance),
      debit: number(bill.debit),
      credit: number(bill.credit),
      remark: bill.remark || '',
      billed: Boolean(bill.billed),
    },
  };
};

exports.createOrder = async (req, res) => {
  try {
    const data = prepareOrder(req.body);
    if (!data.products.length) return res.status(400).json({ error: 'Add at least one product before saving the order.' });
    // Auto-assign the next bill serial number when the user didn't type one.
    if (!data.bill_details.order_sno) {
      data.bill_details.order_sno = String(await Counter.next('order'));
    }
    const order = await Order.create(data);
    res.status(201).json(order);
  } catch (error) { res.status(400).json({ error: error.message }); }
};

exports.getOrders = async (req, res) => {
  try {
    const filter = {};
    if (req.query.customer) filter['customer.name'] = { $regex: req.query.customer.trim(), $options: 'i' };
    // Only bills that contain an exact given product line — used by the per-product price editor.
    if (req.query.product && req.query.product.trim()) {
      filter['products.name'] = { $regex: `^${escapeRegex(req.query.product.trim())}$`, $options: 'i' };
    }
    if (req.query.startDate || req.query.endDate) {
      filter['bill_details.date'] = {};
      if (req.query.startDate) filter['bill_details.date'].$gte = new Date(`${req.query.startDate}T00:00:00.000`);
      if (req.query.endDate) filter['bill_details.date'].$lte = new Date(`${req.query.endDate}T23:59:59.999`);
    }
    res.json(await Order.find(filter).sort({ 'bill_details.date': -1, createdAt: -1 }));
  }
  catch (error) { res.status(500).json({ error: error.message }); }
};

// Distinct product names that actually appear inside an order bill — used by the
// price editor so its datalist only offers products someone has actually ordered.
exports.getOrderedProductNames = async (req, res) => {
  try {
    const names = await Order.distinct('products.name');
    res.json(names.filter(Boolean).sort((a, b) => a.localeCompare(b)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOrderById = async (req, res) => {
  try { const order = await Order.findById(req.params.id); if (!order) return res.status(404).json({ error: 'Order not found.' }); res.json(order); }
  catch (error) { res.status(400).json({ error: error.message }); }
};

exports.updateOrder = async (req, res) => {
  try { const data = prepareOrder(req.body); if (!data.products.length) return res.status(400).json({ error: 'Add at least one product before saving the order.' }); const order = await Order.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true }); if (!order) return res.status(404).json({ error: 'Order not found.' }); res.json(order); }
  catch (error) { res.status(400).json({ error: error.message }); }
};

exports.deleteOrder = async (req, res) => {
  try { const order = await Order.findByIdAndDelete(req.params.id); if (!order) return res.status(404).json({ error: 'Order not found.' }); res.json({ message: 'Order deleted successfully.' }); }
  catch (error) { res.status(400).json({ error: error.message }); }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
