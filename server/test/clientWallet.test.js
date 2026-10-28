const test = require('node:test');
const assert = require('node:assert/strict');
const { privateKeyToAccount, generatePrivateKey } = require('viem/accounts');
const { recoverMessageAddress, recoverTypedDataAddress } = require('viem');

const load = () => import('../../ogame-3d/src/services/WalletProvider.js');

function fakeProvider({ account, chainId = 1, accounts, onRequest } = {}) {
  const log = [];
  let current = chainId;
  const provider = {
    log,
    async request({ method, params }) {
      log.push({ method, params });
      if (onRequest) { const handled = await onRequest({ method, params, setChain: (id) => { current = id; } }); if (handled !== undefined) return handled; }
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return accounts ?? [account.address];
        case 'eth_chainId': return `0x${current.toString(16)}`;
        case 'wallet_switchEthereumChain': current = Number(params[0].chainId); return null;
        case 'personal_sign': return account.signMessage({ message: { raw: params[0] } });
        case 'eth_signTypedData_v4': { const typed = JSON.parse(params[1]); const { EIP712Domain, ...types } = typed.types; return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message }); }
        default: throw Object.assign(new Error(`unsupported ${method}`), { code: -32601 });
      }
    }
  };
  return provider;
}

test('wallets are found from announcements, window.ronin and window.ethereum without duplicates', async () => {
  const { WalletDiscovery } = await load();
  const ronin = { request: async () => null }, metamask = { request: async () => null, isMetaMask: true }, announced = { request: async () => null };
  const host = new EventTarget();
  host.ronin = { provider: ronin };
  host.ethereum = { providers: [ronin, metamask, { notAProvider: true }] };
  const discovery = new WalletDiscovery(host);
  host.dispatchEvent(Object.assign(new Event('eip6963:announceProvider'), { detail: { provider: announced, info: { name: '  Other Wallet  ' } } }));
  host.dispatchEvent(Object.assign(new Event('eip6963:announceProvider'), { detail: { provider: { request: async () => null }, info: { name: '   ' } } })); // unnamed: ignored
  const names = discovery.wallets().map((w) => w.name).sort();
  assert.deepEqual(names, ['MetaMask', 'Other Wallet', 'Ronin Wallet']);
  assert.equal(discovery.wallets().filter((w) => w.provider === ronin).length, 1);
  discovery.close();
  host.dispatchEvent(Object.assign(new Event('eip6963:announceProvider'), { detail: { provider: { request: async () => null }, info: { name: 'Late' } } }));
  assert.equal(discovery.wallets().some((w) => w.name === 'Late'), false);
});

test('connecting asks for an account, switches or adds the network and re-checks the session', async () => {
  const { connectWallet } = await load();
  const account = privateKeyToAccount(generatePrivateKey());
  const network = { chainId: 202601, name: 'Ronin Saigon', rpcUrl: 'https://rpc.example' };

  const switching = fakeProvider({ account, chainId: 1 });
  assert.equal(await connectWallet(switching, network), account.address.toLowerCase());
  assert.ok(switching.log.some((c) => c.method === 'wallet_switchEthereumChain' && c.params[0].chainId === '0x31769'));

  let unknown = true;
  const adding = fakeProvider({ account, chainId: 1, onRequest: async ({ method, params, setChain }) => {
    if (method === 'wallet_switchEthereumChain' && unknown) throw Object.assign(new Error('unknown chain'), { code: 4902 });
    if (method === 'wallet_addEthereumChain') { unknown = false; assert.equal(params[0].rpcUrls[0], 'https://rpc.example'); return null; }
    if (method === 'wallet_switchEthereumChain') { setChain(202601); return null; }
  } });
  assert.equal(await connectWallet(adding, network), account.address.toLowerCase());
  assert.ok(adding.log.some((c) => c.method === 'wallet_addEthereumChain'));

  const noRpc = fakeProvider({ account, chainId: 1, onRequest: async ({ method }) => { if (method === 'wallet_switchEthereumChain') throw Object.assign(new Error('unknown chain'), { code: 4902 }); } });
  await assert.rejects(connectWallet(noRpc, { chainId: 202601 }), (e) => e.code === 4902);
  await assert.rejects(connectWallet(fakeProvider({ account, accounts: [] }), network), /계정을 선택/);
  const declined = fakeProvider({ account, onRequest: async ({ method }) => { if (method === 'eth_requestAccounts') throw Object.assign(new Error('no'), { code: 4001 }); } });
  await assert.rejects(connectWallet(declined, network), (e) => e.code === 4001);
});

test('a signed ownership message verifies on the server side and a changed account or network is refused', async () => {
  const { signMessage, assertSession } = await load();
  const account = privateKeyToAccount(generatePrivateKey());
  const provider = fakeProvider({ account, chainId: 202601 });
  const message = `game.example wants you to sign in with your Ethereum account:\n${account.address}\n\nLink.\n\nNonce: 1 — 한글`;
  const signature = await signMessage(provider, account.address.toLowerCase(), message, 202601);
  assert.equal((await recoverMessageAddress({ message, signature })).toLowerCase(), account.address.toLowerCase());
  assert.match(provider.log.find((c) => c.method === 'personal_sign').params[0], /^0x[0-9a-f]+$/);

  await assert.rejects(signMessage(fakeProvider({ account, chainId: 1 }), account.address, message, 202601), /네트워크가 다릅니다/);
  const other = privateKeyToAccount(generatePrivateKey());
  await assert.rejects(assertSession(fakeProvider({ account: other, chainId: 202601 }), account.address, 202601), /변경되었거나 잠겼/);
  // Ronin sometimes answers [] to eth_accounts after approval: the session is re-requested once.
  const quirky = fakeProvider({ account, chainId: 202601, onRequest: async ({ method }) => (method === 'eth_accounts' ? [] : undefined) });
  await assertSession(quirky, account.address, 202601);
});

test('payment typed data is signed exactly as issued, bound to the wallet network', async () => {
  const { signTypedData } = await load();
  const account = privateKeyToAccount(generatePrivateKey());
  const provider = fakeProvider({ account, chainId: 202601 });
  const request = {
    domain: { name: 'Metanomic', version: '1', chainId: 202601, verifyingContract: '0x' + '11'.repeat(20) },
    types: { Payment: [{ name: 'paymentId', type: 'string' }, { name: 'amount', type: 'uint256' }] },
    primaryType: 'Payment', message: { paymentId: 'pay_1', amount: '4000000' }
  };
  const signature = await signTypedData(provider, account.address, request, 202601);
  const recovered = await recoverTypedDataAddress({ domain: request.domain, types: request.types, primaryType: 'Payment', message: request.message, signature });
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
  const sent = JSON.parse(provider.log.find((c) => c.method === 'eth_signTypedData_v4').params[1]);
  assert.equal(sent.types.EIP712Domain.length, 4);
  assert.deepEqual(sent.message, request.message);
  await assert.rejects(signTypedData(provider, account.address, { ...request, domain: { ...request.domain, chainId: 1 } }, 202601), /네트워크가 다릅니다/);
});

test('wallet error messages are readable', async () => {
  const { walletErrorMessage } = await load();
  assert.match(walletErrorMessage({ code: 4001 }), /취소/);
  assert.match(walletErrorMessage({ code: -32002 }), /처리 중인 요청/);
  assert.match(walletErrorMessage({ error: { data: { code: 'WALLET_IS_LOCKED' } } }), /잠근 뒤/);
  assert.equal(walletErrorMessage(new Error('boom')), 'boom');
  assert.match(walletErrorMessage(null), /처리하지 못했습니다/);
});
