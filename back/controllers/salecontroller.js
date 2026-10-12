const Sale = require('../model/salemodule');
const Counter = require('../model/countermodule');
const Customer = require('../model/customermodule');

const number = (value) => Number(value) || 0;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// How much a bill moves the customer's balance: billed amount owed minus what was paid on the bill.
const saleImpact = (bill = {}) => number(bill.bill_amount) - number(bill.debit) - number(bill.credit);

// Adjust a customer's running balance (customermodule `oldBalance`) by `delta`.
// Returns { before, after } so callers can snapshot both on the bill.
const applyCustomerBalance = async (name, delta) => {
  if (!name) return { before: 0, after: 0 };
  const c = await Customer.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
  if (!c) return { before: 0, after: 0 };
  const before = number(c.oldBalance);
  const after = before + number(delta);
  if (delta) { c.oldBalance = after; await c.save(); }
  return { before, after };
};

// Bag rate / wage / commission are per-bag handling charges — they only apply when a
// bag count was actually entered on the line. No bags → no bag price / wage / commission.
const prepareSale = (body = {}) => {
  const products = Array.isArray(body.products) ? body.products.filter((item) => item && item.name).map((item) => {
    const quantity = number(item.quantity);
    const bags = number(item.bags);
    const single_price = number(item.single_price);
    const scale = item.scale || '';
    const hasBags = bags > 0;
    const bagRate = number(item.bagRate);
    const wage = number(item.wage);
    const commission = number(item.commission);
    // Line amount is always quantity × single_price; bags never drive the price.
    return {
      name: item.name,
      comment: item.comment || '',
      tamil: item.tamil || '',
      quantity,
      bags,
      scale,
      single_price,
      base_price: quantity * single_price,
      bagRate,
      bagAmount: hasBags ? bags * bagRate : 0,
      wage,
      wageAmount: hasBags ? bags * wage : 0,
      commission,
      commissionAmount: hasBags ? bags * commission : 0,
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

exports.createSale = async (req, res) => {
  try {
    const data = prepareSale(req.body);
    if (!data.products.length) return res.status(400).json({ error: 'Add at least one product before saving the sale.' });
    // Auto-assign the next bill serial number when the user didn't type one.
    if (!data.bill_details.order_sno) {
      data.bill_details.order_sno = String(await Counter.next('sale'));
    }
    // Post this bill to the customer's running balance and snapshot before/after on the bill.
    const bal = await applyCustomerBalance(data.customer.name, saleImpact(data.bill_details));
    data.bill_details.old_balance = bal.before;
    data.bill_details.net_balance = bal.after;
    data.bill_details.balance = bal.after;
    const sale = await Sale.create(data);
    res.status(201).json(sale);
  } catch (error) { res.status(400).json({ error: error.message }); }
};

exports.getSales = async (req, res) => {
  try {
    const filter = {};
    if (req.query.customer) filter['customer.name'] = { $regex: req.query.customer.trim(), $options: 'i' };
    // Free-text search box: matches customer name or bill number.
    if (req.query.q && req.query.q.trim()) {
      const rx = { $regex: escapeRegex(req.query.q.trim()), $options: 'i' };
      filter.$or = [{ 'customer.name': rx }, { 'bill_details.order_sno': rx }];
    }
    if (req.query.billed === 'true' || req.query.billed === 'false') {
      filter['bill_details.billed'] = req.query.billed === 'true';
    }
    // Only bills that contain an exact given product line — used by the per-product price editor.
    if (req.query.product && req.query.product.trim()) {
      filter['products.name'] = { $regex: `^${escapeRegex(req.query.product.trim())}$`, $options: 'i' };
    }
    if (req.query.startDate || req.query.endDate) {
      filter['bill_details.date'] = {};
      if (req.query.startDate) filter['bill_details.date'].$gte = new Date(`${req.query.startDate}T00:00:00.000`);
      if (req.query.endDate) filter['bill_details.date'].$lte = new Date(`${req.query.endDate}T23:59:59.999`);
    }
    const sort = { 'bill_details.date': -1, createdAt: -1 };

    // Paginated report mode — opt-in via ?page=, so existing callers that expect a
    // bare array (order entry's summary panel, print helpers) are unaffected.
    if (req.query.page) {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
      const page = Math.max(1, Number(req.query.page) || 1);
      const [data, total] = await Promise.all([
        Sale.find(filter).sort(sort).skip((page - 1) * limit).limit(limit),
        Sale.countDocuments(filter),
      ]);
      return res.json({ data, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
    }

    res.json(await Sale.find(filter).sort(sort));
  }
  catch (error) { res.status(500).json({ error: error.message }); }
};

// Distinct product names that actually appear inside a sale bill — used by the
// price editor so its datalist only offers products someone has actually sold,
// not the whole product master.
exports.getSoldProductNames = async (req, res) => {
  try {
    const names = await Sale.distinct('products.name');
    res.json(names.filter(Boolean).sort((a, b) => a.localeCompare(b)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getSaleById = async (req, res) => {
  try { const sale = await Sale.findById(req.params.id); if (!sale) return res.status(404).json({ error: 'Sale not found.' }); res.json(sale); }
  catch (error) { res.status(400).json({ error: error.message }); }
};

exports.updateSale = async (req, res) => {
  try {
    const data = prepareSale(req.body);
    if (!data.products.length) return res.status(400).json({ error: 'Add at least one product before saving the sale.' });
    const prev = await Sale.findById(req.params.id);
    if (!prev) return res.status(404).json({ error: 'Sale not found.' });
    // Reverse the old bill's balance effect (from its original customer), then apply the new one.
    await applyCustomerBalance(prev.customer?.name, -saleImpact(prev.bill_details));
    const bal = await applyCustomerBalance(data.customer.name, saleImpact(data.bill_details));
    data.bill_details.old_balance = bal.before;
    data.bill_details.net_balance = bal.after;
    data.bill_details.balance = bal.after;
    const sale = await Sale.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    res.json(sale);
  }
  catch (error) { res.status(400).json({ error: error.message }); }
};

exports.deleteSale = async (req, res) => {
  try {
    const sale = await Sale.findByIdAndDelete(req.params.id);
    if (!sale) return res.status(404).json({ error: 'Sale not found.' });
    await applyCustomerBalance(sale.customer?.name, -saleImpact(sale.bill_details)); // undo its balance effect
    res.json({ message: 'Sale deleted successfully.' });
  }
  catch (error) { res.status(400).json({ error: error.message }); }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
