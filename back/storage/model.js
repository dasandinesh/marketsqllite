const mongoose = require('mongoose');
const { engine } = require('./index');
const { patch } = require('./query');

// Shared schemas keep existing API validation, defaults and BSON IDs. In SQLite
// mode every persistence operation below goes to SQLite, without a Mongo server.
module.exports = function createModel(name, schema) {
  const Model = mongoose.models[name] || mongoose.model(name, schema);
  if (engine() !== 'sqlite' || Model.sqliteAdapter) return Model;
  const { getStore, registerIndexes } = require('./sqlite');
  const collectionName = Model.collection.name;
  registerIndexes(collectionName, schema.indexes());
  const collection = () => getStore().namespace().collection(collectionName);
  const transaction = operation => getStore().transaction(operation);
  const hydrate = document => document ? Model.hydrate(document) : null;

  class Query {
    constructor(filter, one, projection) { this.filter = filter || {}; this.one = one; this.projection = projection; this.order = {}; this.offset = 0; this.size = Infinity; this.plain = false; }
    sort(order) { this.order = order; return this; }
    skip(offset) { this.offset = offset; return this; }
    limit(size) { this.size = size; return this; }
    lean() { this.plain = true; return this; }
    async exec() {
      const documents = await collection().find(this.filter).sort(this.order).skip(this.offset).limit(this.one ? 1 : this.size).toArray();
      const result = documents.map(document => this.plain ? document : hydrate(document));
      return this.one ? result[0] || null : result;
    }
    then(resolve, reject) { return this.exec().then(resolve, reject); }
    catch(reject) { return this.exec().catch(reject); }
  }

  Model.prototype.save = async function save() {
    return transaction(async () => {
      await this.validate();
      const now = new Date();
      if (schema.options.timestamps) { if (!this.createdAt) this.createdAt = now; this.updatedAt = now; }
      if (schema.options.versionKey && this.get(schema.options.versionKey) == null) this.set(schema.options.versionKey, 0);
      const document = this.toObject({ depopulate: true, flattenMaps: true });
      if (this.isNew) await collection().insertOne(document);
      else {
        const result = await collection().replaceOne({ _id: this._id }, document);
        if (!result.matchedCount) throw new Error('This record no longer exists. Reload before saving.');
      }
      this.$isNew = false;
      return this;
    });
  };
  Model.find = (filter, projection) => new Query(filter, false, projection);
  Model.findOne = filter => new Query(filter, true);
  Model.findById = id => Model.findOne({ _id: id });
  Model.countDocuments = filter => collection().countDocuments(filter);
  Model.distinct = (field, filter) => collection().distinct(field, filter);
  Model.create = data => transaction(async () => {
    if (!Array.isArray(data)) return new Model(data).save();
    const documents = [];
    for (const item of data) documents.push(await new Model(item).save());
    return documents;
  });
  Model.findOneAndUpdate = (filter, update, options = {}) => transaction(async () => {
    const previous = await collection().findOne(filter);
    if (!previous && !options.upsert) return null;
    const initial = previous || Object.fromEntries(Object.entries(filter).filter(([key, value]) => !key.startsWith('$') && !(value && Object.keys(value).some(part => part.startsWith('$')))));
    const document = previous ? hydrate(previous) : new Model(initial);
    const updated = patch(document.toObject(), update, !previous);
    document.set(updated);
    await document.save();
    return options.new ? document : hydrate(previous);
  });
  Model.findByIdAndUpdate = (id, update, options) => Model.findOneAndUpdate({ _id: id }, update, options);
  Model.findOneAndDelete = filter => transaction(async () => {
    const previous = await collection().findOne(filter);
    if (previous) await collection().deleteOne({ _id: previous._id });
    return hydrate(previous);
  });
  Model.findByIdAndDelete = id => Model.findOneAndDelete({ _id: id });
  Model.sqliteAdapter = true;
  return Model;
};
