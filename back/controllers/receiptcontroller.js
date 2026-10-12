const Receipt = require('../model/receiptmodule');
const Counter = require('../model/countermodule');
const Customer = require('../model/customermodule');

const number = (value) => Number(value) || 0;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Adjust a customer's running balance (customermodule `oldBalance`) by `delta`.
// A receipt credits the account, i.e. pass a negative delta.
const applyCustomerBalance = async (name, delta) => {
  if (!name || !delta) return;
  const c = await Customer.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
  if (!c) return;
  c.oldBalance = number(c.oldBalance) + delta;
  await c.save();
};

const prepare = (body = {}) => ({
  date: body.date || new Date(),
  customer: { name: (body.customer?.name ?? body.customerName ?? '').trim() },
  amount: number(body.amount),
  mode: (body.mode || 'cash').trim(),
  note: (body.note || '').trim(),
});

exports.createReceipt = async (req, res) => {
  try {
    const data = prepare(req.body);
    if (!data.customer.name) return res.status(400).json({ error: 'Customer name is required.' });
    if (!data.amount || data.amount <= 0) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
    // Auto receipt number when the user didn't type one.
    data.receipt_no = req.body.receipt_no
      ? String(req.body.receipt_no).trim()
      : String(await Counter.next('receipt'));
    const receipt = await Receipt.create(data);
    await applyCustomerBalance(data.customer.name, -data.amount); // payment received reduces balance
    res.status(201).json(receipt);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getReceipts = async (req, res) => {
  try {
    const filter = {};
    if (req.query.customer) filter['customer.name'] = { $regex: req.query.customer.trim(), $options: 'i' };
    if (req.query.startDate || req.query.endDate) {
      filter.date = {};
      if (req.query.startDate) filter.date.$gte = new Date(`${req.query.startDate}T00:00:00.000`);
      if (req.query.endDate) filter.date.$lte = new Date(`${req.query.endDate}T23:59:59.999`);
    }
    res.json(await Receipt.find(filter).sort({ date: -1, createdAt: -1 }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getReceiptById = async (req, res) => {
  try {
    const receipt = await Receipt.findById(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found.' });
    res.json(receipt);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateReceipt = async (req, res) => {
  try {
    const data = prepare(req.body);
    if (!data.customer.name) return res.status(400).json({ error: 'Customer name is required.' });
    if (!data.amount || data.amount <= 0) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
    if (req.body.receipt_no) data.receipt_no = String(req.body.receipt_no).trim();
    const prev = await Receipt.findById(req.params.id);
    if (!prev) return res.status(404).json({ error: 'Receipt not found.' });
    await applyCustomerBalance(prev.customer?.name, number(prev.amount)); // undo old credit
    await applyCustomerBalance(data.customer.name, -data.amount);          // apply new credit
    const receipt = await Receipt.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    res.json(receipt);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteReceipt = async (req, res) => {
  try {
    const receipt = await Receipt.findByIdAndDelete(req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found.' });
    await applyCustomerBalance(receipt.customer?.name, number(receipt.amount)); // undo its credit
    res.json({ message: 'Receipt deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
