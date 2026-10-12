const Unit = require('../model/unitmodule');
const Product = require('../model/productmodule');

const normalizeName = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const duplicate = (res) => res.status(409).json({ error: 'A unit with this name already exists.' });
const validateName = (value, res) => {
  const name = normalizeName(value);
  if (!name) {
    res.status(400).json({ error: 'Unit name must be a non-empty string.' });
    return null;
  }
  if (name.length > 100) {
    res.status(400).json({ error: 'Unit name must be 100 characters or fewer.' });
    return null;
  }
  return name;
};
const deleted = (name, res) => res.status(200).json({ message: 'Unit deleted successfully.', name });
const notFound = (res) => res.status(404).json({ error: 'Unit not found.' });

exports.getUnits = async (req, res) => {
  try {
    const [savedUnits, productNames] = await Promise.all([
      Unit.find({}, { name: 1, nameKey: 1, deleted: 1 }),
      Product.distinct('Unit'),
    ]);
    const suppressed = new Set(savedUnits.filter((unit) => unit.deleted === true).map((unit) => normalizeName(unit.name).toLowerCase()));
    const names = new Map();
    for (const value of [...savedUnits.filter((unit) => unit.deleted !== true).map((unit) => unit.name), ...productNames]) {
      const name = normalizeName(value);
      const key = name.toLowerCase();
      if (name && !suppressed.has(key) && !names.has(key)) names.set(key, { name });
    }
    const units = Array.from(names.values()).sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    res.status(200).json(units);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createUnit = async (req, res) => {
  const name = validateName(req.body?.name, res);
  if (!name) return;
  const nameKey = name.toLowerCase();

  try {
    const savedUnit = await Unit.findOne({ nameKey });
    if (savedUnit?.deleted === true) {
      const unit = await Unit.findOneAndUpdate(
        { nameKey, deleted: true },
        { $set: { name, deleted: false } },
        { new: true, runValidators: true },
      );
      // A concurrent restoration already made this unit active.
      if (!unit) return duplicate(res);
      return res.status(201).json(unit);
    }
    if (savedUnit) return duplicate(res);
    const productNames = await Product.distinct('Unit');
    if (productNames.some((value) => normalizeName(value).toLowerCase() === nameKey)) {
      return duplicate(res);
    }
    const unit = await Unit.create({ name, nameKey, deleted: false });
    res.status(201).json(unit);
  } catch (error) {
    // The unique index also protects against two concurrent creations.
    if (error.code === 11000) return duplicate(res);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteUnit = async (req, res) => {
  const name = validateName(req.query?.name, res);
  if (!name) return;
  const nameKey = name.toLowerCase();

  try {
    const savedUnit = await Unit.findOne({ nameKey });
    if (savedUnit?.deleted === true) return deleted(name, res);
    if (savedUnit) {
      const unit = await Unit.findOneAndUpdate(
        { nameKey },
        { $set: { deleted: true } },
        { new: true, runValidators: true },
      );
      if (!unit) return notFound(res);
      return deleted(name, res);
    }
    const productNames = await Product.distinct('Unit');
    if (!productNames.some((value) => normalizeName(value).toLowerCase() === nameKey)) return notFound(res);
    // Suppress a legacy suggestion without changing any product's unit value.
    await Unit.create({ name, nameKey, deleted: true });
    return deleted(name, res);
  } catch (error) {
    if (error.code === 11000) {
      try {
        // Another creation won the unique-key race; suppress that record.
        const unit = await Unit.findOneAndUpdate(
          { nameKey },
          { $set: { deleted: true } },
          { new: true, runValidators: true },
        );
        if (unit) return deleted(name, res);
      } catch (recoveryError) {
        return res.status(500).json({ error: recoveryError.message });
      }
    }
    return res.status(500).json({ error: error.message });
  }
};

module.exports = require('../storage/transaction').wrapControllers(module.exports);
