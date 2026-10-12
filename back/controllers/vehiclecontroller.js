const Vehicle = require('../model/vehiclemodule');

// Create a new vehicle
exports.createVehicle = async (req, res) => {
    try {
        const vehicle = new Vehicle({ ...req.body });
        await vehicle.save();
        res.status(201).json(vehicle);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// Get all vehicles
exports.getVehicles = async (req, res) => {
    try {
        const vehicles = await Vehicle.find().sort({ name: 1 });
        res.status(200).json(vehicles);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get a vehicle by ID
exports.getVehicleById = async (req, res) => {
    try {
        const vehicle = await Vehicle.findOne({ _id: req.params.id });
        if (!vehicle) {
            return res.status(404).json({ error: 'Vehicle not found' });
        }
        res.status(200).json(vehicle);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update a vehicle by ID
exports.updateVehicle = async (req, res) => {
    try {
        const vehicle = await Vehicle.findOneAndUpdate(
            { _id: req.params.id },
            req.body,
            { new: true, runValidators: true }
        );
        if (!vehicle) {
            return res.status(404).json({ error: 'Vehicle not found' });
        }
        res.status(200).json(vehicle);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// Delete a vehicle by ID
exports.deleteVehicle = async (req, res) => {
    try {
        const vehicle = await Vehicle.findOneAndDelete({ _id: req.params.id });
        if (!vehicle) {
            return res.status(404).json({ error: 'Vehicle not found' });
        }
        res.status(200).json({ message: 'Vehicle deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
