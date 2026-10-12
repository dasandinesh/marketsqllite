const Sale = require('../model/salemodule');
const Receipt = require('../model/receiptmodule');
const Customer = require('../model/customermodule');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = (v) => Number(v) || 0;

// Running account statement for one customer:
//   opening balance  + sales billed (debit)  - payments & receipts (credit)  = balance
exports.getCustomerLedger = async (req, res) => {
  try {
    const name = (req.query.customer || '').trim();
    if (!name) return res.status(400).json({ error: 'A customer name is required.' });

    const exact = new RegExp(`^${escapeRegex(name)}$`, 'i');
    const [customer, sales, receipts] = await Promise.all([
      Customer.findOne({ name: exact }),
      Sale.find({ 'customer.name': exact }),
      Receipt.find({ 'customer.name': exact }),
    ]);

    // Build every ledger line (unfiltered), then split by the requested range.
    const lines = [];
    sales.forEach((s) => {
      const b = s.bill_details || {};
      lines.push({
        date: b.date, kind: 'sale', ref: b.order_sno || '',
        particulars: `Sale bill ${b.order_sno || ''}`.trim(),
        debit: num(b.bill_amount), credit: 0,
      });
      const paid = num(b.debit) + num(b.credit);
      if (paid > 0) {
        lines.push({
          date: b.date, kind: 'bill-payment', ref: b.order_sno || '',
          particulars: `Paid with bill ${b.order_sno || ''}`.trim(),
          debit: 0, credit: paid,
        });
      }
    });
    receipts.forEach((r) => {
      lines.push({
        date: r.date, kind: 'receipt', ref: r.receipt_no || '',
        particulars: `Receipt ${r.receipt_no || ''}${r.mode ? ` (${r.mode})` : ''}`.trim(),
        debit: 0, credit: num(r.amount),
      });
    });
    lines.sort((a, b) => new Date(a.date) - new Date(b.date));

    const start = req.query.startDate ? new Date(`${req.query.startDate}T00:00:00.000`) : null;
    const end = req.query.endDate ? new Date(`${req.query.endDate}T23:59:59.999`) : null;

    // customer.oldBalance is the *current* running balance (post everything).
    // Work back to the original opening so the statement reconciles to it.
    const netAllTime = lines.reduce((t, l) => t + l.debit - l.credit, 0);
    let opening = num(customer && customer.oldBalance) - netAllTime;
    const shown = [];
    lines.forEach((line) => {
      const d = new Date(line.date);
      if (start && d < start) {
        opening += line.debit - line.credit; // rolls into opening for the period
        return;
      }
      if (end && d > end) return;
      shown.push(line);
    });

    let running = opening;
    const entries = shown.map((line) => {
      running += line.debit - line.credit;
      return { ...line, balance: running };
    });

    res.json({
      customer: customer
        ? { name: customer.name, phone: customer.phone || '' }
        : { name, phone: '' },
      opening,
      entries,
      totalDebit: entries.reduce((t, e) => t + e.debit, 0),
      totalCredit: entries.reduce((t, e) => t + e.credit, 0),
      closing: running,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
