import { escapeHtml } from '../dom.js';
import '../improvements.css';
const DECISIONS = { implemented: '반영', partial: '부분 반영', rejected: '거부' };

export class ImprovementRequestsView {
  constructor(root, api, isAdmin) {
    this.root = root;
    this.api = api;
    this.isAdmin = isAdmin;
    this.generation = 0;
  }

  reset() {
    ++this.generation;
    this.requests = [];
    this.root.replaceChildren();
  }

  show() {
    const generation = ++this.generation;
    this.busy = false;
    this.requests = [];
    this.nextCursor = null;
    this.filter = 'all';
    this.root.innerHTML = `
      <details class="improvement-compose">
        <summary>개선 제안 작성</summary>
        <form class="improvement-form">
          <label>제목<input name="title" maxlength="100" required placeholder="어떤 점을 개선하면 좋을까요?"></label>
          <label>내용<textarea name="description" maxlength="2000" rows="4" required placeholder="불편했던 상황이나 원하는 기능을 알려 주세요."></textarea></label>
          <div class="improvement-actions"><span>제안은 모든 사용자에게 공개됩니다.</span><button class="holo-btn-small" type="submit">제안 등록</button></div>
        </form>
      </details>
      <div class="improvement-list-heading"><h3>개선 요청 목록</h3><button class="holo-btn-small" data-refresh>새로고침</button></div>
      <label class="improvement-filter">처리 상태<select data-filter><option value="all">전체</option><option value="pending">검토 대기</option><option value="reviewed">확인 완료</option>${Object.entries(DECISIONS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
      <p class="improvement-message" role="status" aria-live="polite"></p>
      <div class="improvement-list"></div>
      <button class="holo-btn-small" data-more hidden>더 보기</button>`;
    this.message = this.root.querySelector('.improvement-message');
    const form = this.root.querySelector('form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (this.busy) return;
      const title = form.elements.title.value.trim();
      const description = form.elements.description.value.trim();
      if (!title || !description) { this.message.textContent = '제목과 내용을 입력해 주세요.'; return; }
      this.setBusy(true);
      try {
        const { request } = await this.api.createImprovementRequest(title, description);
        if (generation !== this.generation) return;
        form.reset();
        this.requests.unshift(request);
        this.renderList();
        this.message.textContent = '개선 제안을 등록했습니다.';
      } catch (error) {
        if (generation === this.generation) this.message.textContent = error.message;
      } finally { if (generation === this.generation) this.setBusy(false); }
    });
    this.root.querySelector('[data-refresh]').addEventListener('click', () => this.load(false, generation));
    this.root.querySelector('[data-more]').addEventListener('click', () => this.load(true, generation));
    this.root.querySelector('.improvement-list').addEventListener('click', event => this.handleDelete(event, generation));
    this.root.querySelector('.improvement-list').addEventListener('submit', event => this.handleReview(event, generation));
    this.root.querySelector('[data-filter]').addEventListener('change', event => {
      this.filter = event.target.value;
      this.nextCursor = null;
      this.load(false, generation);
    });
    this.load(false, generation);
  }

  async load(append, generation) {
    if (this.busy) return;
    this.setBusy(true);
    this.message.textContent = '목록을 불러오는 중…';
    try {
      const result = await this.api.getImprovementRequests(append ? this.nextCursor : null, this.filter);
      if (generation !== this.generation) return;
      const all = append ? [...this.requests, ...result.requests] : result.requests;
      this.requests = [...new Map(all.map(item => [item._id, item])).values()];
      this.nextCursor = result.nextCursor;
      this.renderList();
      this.message.textContent = '';
    } catch (error) {
      if (generation === this.generation) this.message.textContent = error.message;
    } finally {
      if (generation === this.generation) {
        this.setBusy(false);
      }
    }
  }

  setBusy(value) {
    this.busy = value;
    this.root.querySelectorAll('button, [data-filter]').forEach(button => { button.disabled = value; });
  }

  matchesFilter(item) {
    return this.filter === 'all' || item.decision === this.filter ||
      (this.filter === 'pending' && item.reviewStatus !== 'reviewed') ||
      (this.filter === 'reviewed' && item.reviewStatus === 'reviewed');
  }

  renderList() {
    const visible = this.requests.filter(item => this.matchesFilter(item));
    this.root.querySelector('.improvement-list').innerHTML = visible.length ? visible.map(item => `
      <article class="improvement-card" data-id="${escapeHtml(item._id)}">
        <details class="improvement-item">
        <summary class="improvement-row"><strong>${escapeHtml(item.title)}</strong><span class="improvement-row-author">${escapeHtml(item.authorName)}</span><time>${escapeHtml(new Date(item.createdAt).toLocaleDateString('ko-KR'))}</time><b class="review-${escapeHtml(item.decision || 'pending')}">${escapeHtml(DECISIONS[item.decision] || (item.reviewStatus === 'reviewed' ? '확인 완료' : '검토 대기'))}</b></summary>
        <div class="improvement-item-body">
        <div class="improvement-card-heading"><h4>${escapeHtml(item.title)}</h4>${this.isAdmin() ? '<button class="holo-btn-small" data-delete>삭제</button>' : ''}</div>
        <div class="improvement-meta">${item.authorType === "ai" ? '<span class="improvement-ai-badge">AI 제안</span> ' : ''}${escapeHtml(item.authorName)} · ${escapeHtml(new Date(item.createdAt).toLocaleString('ko-KR'))}</div>
        <div class="improvement-review-status"><span>${item.reviewStatus === 'reviewed' ? '확인 완료' : '접수'}</span>${item.decision ? `<b class="review-${escapeHtml(item.decision)}">${escapeHtml(DECISIONS[item.decision] || item.decision)}</b>` : ''}</div>
        <p class="improvement-description">${escapeHtml(item.description)}</p>
        ${item.reviewStatus === 'reviewed' ? `<section class="improvement-review-note"><h5>처리 설명</h5><p>${escapeHtml(item.reviewNote || '')}</p><small>${escapeHtml(item.reviewerName || '운영 검토')} · ${escapeHtml(new Date(item.reviewedAt).toLocaleString('ko-KR'))}</small></section>` : ''}
        ${this.isAdmin() ? `<details class="improvement-review-editor"><summary>검토 결과 ${item.decision ? '수정' : '작성'}</summary><form class="improvement-review-form"><label>처리 결과<select name="decision">${Object.entries(DECISIONS).map(([key, label]) => `<option value="${key}" ${key === item.decision ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>처리 설명<textarea name="reviewNote" required maxlength="2000" rows="3">${escapeHtml(item.reviewNote || '')}</textarea></label><button type="submit" class="holo-btn-small">확인 완료로 저장</button></form></details>` : ''}
        <div class="improvement-confirm" hidden><span>이 요청을 삭제할까요?</span><button class="holo-btn-small" data-confirm>삭제 확인</button><button class="holo-btn-small" data-cancel>취소</button></div>
        </div></details>
      </article>`).join('') : '<p class="improvement-empty">해당하는 개선 요청이 없습니다.</p>';
    this.root.querySelector('[data-more]').hidden = !this.nextCursor;
  }

  async handleReview(event, generation) {
    const form = event.target.closest('.improvement-review-form');
    if (!form) return;
    event.preventDefault();
    if (!this.isAdmin() || this.busy) return;
    const id = form.closest('[data-id]').dataset.id;
    this.setBusy(true);
    try {
      const { request } = await this.api.reviewImprovementRequest(id, form.elements.decision.value, form.elements.reviewNote.value.trim());
      if (generation !== this.generation) return;
      this.requests = this.requests.map(item => item._id === id ? request : item);
      this.renderList();
      this.message.textContent = '검토 결과를 저장했습니다.';
    } catch (error) {
      if (generation === this.generation) this.message.textContent = error.message;
    } finally { if (generation === this.generation) this.setBusy(false); }
  }

  async handleDelete(event, generation) {
    const button = event.target.closest('button');
    const card = button?.closest('[data-id]');
    if (!card || !this.isAdmin() || this.busy) return;
    const confirmation = card.querySelector('.improvement-confirm');
    if (button.hasAttribute('data-delete')) { confirmation.hidden = false; return; }
    if (button.hasAttribute('data-cancel')) { confirmation.hidden = true; return; }
    if (!button.hasAttribute('data-confirm')) return;
    this.setBusy(true);
    try {
      await this.api.deleteImprovementRequest(card.dataset.id);
      if (generation !== this.generation) return;
      this.requests = this.requests.filter(item => item._id !== card.dataset.id);
      this.renderList();
      this.message.textContent = '개선 요청을 삭제했습니다.';
    } catch (error) {
      if (generation === this.generation) {
        this.message.textContent = error.message;
      }
    } finally { if (generation === this.generation) this.setBusy(false); }
  }
}
