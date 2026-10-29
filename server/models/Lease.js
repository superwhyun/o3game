const mongoose = require('mongoose');

/** Time-limited ownership of a background job so only one server instance runs it. */
const leaseSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  holder: { type: String, required: true },
  expiresAt: { type: Date, required: true }
});

/** @returns {Promise<boolean>} whether `holder` now owns the lease */
leaseSchema.statics.acquire = async function acquire(name, holder, ttlMs, now = new Date()) {
  try {
    const lease = await this.findOneAndUpdate(
      { name, $or: [{ holder }, { expiresAt: { $lte: now } }] },
      { $set: { holder, expiresAt: new Date(+now + ttlMs) } },
      { upsert: true, returnDocument: 'after' }
    );
    return lease?.holder === holder;
  } catch (error) {
    if (error.code === 11000) return false; // another holder owns an unexpired lease
    throw error;
  }
};

leaseSchema.statics.release = function release(name, holder) {
  return this.deleteOne({ name, holder });
};

module.exports = mongoose.model('Lease', leaseSchema);
