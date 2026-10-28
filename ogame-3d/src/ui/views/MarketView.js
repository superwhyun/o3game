/**
 * Market panel: wallet link, CGC shop, purchase progress and owned rights.
 *
 * The wallet is needed in exactly two places: linking it once (an ownership signature) and
 * signing a purchase. Everything else, including receiving rewards, works without it, so
 * phones and other browsers without a wallet can still play.
 */
import { escapeHtml } from '../dom.js';
import { emblemSvg } from '../../data/emblems.js';
import { WalletDiscovery, connectWallet, signMessage, signTypedData, walletErrorMessage } from '../../services/WalletProvider.js';

const STATUS_LABEL = {
  CREATED: '서명 대기', PROCESSING: '결제 처리 중', PAID: '결제 확인', CLAIMED: '지급 준비',
  DELIVERED: '지급 완료', COMPLETED: '완료', EXPIRED: '만료됨', REFUNDED: '환불됨', FAILED: '실패'
};
const DONE = new Set(['DELIVERED', 'COMPLETED']);
const ENDED = new Set(['COMPLETED', 'EXPIRED', 'REFUNDED', 'FAILED']);
const POLL_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shortAddress = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '');
const hours = (seconds) => {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
};

export class MarketView {
  /**
   * @param {HTMLElement} root
   * @param {{ api: object, onRightsChanged: () => Promise<void>|void, notify: (title: string, message: string, kind?: string) => void, host?: Window }} options
   */
  constructor(root, { api, onRightsChanged, notify, host = window }) {
    this.root = root;
    this.api = api;
    this.onRightsChanged = onRightsChanged;
    this.notify = notify;
    this.host = host;
    this.wallet = null;
    this.catalog = null;
    this.orders = [];
    this.busy = null;       // { sku, step } while a purchase or link is running
    this.quantities = {};
    this.discovery = null;
    this.chosen = 0;
    this.error = '';
    root.addEventListener('click', (event) => this.onClick(event));
    root.addEventListener('change', (event) => {
      const input = event.target.closest('[data-qty]');
      if (input) {
        const qty = Math.max(1, Math.min(Number(input.max) || 1, Number(input.value) || 1));
        this.quantities[input.dataset.qty] = qty;
        input.value = qty;
        const product = this.catalog?.products.find((p) => p.id === input.dataset.qty);
        const price = input.closest('.market-product')?.querySelector('.market-price');
        if (product && price) price.innerHTML = this.priceHtml(product, qty);
      }
      if (event.target.matches('[data-provider]')) this.chosen = Number(event.target.value);
    });
  }

  providers() {
    this.discovery ??= new WalletDiscovery(this.host);
    this.discovery.request();
    return this.discovery.wallets();
  }

  async render() {
    this.root.setAttribute('aria-busy', 'true');
    try {
      const [wallet, catalog, orders] = await Promise.all([this.api.getWallet(), this.api.getShopCatalog(), this.api.getShopOrders()]);
      this.wallet = wallet; this.catalog = catalog; this.orders = orders.orders || [];
      this.error = '';
    } catch (error) {
      this.error = error.message || '상점 정보를 불러오지 못했습니다.';
    } finally {
      this.root.removeAttribute('aria-busy');
    }
    this.draw();
    this.resumeOpenOrder();
  }

  draw() {
    if (!this.root.isConnected) return;
    if (this.error && !this.catalog) {
      this.root.innerHTML = `<p class="market-error" role="alert">${escapeHtml(this.error)}</p>`;
      return;
    }
    this.root.innerHTML = `
      ${this.error ? `<p class="market-error" role="alert">${escapeHtml(this.error)}</p>` : ''}
      <div class="market-grid">
        <section class="holo-card market-card" aria-labelledby="market-wallet-title">${this.walletHtml()}</section>
        <section class="holo-card market-card" aria-labelledby="market-rights-title">${this.rightsHtml()}</section>
      </div>
      <section class="market-section" aria-labelledby="market-shop-title">
        <h3 id="market-shop-title">상점 <small>CGC로 구매</small></h3>
        <div class="market-products">${this.productsHtml()}</div>
      </section>
      <section class="market-section" aria-labelledby="market-orders-title">
        <h3 id="market-orders-title">주문 내역</h3>
        ${this.ordersHtml()}
      </section>
      <div class="market-live sr-only" role="status" aria-live="polite"></div>`;
  }

