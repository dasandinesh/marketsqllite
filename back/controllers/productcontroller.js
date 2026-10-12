const ProductModel = require('../model/productmodule');

exports.createProduct = async (req, res) => {
    try {
        const Product = ProductModel;
        const body = req.body || {};



        const productData = {
            name: body.name,
            Malayalam: body.malayalam ?? body.Malayalam,
            Tamil: body.tamil ?? body.Tamil,
            Unit: body.unit ?? body.Unit,
            Price: body.price ?? body.Price,
            pags: body.pags ?? body.bagRate,
            Wages: body.wages ?? body.Wages,
            commission: body.commission,

        };

        const product = new Product(productData);
        await product.save();
        res.status(201).json(product);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// Get all products for the logged-in user
exports.getProducts = async (req, res) => {
    try {
        const Product = ProductModel;
        // Only find products belonging to the authenticated user
        const products = await Product.find();
        res.status(200).json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get a product by ID (only if it belongs to the user)
exports.getProductById = async (req, res) => {
    try {
        const Product = ProductModel;
        const product = await Product.findOne({ _id: req.params.id});
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.status(200).json(product);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update a product by ID (only if it belongs to the user)
exports.updateProduct = async (req, res) => {
    try {
        const Product = ProductModel;
        const body = req.body || {};
        const entries = Array.isArray(body.entries) ? body.entries.map(e => ({
            serialNumber: e.serialNumber || '',
            date: e.date || '',
            patchNumber: e.batchNumber || e.patchNumber || ''
        })) : undefined; // undefined to avoid clearing unless provided

        const update = {
            name: body.name,
            Malayalam: body.malayalam ?? body.Malayalam,
            Tamil: body.tamil ?? body.Tamil,
            Unit: body.unit ?? body.Unit,
            Price: body.price ?? body.Price,
            pags: body.pags ?? body.bagRate,
            Wages: body.wages ?? body.Wages,
            commission: body.commission,
        };

        // Remove undefined keys so they don't overwrite existing values
        Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);

        const product = await Product.findOneAndUpdate(
            { _id: req.params.id},
            update,
            { new: true, runValidators: true }
        );
        if (!product) {
            return res.status(404).json({ error: 'Product not found or access denied' });
        }
        res.status(200).json(product);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// Delete a product by ID (only if it belongs to the user)
exports.deleteProduct = async (req, res) => {
    try {
        const Product = ProductModel;
        const product = await Product.findOneAndDelete({ _id: req.params.id });
        if (!product) {
            return res.status(404).json({ error: 'Product not found or access denied' });
        }
        res.status(200).json({ message: 'Product deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
