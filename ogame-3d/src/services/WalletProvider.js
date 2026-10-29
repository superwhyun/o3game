/**
 * Access to an injected EVM wallet (Ronin Wallet first). The game uses it for two things only:
 * proving ownership of an address once, and signing CGC purchases. Gameplay never needs it.
 * Flow modelled on the Metanomic portal's wallet code, which is known to work with Ronin.
 */

const isProvider = (value) => value != null && typeof value.request === 'function';
const STOP_CODES = new Set([4001, -32002]); // declined, or another prompt is already open

const toHex = (text) => '0x' + [...new TextEncoder().encode(text)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Player-facing message for the error shapes wallets produce. */
export function walletErrorMessage(error) {
  const seen = new Set();
  const inspect = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 6) return undefined;
    seen.add(value);
    if (value.code === 'WALLET_IS_LOCKED') return '지갑 앱이 서명값을 반환하지 못했습니다. 지갑을 한 번 잠근 뒤 비밀번호로 잠금을 해제하고 다시 시도하세요.';
    for (const nested of [value.cause, value.data, value.originalError, value.error]) {
      const message = inspect(nested, depth + 1);
      if (message) return message;
    }
    if (Number(value.code) === 4001) return '지갑 요청을 취소했습니다.';
    if (Number(value.code) === -32002) return '지갑에 처리 중인 요청이 있습니다. 지갑 앱에서 기존 요청을 승인하거나 취소하세요.';
    return undefined;
  };
  return inspect(error) ?? (typeof error?.message === 'string' && error.message ? error.message : '지갑 요청을 처리하지 못했습니다.');
}

/** Finds injected wallets (EIP-6963 announcements, window.ronin, window.ethereum). */
export class WalletDiscovery {
  constructor(host = window) {
    this.host = host;
    this.announced = new Map();
    this.onAnnounce = (event) => {
      const detail = event.detail;
      if (isProvider(detail?.provider) && typeof detail.info?.name === 'string' && detail.info.name.trim()) {
        this.announced.set(detail.provider, { name: detail.info.name.trim().slice(0, 80), provider: detail.provider });
      }
    };
    host.addEventListener('eip6963:announceProvider', this.onAnnounce);
    this.request();
  }

  request() { this.host.dispatchEvent(new Event('eip6963:requestProvider')); }

  wallets() {
    const found = new Map(this.announced);
    const add = (provider, name) => { if (isProvider(provider) && !found.has(provider)) found.set(provider, { name, provider }); };
    add(this.host.ronin?.provider, 'Ronin Wallet');
    const ethereum = this.host.ethereum;
    for (const provider of Array.isArray(ethereum?.providers) ? ethereum.providers : [ethereum]) {
      add(provider, provider?.isRonin ? 'Ronin Wallet' : provider?.isMetaMask ? 'MetaMask' : 'EVM 지갑');
    }
    return [...found.values()];
  }

  close() { this.host.removeEventListener('eip6963:announceProvider', this.onAnnounce); }
}

/** Ask for an account and make sure the wallet is on the required network. */
export async function connectWallet(provider, network) {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = Array.isArray(accounts) ? accounts.find((a) => typeof a === 'string') : null;
  if (!address) throw new Error('지갑에서 연결할 계정을 선택하세요.');
  if (network?.chainId) await ensureNetwork(provider, network);
  await assertSession(provider, address, network?.chainId);
  return address.toLowerCase();
}

async function ensureNetwork(provider, network) {
  const chainId = `0x${network.chainId.toString(16)}`;
  const current = await provider.request({ method: 'eth_chainId' });
  if (Number(current) === network.chainId) return;
  const switchChain = () => provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  try { await switchChain(); }
  catch (error) {
    if (Number(error?.code) !== 4902 || !network.rpcUrl) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId, chainName: network.name || 'Ronin Saigon', rpcUrls: [network.rpcUrl], nativeCurrency: { name: 'RON', symbol: 'RON', decimals: 18 } }]
    });
    await switchChain(); // some wallets add a network without switching to it
  }
}

/** The account must still be authorized and on the right network right before signing. */
export async function assertSession(provider, address, chainId) {
  let accounts;
  try { accounts = await provider.request({ method: 'eth_accounts' }); }
  catch (error) { if (![4200, -32601].includes(Number(error?.code))) throw error; accounts = []; }
  // Some Ronin providers answer [] here even after approval; this runs inside an explicit user action.
  if (Array.isArray(accounts) && accounts.length === 0) accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || !accounts.some((a) => typeof a === 'string' && a.toLowerCase() === address.toLowerCase())) {
    throw new Error('지갑 계정이 변경되었거나 잠겼습니다. 지갑을 다시 연결하세요.');
  }
  if (chainId) {
    const current = await provider.request({ method: 'eth_chainId' });
    if (Number(current) !== chainId) throw new Error('지갑 네트워크가 다릅니다. 지갑을 다시 연결하세요.');
  }
}

/** personal_sign of the server's message text, exactly as issued. */
export async function signMessage(provider, address, message, chainId) {
  await assertSession(provider, address, chainId);
  const signature = await provider.request({ method: 'personal_sign', params: [toHex(message), address] });
  await assertSession(provider, address, chainId);
  return signature;
}

/**
 * EIP-712 signing of a typed-data object returned by the payment service. The object is signed
 * as given: domain, amounts and nonces are never rebuilt on the page.
 */
export async function signTypedData(provider, address, request, chainId) {
  if (Number(request?.domain?.chainId) !== chainId) throw new Error('승인 대상과 지갑 네트워크가 다릅니다. 지갑을 다시 연결하세요.');
  await assertSession(provider, address, chainId);
  const EIP712Domain = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' }
  ];
  return provider.request({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify({ ...request, types: { EIP712Domain, ...request.types } })]
  });
}