  walletHtml() {
    const w = this.wallet;
    if (!w?.enabled) return '<h3 id="market-wallet-title">지갑</h3><p class="market-muted">CGC 연동이 아직 켜져 있지 않습니다. 상점은 연동이 켜진 뒤에 열립니다.</p>';
    if (w.linked) {
      return `<h3 id="market-wallet-title">지갑</h3>
        <p class="market-wallet-address"><span class="pill ok">연결됨</span> <code title="${escapeHtml(w.address)}">${escapeHtml(shortAddress(w.address))}</code></p>
        <p class="market-muted">CGC 보상은 이 지갑으로 지급됩니다. 연결된 지갑은 변경할 수 없습니다.</p>`;
    }
    const providers = this.providers();
    const canLink = providers.length > 0;
    return `<h3 id="market-wallet-title">지갑</h3>
      <p class="market-muted">괴수 처치 보상(CGC)을 받고 상점을 쓰려면 Ronin 지갑을 한 번 연결합니다. 서명은 소유 확인용이며 가스비가 들지 않습니다. 연결한 지갑은 변경할 수 없습니다.</p>
      ${canLink ? `
        ${providers.length > 1 ? `<label class="field">지갑 선택<select data-provider>${providers.map((p, i) => `<option value="${i}" ${i === this.chosen ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>` : `<p class="market-muted">${escapeHtml(providers[0].name)} 감지됨</p>`}
        <button type="button" class="cmd-btn primary" data-action="link" ${this.busy ? 'disabled' : ''}>${this.busy?.step === 'link' ? '서명 대기 중…' : '지갑 연결 · 소유 확인 서명'}</button>`
      : '<p class="market-notice">이 브라우저에서 지갑을 찾지 못했습니다. PC의 Ronin Wallet 확장 프로그램이 있는 브라우저에서 연결하십시오. 지갑 없이도 플레이할 수 있고, 연결은 한 번만 하면 됩니다.</p>'}`;
  }

  rightsHtml() {
    const rights = this.catalog?.entitlements || { emblems: [], speedupSeconds: 0 };
    return `<h3 id="market-rights-title">보유 권리</h3>
      <dl class="market-rights">
        <div><dt>가속 시간</dt><dd data-speedup-balance>${rights.speedupSeconds > 0 ? hours(rights.speedupSeconds) : '없음'}</dd></div>
        <div><dt>보유 문장</dt><dd class="market-emblems">${rights.emblems.length ? rights.emblems.map((id) => emblemSvg(id, { size: 30 })).join('') : '없음'}</dd></div>
      </dl>
      <p class="market-muted">가속은 건설·연구·함선 생산 대기열의 진행 중 항목에서 사용합니다. 문장은 함대 편성에서 지정합니다.</p>`;
  }

  productsHtml() {
    const products = (this.catalog?.products || []).filter((p) => p.priceMicro);
    if (!products.length) return '<p class="market-muted">판매 중인 상품이 없습니다.</p>';
    const ready = this.wallet?.enabled && this.wallet?.linked;
    const canSign = this.providers().length > 0;
    return products.map((p) => {
      const qty = this.quantities[p.id] || 1;
      const owned = p.kind === 'emblem' && this.catalog.entitlements.emblems.includes(p.emblem);
      const why = !this.wallet?.enabled ? '연동 꺼짐' : !this.wallet.linked ? '지갑 연결 필요' : !canSign ? '이 브라우저에서는 구매할 수 없습니다' : owned ? '보유 중' : !p.available ? '판매 중지' : '';
      const art = p.kind === 'emblem' ? emblemSvg(p.emblem, { size: 44 }) : `<span class="market-art" aria-hidden="true">⏩</span>`;
      return `<article class="market-product ${owned ? 'is-owned' : ''}" data-product="${escapeHtml(p.id)}">
        <div class="market-product-art">${art}</div>
        <h4>${escapeHtml(p.name)}</h4>
        <p class="market-price">${this.priceHtml(p, qty)}</p>
        ${p.kind === 'speedup' ? `<label class="field market-qty">수량<input type="number" data-qty="${escapeHtml(p.id)}" min="1" max="${p.maxQuantity}" value="${qty}" inputmode="numeric"></label>` : ''}
        <button type="button" class="cmd-btn primary" data-buy="${escapeHtml(p.id)}" ${why || this.busy ? 'disabled' : ''}>${escapeHtml(why || (this.busy?.sku === p.id ? '진행 중…' : '구매'))}</button>
      </article>`;
    }).join('');
  }

  priceHtml(product, quantity) {
    const total = (BigInt(product.priceMicro) * BigInt(quantity));
    const text = `${total / 1_000_000n}.${String(total % 1_000_000n).padStart(6, '0')}`;
    return `${escapeHtml(text)} <small>CGC</small>`;
  }

  ordersHtml() {
    if (!this.orders.length) return '<p class="market-muted">아직 주문이 없습니다.</p>';
    return `<table class="market-orders"><thead><tr><th scope="col">상품</th><th scope="col">금액</th><th scope="col">상태</th><th scope="col"></th></tr></thead><tbody>${this.orders.map((o) => `
      <tr data-order="${escapeHtml(o.orderId)}"><td>${escapeHtml(o.name)}${o.quantity > 1 ? ` × ${o.quantity}` : ''}</td><td>${escapeHtml(o.total)} CGC</td>
        <td><span class="pill ${DONE.has(o.status) ? 'ok' : ENDED.has(o.status) ? 'muted' : 'pending'}">${escapeHtml(STATUS_LABEL[o.status] || o.status)}</span></td>
        <td>${o.status === 'CREATED' && o.waiting !== 'payment' ? `<button type="button" class="cmd-btn" data-resume="${escapeHtml(o.orderId)}" ${this.busy ? 'disabled' : ''}>서명 이어하기</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }

  say(message) {
    const live = this.root.querySelector('.market-live');
    if (live) live.textContent = message;
  }

  async onClick(event) {
    const buy = event.target.closest('[data-buy]');
    const resume = event.target.closest('[data-resume]');
    const link = event.target.closest('[data-action="link"]');
    try {
      if (link) await this.linkWallet();
      else if (buy) await this.purchase(buy.dataset.buy);
      else if (resume) await this.finishOrder(resume.dataset.resume);
    } catch (error) {
      this.busy = null;
      this.error = walletErrorMessage(error);
      this.notify('상점', this.error, 'error');
      await this.render();
    }
  }

  provider() {
    const wallets = this.providers();
    const choice = wallets[this.chosen] || wallets[0];
    if (!choice) throw new Error('지갑을 찾지 못했습니다. PC의 Ronin Wallet에서 진행하십시오.');
    return choice.provider;
  }

  async linkWallet() {
    this.busy = { step: 'link' };
    this.draw();
    const provider = this.provider();
    const network = this.wallet.network;
    if (!network) throw new Error('체인 정보를 확인할 수 없습니다. 잠시 후 다시 시도하십시오.');
    const address = await connectWallet(provider, network);
    const challenge = await this.api.requestWalletChallenge(address);
    const signature = await signMessage(provider, address, challenge.message, challenge.chainId);
    await this.api.linkWallet(challenge.challengeId, signature);
    this.busy = null;
    this.notify('지갑 연결', '지갑을 연결했습니다.', 'success');
    await this.onRightsChanged?.();
    await this.render();
  }

  /** Create the order, collect both signatures, then follow it until the rights arrive. */
  async purchase(sku) {
    if (this.busy) return;
    const product = this.catalog.products.find((p) => p.id === sku);
    const quantity = this.quantities[sku] || 1;
    const micro = BigInt(product.priceMicro) * BigInt(quantity);
    const total = `${micro / 1_000_000n}.${String(micro % 1_000_000n).padStart(6, '0')}`;
    if (!this.host.confirm?.(`${product.name}${quantity > 1 ? ` × ${quantity}` : ''}\n결제 금액 ${total} CGC\n지갑 ${shortAddress(this.wallet.address)}\n\n지갑에서 두 번 서명을 요청합니다. 진행할까요?`)) return;
    this.busy = { sku, step: 'create' };
    this.draw();
    const { order } = await this.api.createShopOrder(sku, quantity, crypto.randomUUID());
    this.remember(order.orderId);
    await this.finishOrder(order.orderId);
  }

  remember(orderId) { try { sessionStorage.setItem('oogame.cgcOrder', orderId); } catch { /* optional */ } }
  forget() { try { sessionStorage.removeItem('oogame.cgcOrder'); } catch { /* optional */ } }

  /** After a reload an unfinished order keeps being followed. */
  resumeOpenOrder() {
    let orderId = null;
    try { orderId = sessionStorage.getItem('oogame.cgcOrder'); } catch { /* optional */ }
    const open = orderId && this.orders.find((o) => o.orderId === orderId && !ENDED.has(o.status) && !DONE.has(o.status));
    if (open && !this.busy && open.status !== 'CREATED') void this.follow(orderId).catch(() => {});
    else if (orderId && !open) this.forget();
  }

  async finishOrder(orderId) {
    this.busy = { sku: null, step: 'sign' };
    this.draw();
    let view = await this.api.getShopOrder(orderId);
    for (let tries = 0; !view.signing && view.order.status === 'CREATED' && tries < 20; tries++) {
      this.say('결제를 준비하고 있습니다…');
      await sleep(POLL_MS);
      view = await this.api.getShopOrder(orderId);
    }
    if (view.order.status === 'CREATED') {
      if (!view.signing) throw new Error('결제 준비가 지연되고 있습니다. 잠시 후 주문 내역에서 이어서 진행하십시오.');
      const provider = this.provider();
      const address = await connectWallet(provider, this.wallet.network);
      if (address !== this.wallet.address) throw new Error('연결된 계정의 지갑과 다른 지갑입니다. 지갑 앱에서 연결한 계정을 선택하십시오.');
      const chainId = this.wallet.network.chainId;
      this.say('지갑에서 결제 내용을 서명하십시오 (1/2).');
      const signature = await signTypedData(provider, address, view.signing.authorization, chainId);
      this.say('지갑에서 토큰 사용 승인을 서명하십시오 (2/2).');
      const permitSignature = await signTypedData(provider, address, view.signing.permit, chainId);
      await this.api.authorizeShopOrder(orderId, { signature, permitSignature, permitDeadline: view.signing.permitDeadline });
    }
    await this.follow(orderId);
  }

  async follow(orderId) {
    this.busy = { sku: null, step: 'wait' };
    this.draw();
    const deadline = Date.now() + 10 * 60_000;
    let status = '';
    while (Date.now() < deadline) {
      const { order } = await this.api.getShopOrder(orderId);
      if (order.status !== status) { status = order.status; this.say(`주문 상태: ${STATUS_LABEL[status] || status}`); }
      if (DONE.has(order.status)) {
        this.busy = null; this.forget();
        this.notify('구매 완료', `${order.name}을(를) 받았습니다.`, 'success');
        await this.onRightsChanged?.();
        await this.render();
        return;
      }
      if (ENDED.has(order.status)) {
        this.busy = null; this.forget();
        this.notify('상점', `주문이 ${STATUS_LABEL[order.status]} 상태로 끝났습니다.`, 'error');
        await this.render();
        return;
      }
      await sleep(POLL_MS);
    }
    this.busy = null;
    this.notify('상점', '처리가 길어지고 있습니다. 주문 내역에서 상태를 확인하십시오. 결제는 서버가 계속 처리합니다.', 'warning');
    await this.render();
  }
}
