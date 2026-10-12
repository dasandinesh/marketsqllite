const InvoiceSetting = require('../model/invoice_settings');

// Bills always print from exactly one invoice setting. The API therefore allows at
// most one document: a second create is rejected, and the "active" lookup fails
// loudly when zero or more than one exist so the bill screen can warn the user.

// Create — only when none exists yet.
exports.createInvoiceSetting = async (req, res) => {
    try {
        const count = await InvoiceSetting.countDocuments();
        if (count > 0) {
            return res.status(409).json({ error: 'An invoice setting already exists. Edit or delete it before creating another.' });
        }
        const setting = await InvoiceSetting.create(req.body || {});
        res.status(201).json(setting);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// List all (the UI uses this to detect 0 / 1 / many).
exports.getInvoiceSettings = async (req, res) => {
    try {
        const settings = await InvoiceSetting.find().sort({ createdAt: 1 });
        res.status(200).json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// The single setting bills print from.
exports.getActiveInvoiceSetting = async (req, res) => {
    try {
        const settings = await InvoiceSetting.find().sort({ createdAt: 1 });
        if (settings.length === 0) {
            return res.status(404).json({ error: 'No invoice setting configured. Create one before printing a bill.' });
        }
        if (settings.length > 1) {
            return res.status(409).json({ error: 'Multiple invoice settings found. Keep exactly one so bills print correctly.' });
        }
        res.status(200).json(settings[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getInvoiceSettingById = async (req, res) => {
    try {
        const setting = await InvoiceSetting.findById(req.params.id);
        if (!setting) return res.status(404).json({ error: 'Invoice setting not found.' });
        res.status(200).json(setting);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateInvoiceSetting = async (req, res) => {
    try {
        const setting = await InvoiceSetting.findByIdAndUpdate(
            req.params.id,
            req.body || {},
            { new: true, runValidators: true }
        );
        if (!setting) return res.status(404).json({ error: 'Invoice setting not found.' });
        res.status(200).json(setting);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.deleteInvoiceSetting = async (req, res) => {
    try {
        const setting = await InvoiceSetting.findByIdAndDelete(req.params.id);
        if (!setting) return res.status(404).json({ error: 'Invoice setting not found.' });
        res.status(200).json({ message: 'Invoice setting deleted successfully.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
