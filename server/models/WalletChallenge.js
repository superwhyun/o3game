const mongoose = require('mongoose');

/** One-time sign-in-with-Ethereum challenge used to prove ownership of a wallet. */
const walletChallengeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  address: { type: String, required: true, lowercase: true },
  nonce: { type: String, required: true },
  message: { type: String, required: true },
  chainId: { type: Number, required: true },
  issuedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false }
});
// Expired challenges are removed shortly after they stop being usable.
walletChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model('WalletChallenge', walletChallengeSchema);
