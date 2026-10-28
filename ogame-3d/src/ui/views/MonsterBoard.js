/**
 * Event monsters currently visible to commanders: health, where they stand, time left,
 * the CGC pool and the damage ranking. A monster that moves is followed by re-reading the list.
 */
import { escapeHtml, formatAmount, formatDuration } from '../dom.js';

const STATUS_LABEL = { SCHEDULED: '출현 예정', ACTIVE: '출현 중', DEFEATED: '처치됨', SETTLING: '보상 정산 중' };

export class MonsterBoard {
  /** @param {HTMLElement} root @param {{ api: object, onShow: (coords: object) => void }} options */
  constructor(root, { api, onShow }) {
    this.root = root;
    this.api = api;
    this.onShow = onShow;
    this.monsters = [];
    this.open = null;
    this.ranking = null;
    this.error = '';
    root.addEventListener('click', (event) => {
      const show = event.target.closest('[data-monster-show]');
      const rank = event.target.closest('[data-monster-rank]');
      if (show) this.onShow(JSON.parse(show.dataset.monsterShow));
      if (rank) void this.toggleRanking(rank.dataset.monsterRank);
    });
  }

  async refresh() {
    try {
      this.monsters = (await this.api.getMonsters()).monsters || [];
      this.error = '';
      if (this.open && !this.monsters.some((m) => m.eventId === this.open)) { this.open = null; this.ranking = null; }
    } catch (error) {
      this.error = error.message || '괴수 정보를 불러오지 못했습니다.';
    }
    this.draw();
  }

  async toggleRanking(eventId) {
    if (this.open === eventId) { this.open = null; this.ranking = null; this.draw(); return; }
    this.open = eventId;
    this.ranking = null;
    this.draw();
    try { this.ranking = await this.api.getMonster(eventId); }
    catch (error) { this.error = error.message; }
    this.draw();
  }

  draw() {
    if (!this.root.isConnected) return;
    if (!this.monsters.length && !this.error) { this.root.hidden = true; this.root.innerHTML = ''; return; }
    this.root.hidden = false;
    this.root.innerHTML = `<header class="monster-board-head"><p class="fleet-eyebrow">SPACE MONSTERS</p><h3>우주괴수 <span>${this.monsters.length}</span></h3></header>
      ${this.error ? `<p class="market-error" role="alert">${escapeHtml(this.error)}</p>` : ''}
      <div class="monster-card-grid">${this.monsters.map((m) => this.cardHtml(m)).join('')}</div>`;
  }

  cardHtml(m) {
    const where = m.location ? `[${m.location.galaxy}:${m.location.system}:${m.location.planet}]` : '미정';
    const left = Math.max(0, Math.floor((new Date(m.endsAt) - Date.now()) / 1000));
    const next = m.nextMoveAt && m.status === 'ACTIVE' ? Math.max(0, Math.floor((new Date(m.nextMoveAt) - Date.now()) / 1000)) : null;
    const active = m.status === 'ACTIVE';
    const rank = this.open === m.eventId && this.ranking?.event?.eventId === m.eventId ? this.ranking : null;
    return `<article class="monster-card" data-monster="${escapeHtml(m.eventId)}">
      <div class="monster-card-top"><strong>${escapeHtml(m.name)}</strong><span class="fleet-status ${active ? 'ready' : ''}">${STATUS_LABEL[m.status] || m.status}</span></div>
      ${m.description ? `<p class="market-muted">${escapeHtml(m.description)}</p>` : ''}
      <div class="monster-hp" role="img" aria-label="체력 ${Number(m.hpPercent).toFixed(1)}%"><span style="width:${Math.max(0, Math.min(100, m.hpPercent))}%"></span></div>
      <dl class="monster-facts">
        <div><dt>체력</dt><dd>${Number(m.hpPercent).toFixed(1)}%</dd></div>
        <div><dt>위치</dt><dd>${where}</dd></div>
        <div><dt>CGC 보상 풀</dt><dd>${escapeHtml(m.pool)}</dd></div>
        <div><dt>종료까지</dt><dd>${formatDuration(left)}</dd></div>
        ${next !== null ? `<div><dt>다음 이동</dt><dd>${formatDuration(next)}</dd></div>` : ''}
        <div><dt>내 피해</dt><dd>${formatAmount(m.mine?.damage || 0)}</dd></div>
      </dl>
      <div class="monster-actions">
        ${active && m.location ? `<button type="button" class="cmd-btn primary" data-monster-show='${escapeHtml(JSON.stringify({ galaxy: m.location.galaxy, system: m.location.system }))}'>작전 지도에서 보기</button>` : ''}
        <button type="button" class="cmd-btn" data-monster-rank="${escapeHtml(m.eventId)}" aria-expanded="${this.open === m.eventId}">피해 순위</button>
      </div>
      ${this.open === m.eventId ? `<div class="monster-ranking">${rank ? this.rankingHtml(rank) : '<p class="market-muted">불러오는 중…</p>'}</div>` : ''}
    </article>`;
  }

  rankingHtml(data) {
    if (!data.ranking.length) return '<p class="market-muted">아직 피해를 입힌 사령관이 없습니다.</p>';
    return `<p class="market-muted">참가 ${data.participants}명 · CGC는 지갑을 연결한 상태에서 입힌 피해 비율로 나눕니다.</p>
      <ol>${data.ranking.map((r) => `<li class="${r.isMe ? 'is-me' : ''}"><span>${r.rank}</span><b>${escapeHtml(r.username)}</b><i>${formatAmount(r.damage)}</i><em>${(r.share * 100).toFixed(1)}%</em></li>`).join('')}</ol>`;
  }
}
