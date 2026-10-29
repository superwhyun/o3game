const { randomBytes } = require('node:crypto');
const { getAddress, recoverMessageAddress } = require('viem');
const User = require('../models/User');
const WalletChallenge = require('../models/WalletChallenge');
const AuditLog = require('../models/AuditLog');
const metanomic = require('./MetanomicClient');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_OPEN_CHALLENGES = 5;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const CHAIN_CACHE_MS = 10 * 60 * 1000;
let chainCache = null;

function fail(statusCode, code, message) {
  throw Object.assign(new Error(message), { statusCode, code });
}

/** Accepts 0x… and ronin:… forms; returns the lowercase 0x address. */
function normalizeAddress(input) {
  if (typeof input !== 'string') fail(400, 'INVALID_ADDRESS', '지갑 주소가 올바르지 않습니다.');
  const text = input.trim().replace(/^ronin:/i, '0x');
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) fail(400, 'INVALID_ADDRESS', '지갑 주소가 올바르지 않습니다.');
  let checksummed;
  try { checksummed = getAddress(text); }
  catch { fail(400, 'INVALID_ADDRESS', '지갑 주소의 체크섬이 올바르지 않습니다.'); }
  const lowered = checksummed.toLowerCase();
  if (lowered === ZERO_ADDRESS) fail(400, 'INVALID_ADDRESS', '지갑 주소가 올바르지 않습니다.');
  return lowered;
}

/** Chain the signed message is bound to: env override, else Metanomic's active deployment. */
async function resolveChainId() {
  if (process.env.METANOMIC_CHAIN_ID) return Number(process.env.METANOMIC_CHAIN_ID);
  if (chainCache && chainCache.expires > Date.now()) return chainCache.chainId;
  const { assets } = await metanomic.getClient().assets();
  const asset = (assets || [])[0];
  const deployment = asset?.deployments?.find((d) => d.id === asset.activeDeploymentId);
  if (!deployment?.chainId) fail(503, 'CHAIN_UNAVAILABLE', '체인 정보를 확인할 수 없습니다.');
  chainCache = { chainId: deployment.chainId, expires: Date.now() + CHAIN_CACHE_MS };
  return chainCache.chainId;
}

function siteInfo() {
  const uri = process.env.CLIENT_URL || 'http://localhost:5173';
  return { uri, domain: new URL(uri).host };
}

