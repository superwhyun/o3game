/**
 * Admin "events" tab: monster types, scheduled events with their payout state, a battle
 * simulator for tuning difficulty, and the CGC shop switches.
 */
import { escapeHtml, formatAmount } from '../dom.js';

const STATUS_LABEL = { SCHEDULED: '예정', ACTIVE: '진행 중', DEFEATED: '처치됨', SETTLING: '정산 중', SETTLED: '정산 완료', EXPIRED: '기간 만료', CANCELLED: '취소됨' };
const CLASSES = ['HEAVY', 'SWARM', 'SPLASH', 'CIVIL'];

export const cgcToMicro = (text) => {
  const match = /^(0|[1-9][0-9]*)(\.([0-9]{1,6}))?$/.exec(String(text).trim());
  if (!match) throw new Error('CGC 금액은 소수점 6자리까지의 양수여야 합니다.');
  return (BigInt(match[1]) * 1_000_000n + BigInt((match[3] || '').padEnd(6, '0'))).toString();
};
export const microToCgc = (micro) => {
  const value = BigInt(micro || '0');
  const fraction = String(value % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  return `${value / 1_000_000n}${fraction ? `.${fraction}` : ''}`;
};

const localInput = (date) => {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const blankUnit = () => ({ unitId: '', name: '', count: 10, wave: 0, combatClass: 'HEAVY', stats: { hull: 100000, shield: 0, attack: 500 }, wreck: { metal: 0, crystal: 0 } });
const blankType = () => ({ typeId: '', name: '', description: '', units: [blankUnit()], techs: { weapons: 0, shield: 0, armor: 0 }, regenPerHour: 0, defaultPoolMicro: '0' });

export class AdminEvents {
  /** @param {HTMLElement} root @param {{ request: (path: string, options?: object) => Promise<any>, ships: () => { id: string, name: string }[], toast: (title: string, message: string, kind?: string) => void }} options */
  constructor(root, { request, ships, toast }) {
    this.root = root;
    this.request = request;
    this.ships = ships;
    this.toast = toast;
    this.types = [];
    this.events = [];
    this.shop = null;
    this.editing = null;
    this.simulation = null;
    root.addEventListener('click', (event) => this.onClick(event));
    root.addEventListener('submit', (event) => { event.preventDefault(); void this.onSubmit(event.target); });
  }

  async load() {
    try {
      const [types, events, shop] = await Promise.all([
        this.request('/api/admin/monsters/types'), this.request('/api/admin/monsters/events'), this.request('/api/admin/shop')
      ]);
      this.types = types.types; this.events = events.events; this.shop = shop;
    } catch (error) {
      this.toast('이벤트', error.message, 'error');
    }
    this.draw();
  }

  draw() {
    this.root.innerHTML = `
      <div class="holo-card admin-card"><div class="card-header"><h3>이벤트 일정</h3></div>${this.eventsHtml()}</div>
      <div class="holo-card admin-card"><div class="card-header"><h3>괴수 종류</h3></div>${this.typesHtml()}</div>
      ${this.editing ? `<div class="holo-card admin-card">${this.editorHtml()}</div>` : ''}
      <div class="holo-card admin-card"><div class="card-header"><h3>전투 시뮬레이터</h3></div>${this.simulatorHtml()}</div>
      <div class="holo-card admin-card"><div class="card-header"><h3>CGC 상점</h3></div>${this.shopHtml()}</div>`;
  }

  // ───── events ─────
  eventsHtml() {
    const now = Date.now();
    const typeOptions = this.types.map((t) => `<option value="${escapeHtml(t.typeId)}" data-pool="${escapeHtml(t.defaultPoolMicro)}">${escapeHtml(t.name)}</option>`).join('');
    const form = this.types.length ? `<form class="admin-form" data-form="event">
        <label>괴수<select name="typeId" required>${typeOptions}</select></label>
        <label>이름(선택)<input name="name" maxlength="80"></label>
        <label>시작<input type="datetime-local" name="startsAt" value="${localInput(now)}" required></label>
        <label>종료<input type="datetime-local" name="endsAt" value="${localInput(now + 7 * 86400_000)}" required></label>
        <label>CGC 보상 풀<input name="pool" value="${escapeHtml(microToCgc(this.types[0].defaultPoolMicro))}" required inputmode="decimal"></label>
        <label>이동 주기(시간)<input type="number" name="moveEveryHours" value="72" min="1" max="720" required></label>
        <label>이동 거리<input type="number" name="maxDistance" value="20" min="1" max="200" required></label>
        <button type="submit" class="cmd-btn primary">이벤트 생성</button></form>` : '<p class="admin-muted">먼저 괴수 종류를 만드십시오.</p>';
    const rows = this.events.map((e) => {
      const where = e.location ? `[${e.location.galaxy}:${e.location.system}:${e.location.planet}]` : '-';
      const payouts = Object.entries(e.payouts || {}).map(([k, n]) => `${k} ${n}`).join(' · ') || '-';
      const live = ['SCHEDULED', 'ACTIVE'].includes(e.status);
      return `<tr data-event="${escapeHtml(e.eventId)}"><td>${escapeHtml(e.name)}</td><td>${STATUS_LABEL[e.status] || e.status}</td><td>${Number(e.hpPercent).toFixed(1)}%</td><td>${where}</td>
        <td>${escapeHtml(e.pool)}</td><td>${escapeHtml(payouts)}${e.waitingForBudget ? ' <b class="warn">예산 부족 대기</b>' : ''}</td>
        <td>${e.top.map((t) => `${escapeHtml(t.username)} ${formatAmount(t.damage)}`).join('<br>') || '-'}</td>
        <td class="admin-row-actions">${live ? `<button type="button" class="cmd-btn" data-cancel="${escapeHtml(e.eventId)}">취소</button>` : ''}${e.status === 'ACTIVE' ? `<button type="button" class="cmd-btn" data-relocate="${escapeHtml(e.eventId)}">즉시 이동</button>` : ''}${['SETTLING', 'SETTLED'].includes(e.status) ? `<button type="button" class="cmd-btn" data-payouts="${escapeHtml(e.eventId)}">지급 내역</button>` : ''}</td></tr>`;
    }).join('');
    return `${form}<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>이름</th><th>상태</th><th>체력</th><th>위치</th><th>풀(CGC)</th><th>지급</th><th>상위 피해</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8">이벤트가 없습니다.</td></tr>'}</tbody></table></div><div class="admin-payouts" data-payout-view></div>`;
  }

  // ───── types ─────
  typesHtml() {
    return `<div class="admin-row-actions"><button type="button" class="cmd-btn primary" data-new-type>새 괴수 종류</button></div>
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ID</th><th>이름</th><th>총 체력</th><th>유닛</th><th>기본 풀</th><th></th></tr></thead><tbody>${this.types.map((t) => {
        const hull = t.units.reduce((sum, u) => sum + u.count * Math.floor(u.stats.hull * (1 + (t.techs?.armor || 0) * 0.1)), 0);
        return `<tr><td>${escapeHtml(t.typeId)}</td><td>${escapeHtml(t.name)}</td><td>${formatAmount(hull)}</td><td>${t.units.map((u) => `${escapeHtml(u.name)}×${u.count}`).join(', ')}</td><td>${escapeHtml(microToCgc(t.defaultPoolMicro))}</td>
          <td class="admin-row-actions"><button type="button" class="cmd-btn" data-edit-type="${escapeHtml(t.typeId)}">편집</button><button type="button" class="cmd-btn" data-delete-type="${escapeHtml(t.typeId)}">삭제</button></td></tr>`;
      }).join('') || '<tr><td colspan="6">등록된 괴수가 없습니다.</td></tr>'}</tbody></table></div>`;
  }

  editorHtml() {
    const t = this.editing;
    const num = (name, value, extra = '') => `<input type="number" name="${name}" value="${escapeHtml(value)}" ${extra} required>`;
    return `<div class="card-header"><h3>${t.__new ? '새 괴수 종류' : escapeHtml(t.name)}</h3></div>
      <form class="admin-form" data-form="type">
        <label>ID<input name="typeId" value="${escapeHtml(t.typeId)}" pattern="[a-z][a-z0-9\\-]{2,40}" ${t.__new ? '' : 'readonly'} required></label>
        <label>이름<input name="name" value="${escapeHtml(t.name)}" maxlength="60" required></label>
        <label>설명<input name="description" value="${escapeHtml(t.description)}" maxlength="300"></label>
        <label>무기 기술${num('weapons', t.techs.weapons, 'min="0" max="100"')}</label>
        <label>방어막 기술${num('shield', t.techs.shield, 'min="0" max="100"')}</label>
        <label>장갑 기술${num('armor', t.techs.armor, 'min="0" max="100"')}</label>
        <label>시간당 재생(%)<input type="number" name="regenPerHour" value="${t.regenPerHour}" min="0" max="100" step="0.1" required></label>
        <label>기본 보상 풀(CGC)<input name="defaultPool" value="${escapeHtml(microToCgc(t.defaultPoolMicro))}" required inputmode="decimal"></label>
        <fieldset class="admin-units"><legend>유닛 (총 2000기까지)</legend>${t.units.map((u, i) => this.unitRow(u, i)).join('')}
          <button type="button" class="cmd-btn" data-add-unit>유닛 추가</button></fieldset>
        <div class="admin-row-actions"><button type="submit" class="cmd-btn primary">저장</button><button type="button" class="cmd-btn" data-cancel-edit>닫기</button></div>
      </form>`;
  }

  unitRow(u, i) {
    return `<div class="admin-unit" data-unit="${i}">
      <label>ID<input name="unitId" value="${escapeHtml(u.unitId)}" pattern="[a-z][a-zA-Z0-9]{1,30}" required></label>
      <label>이름<input name="unitName" value="${escapeHtml(u.name)}" maxlength="60"></label>
      <label>수량<input type="number" name="count" value="${u.count}" min="1" max="2000" required></label>
      <label>웨이브<input type="number" name="wave" value="${u.wave}" min="0" max="7" required></label>
      <label>장갑<input type="number" name="hull" value="${u.stats.hull}" min="1" required></label>
      <label>방어막<input type="number" name="unitShield" value="${u.stats.shield}" min="0" required></label>
      <label>공격력<input type="number" name="attack" value="${u.stats.attack}" min="0" required></label>
      <label>분류<select name="combatClass">${CLASSES.map((c) => `<option ${c === u.combatClass ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>잔해 금속<input type="number" name="wreckMetal" value="${u.wreck.metal}" min="0" required></label>
      <label>잔해 수정<input type="number" name="wreckCrystal" value="${u.wreck.crystal}" min="0" required></label>
      <button type="button" class="cmd-btn" data-remove-unit="${i}" aria-label="유닛 삭제">×</button></div>`;
  }

  // ───── simulator ─────
  simulatorHtml() {
    const result = this.simulation;
    return `<form class="admin-form" data-form="simulate">
        <label>괴수<select name="typeId">${this.types.map((t) => `<option value="${escapeHtml(t.typeId)}">${escapeHtml(t.name)}</option>`).join('')}</select></label>
        ${this.ships().slice(0, 14).map((s) => `<label>${escapeHtml(s.name)}<input type="number" name="fleet:${escapeHtml(s.id)}" value="0" min="0" max="1000000"></label>`).join('')}
        <label>무기 기술<input type="number" name="weapons" value="0" min="0" max="100"></label>
        <label>방어막 기술<input type="number" name="shieldTech" value="0" min="0" max="100"></label>
        <label>장갑 기술<input type="number" name="armorTech" value="0" min="0" max="100"></label>
        <button type="submit" class="cmd-btn primary">시뮬레이션</button></form>
      ${result ? `<dl class="admin-sim"><div><dt>입힌 피해</dt><dd>${formatAmount(result.damage)} / ${formatAmount(result.maxHull)}</dd></div><div><dt>남은 체력</dt><dd>${Number(result.remainingPercent).toFixed(1)}%</dd></div><div><dt>처치 여부</dt><dd>${result.defeated ? '처치' : '생존'}</dd></div><div><dt>함대 손실 가치</dt><dd>${formatAmount(result.attackerLossValue)}</dd></div></dl><p class="admin-muted">1회 전투 결과입니다. 처치까지 필요한 전투 횟수 ≈ ${result.damage > 0 ? Math.ceil(result.maxHull / result.damage) : '∞'}회</p>` : ''}`;
  }

  // ───── shop ─────
  shopHtml() {
    if (!this.shop) return '';
    const types = [['building', '건설'], ['research', '연구'], ['ship', '함선 생산']];
    return `<p class="admin-muted">CGC 연동: <b>${this.shop.enabled ? '켜짐' : '꺼짐'}</b></p>
      <form class="admin-form" data-form="shop">
        <fieldset><legend>판매 중지할 상품</legend>${this.shop.products.map((p) => `<label class="admin-check"><input type="checkbox" name="disabled" value="${escapeHtml(p.id)}" ${this.shop.disabled.includes(p.id) ? 'checked' : ''}> ${escapeHtml(p.name)} · ${escapeHtml(p.price)} CGC</label>`).join('')}</fieldset>
        <fieldset><legend>가속을 쓸 수 있는 대기열</legend>${types.map(([id, label]) => `<label class="admin-check"><input type="checkbox" name="speedup" value="${id}" ${this.shop.allowedTypes.includes(id) ? 'checked' : ''}> ${label}</label>`).join('')}</fieldset>
        <button type="submit" class="cmd-btn primary">상점 설정 저장</button></form>`;
  }

  // ───── actions ─────
  async onClick(event) {
    const el = (selector) => event.target.closest(selector);
    try {
      if (el('[data-new-type]')) { this.editing = { ...blankType(), __new: true }; this.draw(); }
      else if (el('[data-edit-type]')) { this.editing = structuredClone(this.types.find((t) => t.typeId === el('[data-edit-type]').dataset.editType)); this.draw(); }
      else if (el('[data-cancel-edit]')) { this.editing = null; this.draw(); }
      else if (el('[data-add-unit]')) { this.collectEditor(); this.editing.units.push(blankUnit()); this.draw(); }
      else if (el('[data-remove-unit]')) { this.collectEditor(); this.editing.units.splice(Number(el('[data-remove-unit]').dataset.removeUnit), 1); this.draw(); }
      else if (el('[data-delete-type]')) {
        const id = el('[data-delete-type]').dataset.deleteType;
        if (window.confirm(`${id} 괴수 종류를 삭제하시겠습니까?`)) { await this.request(`/api/admin/monsters/types/${encodeURIComponent(id)}`, { method: 'DELETE' }); await this.load(); }
      } else if (el('[data-cancel]')) {
        if (window.confirm('이벤트를 취소하면 보상이 지급되지 않습니다. 취소할까요?')) { await this.request(`/api/admin/monsters/events/${el('[data-cancel]').dataset.cancel}/cancel`, { method: 'POST', body: '{}' }); await this.load(); }
      } else if (el('[data-relocate]')) {
        await this.request(`/api/admin/monsters/events/${el('[data-relocate]').dataset.relocate}/relocate`, { method: 'POST', body: '{}' }); await this.load();
      } else if (el('[data-payouts]')) {
        await this.showPayouts(el('[data-payouts]').dataset.payouts);
      } else if (el('[data-retry]')) {
        await this.request(`/api/admin/monsters/payouts/${encodeURIComponent(el('[data-retry]').dataset.retry)}/retry`, { method: 'POST', body: '{}' });
        this.toast('이벤트', '지급을 다시 시도합니다.', 'success'); await this.load();
      }
    } catch (error) { this.toast('이벤트', error.message, 'error'); }
  }

  async showPayouts(eventId) {
    const { payouts } = await this.request(`/api/admin/monsters/events/${eventId}/payouts`);
    const target = this.root.querySelector('[data-payout-view]');
    target.innerHTML = `<table class="admin-table"><thead><tr><th>대상</th><th>금액(CGC)</th><th>상태</th><th>사유</th><th></th></tr></thead><tbody>${payouts.map((p) => `<tr><td>${escapeHtml(String(p.userId))}</td><td>${escapeHtml(microToCgc(p.amountMicro))}</td><td>${escapeHtml(p.status)}</td><td>${escapeHtml(p.lastError || '')}</td><td>${p.status === 'FAILED' ? `<button type="button" class="cmd-btn" data-retry="${escapeHtml(p.rewardRef)}">재시도</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">지급 내역이 없습니다.</td></tr>'}</tbody></table>`;
  }

  /** Read the editor form back into this.editing without saving it. */
  collectEditor() {
    const form = this.root.querySelector('[data-form="type"]');
    if (!form) return;
    const get = (name, scope = form) => scope.elements[name]?.value;
    const t = this.editing;
    Object.assign(t, { typeId: get('typeId'), name: get('name'), description: get('description'), regenPerHour: Number(get('regenPerHour')) });
    t.techs = { weapons: Number(get('weapons')), shield: Number(get('shield')), armor: Number(get('armor')) };
    try { t.defaultPoolMicro = cgcToMicro(get('defaultPool')); } catch { /* validated on save */ }
    t.units = [...form.querySelectorAll('[data-unit]')].map((row) => {
      const field = (name) => row.querySelector(`[name="${name}"]`).value;
      return {
        unitId: field('unitId'), name: field('unitName'), count: Number(field('count')), wave: Number(field('wave')), combatClass: field('combatClass'),
        stats: { hull: Number(field('hull')), shield: Number(field('unitShield')), attack: Number(field('attack')) },
        wreck: { metal: Number(field('wreckMetal')), crystal: Number(field('wreckCrystal')) }
      };
    });
  }

  async onSubmit(form) {
    try {
      const kind = form.dataset.form;
      const data = new FormData(form);
      if (kind === 'type') {
        this.collectEditor();
        const { __new, ...type } = this.editing;
        await this.request('/api/admin/monsters/types', { method: 'PUT', body: JSON.stringify(type) });
        this.editing = null;
        this.toast('이벤트', '괴수 종류를 저장했습니다.', 'success');
        await this.load();
      } else if (kind === 'event') {
        await this.request('/api/admin/monsters/events', { method: 'POST', body: JSON.stringify({
          typeId: data.get('typeId'), name: data.get('name') || undefined, startsAt: new Date(data.get('startsAt')).toISOString(), endsAt: new Date(data.get('endsAt')).toISOString(),
          poolMicro: cgcToMicro(data.get('pool')), moveEveryHours: Number(data.get('moveEveryHours')), maxDistance: Number(data.get('maxDistance'))
        }) });
        this.toast('이벤트', '이벤트를 만들었습니다.', 'success');
        await this.load();
      } else if (kind === 'simulate') {
        const type = this.types.find((t) => t.typeId === data.get('typeId'));
        if (!type) throw new Error('괴수 종류를 선택하십시오.');
        const fleet = {};
        for (const [key, value] of data.entries()) if (key.startsWith('fleet:') && Number(value) > 0) fleet[key.slice(6)] = Number(value);
        const { typeId, name, description, units, techs, regenPerHour, defaultPoolMicro, model } = type;
        this.simulation = await this.request('/api/admin/monsters/simulate', { method: 'POST', body: JSON.stringify({
          type: { typeId, name, description, units, techs, regenPerHour, defaultPoolMicro, model }, fleet,
          attackerTechs: { weapons: Number(data.get('weapons')), shield: Number(data.get('shieldTech')), armor: Number(data.get('armorTech')) }
        }) });
        this.draw();
      } else if (kind === 'shop') {
        await this.request('/api/admin/shop/disabled', { method: 'PUT', body: JSON.stringify({ disabled: data.getAll('disabled') }) });
        await this.request('/api/admin/shop/speedup', { method: 'PUT', body: JSON.stringify({ allowedTypes: data.getAll('speedup') }) });
        this.toast('이벤트', '상점 설정을 저장했습니다.', 'success');
        await this.load();
      }
    } catch (error) { this.toast('이벤트', error.message, 'error'); }
  }
}