/** EIP-4361 message. The server stores the exact text and verifies against it. */
function buildMessage({ address, chainId, nonce, issuedAt, expiresAt, requestId }) {
  const { uri, domain } = siteInfo();
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    getAddress(address),
    '',
    'Link this wallet to your Cosmic Empire account. This only proves ownership: it sends no transaction and costs no gas.',
    '',
    `URI: ${uri}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
    `Request ID: ${requestId}`
  ].join('\n');
}

/** Network the wallet must be on; the RPC URL lets a wallet add the chain when it does not know it. */
async function network() {
  if (!metanomic.isEnabled()) return null;
  try { return { chainId: await resolveChainId(), name: process.env.WALLET_CHAIN_NAME || 'Ronin Saigon', rpcUrl: process.env.WALLET_RPC_URL || null }; }
  catch { return null; }
}

async function status(userId) {
  const user = await User.findById(userId).select('wallet').lean();
  return {
    network: await network(),
    enabled: metanomic.isEnabled(),
    linked: Boolean(user?.wallet?.address),
    address: user?.wallet?.address || null,
    linkedAt: user?.wallet?.linkedAt || null
  };
}

async function createChallenge(userId, rawAddress, now = new Date()) {
  const address = normalizeAddress(rawAddress);
  const chainId = await resolveChainId();
  const user = await User.findById(userId).select('wallet').lean();
  if (!user) fail(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
  if (user.wallet?.address) fail(409, 'WALLET_ALREADY_SET', '이미 지갑이 연결되어 있습니다. 변경할 수 없습니다.');
  if (await User.exists({ 'wallet.address': address })) fail(409, 'WALLET_IN_USE', '다른 계정에 연결된 지갑입니다.');
  const open = await WalletChallenge.countDocuments({ userId, used: false, expiresAt: { $gt: now } });
  if (open >= MAX_OPEN_CHALLENGES) fail(429, 'TOO_MANY_CHALLENGES', '요청이 너무 많습니다. 잠시 후 다시 시도하십시오.');

  const challenge = new WalletChallenge({
    userId, address, chainId,
    nonce: randomBytes(16).toString('hex'),
    issuedAt: now,
    expiresAt: new Date(+now + CHALLENGE_TTL_MS),
    message: 'pending'
  });
  challenge.message = buildMessage({ address, chainId, nonce: challenge.nonce, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt, requestId: String(challenge._id) });
  await challenge.save();
  return { challengeId: String(challenge._id), message: challenge.message, expiresAt: +challenge.expiresAt, address, chainId };
}

async function link(userId, challengeId, signature, now = new Date()) {
  if (!/^[0-9a-fA-F]{24}$/.test(String(challengeId)) || !/^0x[0-9a-fA-F]+$/.test(String(signature))) {
    fail(400, 'INVALID_REQUEST', '요청이 올바르지 않습니다.');
  }
  const challenge = await WalletChallenge.findOne({ _id: challengeId, userId });
  if (!challenge || challenge.used) fail(400, 'CHALLENGE_INVALID', '유효하지 않은 서명 요청입니다. 다시 시도하십시오.');
  if (+challenge.expiresAt <= +now) fail(400, 'CHALLENGE_EXPIRED', '서명 요청이 만료되었습니다. 다시 시도하십시오.');

  let signer;
  try { signer = await recoverMessageAddress({ message: challenge.message, signature }); }
  catch { fail(400, 'SIGNATURE_INVALID', '서명을 확인할 수 없습니다.'); }
  if (signer.toLowerCase() !== challenge.address) fail(400, 'SIGNATURE_MISMATCH', '서명한 지갑이 요청한 지갑과 다릅니다.');

  // Single use: exactly one concurrent submission wins the challenge.
  const consumed = await WalletChallenge.findOneAndUpdate(
    { _id: challenge._id, userId, used: false, expiresAt: { $gt: now } },
    { $set: { used: true } }
  );
  if (!consumed) fail(400, 'CHALLENGE_INVALID', '이미 사용된 서명 요청입니다.');

  try {
    const result = await User.updateOne(
      { _id: userId, 'wallet.address': { $exists: false } },
      { $set: { wallet: { address: challenge.address, linkedAt: now } } }
    );
    if (result.matchedCount === 0) {
      fail((await User.exists({ _id: userId })) ? 409 : 404, 'WALLET_ALREADY_SET', '이미 지갑이 연결되어 있습니다. 변경할 수 없습니다.');
    }
  } catch (error) {
    if (error?.code === 11000) fail(409, 'WALLET_IN_USE', '다른 계정에 연결된 지갑입니다.');
    throw error;
  }
  return { linked: true, address: challenge.address, linkedAt: now };
}

/** Administrative escape hatch for a mistaken link; players cannot unlink. */
async function adminUnlink(actorId, userId) {
  const user = await User.findOneAndUpdate({ _id: userId, 'wallet.address': { $exists: true } }, { $unset: { wallet: '' } }, { returnDocument: 'before' });
  if (!user) fail(404, 'WALLET_NOT_LINKED', '연결된 지갑이 없습니다.');
  await AuditLog.create({ actorId, action: 'wallet.unlink', payload: { userId: String(userId), address: user.wallet.address } });
  return { unlinked: true, address: user.wallet.address };
}

function resetChainCache() { chainCache = null; }

module.exports = { normalizeAddress, status, createChallenge, link, adminUnlink, buildMessage, resetChainCache, CHALLENGE_TTL_MS };
