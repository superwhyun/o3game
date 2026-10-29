import { escapeHtml as e } from "../dom.js";
import "../account-settings.css";
const strategies = {
  balanced: "균형 발전",
  economy: "경제 성장",
  expansion: "식민지 확장",
  military: "군사 강화",
};
export class AccountSettingsView {
  constructor(root, { api, onMode, onToken }) {
    Object.assign(this, { root, api, onMode, onToken });
    this.activeTab = 'account';
    this.statusTimer = setInterval(() => void this.refreshStatus(), 15000);
    root.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.save(event.target);
    });
    root.addEventListener("click", (event) => {
      const tab = event.target.closest('[data-settings-tab]');
      if (tab) this.selectTab(tab.dataset.settingsTab);
      if (event.target.closest("[data-settings-refresh]")) void this.show();
      if (event.target.closest("[data-delegate-stop]")) void this.stop();
    });
  }
  selectTab(tab) {
    this.activeTab = tab === 'ai' ? 'ai' : 'account';
    for (const button of this.root.querySelectorAll('[data-settings-tab]')) button.setAttribute('aria-selected', String(button.dataset.settingsTab === this.activeTab));
    for (const pane of this.root.querySelectorAll('[data-settings-pane]')) pane.hidden = pane.dataset.settingsPane !== this.activeTab;
  }
  async show() {
    this.root.innerHTML = '<p role="status">사용자 설정을 불러오는 중…</p>';
    const token = this.api.token;
    try {
      const [data, list] = await Promise.all([
        this.api.getAccountSettings(),
        this.api.getDelegationModels(),
      ]);
      if (token !== this.api.token) return;
      this.data = data;
      this.models = list.models;
      this.render();
    } catch (error) {
      if (token === this.api.token)
        this.root.innerHTML = `<p role="alert">${e(error.message)}</p><button class="cmd-btn" data-settings-refresh>다시 불러오기</button>`;
    }
  }
  async refreshStatus() {
    if (!this.data || this.refreshing || document.hidden || !this.root.querySelector('[data-settings-pane=ai]:not([hidden])') || !this.root.getClientRects().length || this.root.querySelector('[data-busy]')) return;
    const token = this.api.token;
    this.refreshing = true;
    try {
      const data = await this.api.getAccountSettings();
      if (token !== this.api.token) return;
      this.data.delegation = data.delegation;
      this.data.worker = data.worker;
      const status = this.root.querySelector('.delegation-status');
      if (status) status.innerHTML = this.statusHtml(data.delegation);
      const history = this.root.querySelector('.delegation-history');
      if (history) {
        const opened = new Set([...history.querySelectorAll('details[open]')].map(item => item.dataset.run));
        history.innerHTML = this.historyHtml(data.delegation);
        for (const item of history.querySelectorAll('details')) item.open = opened.has(item.dataset.run);
      }
      const worker = this.root.querySelector('.delegation-worker');
      if (worker) worker.textContent = `실행 프로그램: ${!data.worker.configured ? '관리자 설정 필요' : data.worker.connected ? '연결됨' : '연결 대기'}`;
    } catch (error) {
      const status = this.root.querySelector('[data-delegation-refresh-error]');
      if (status && token === this.api.token) status.textContent = `상태 갱신 실패: ${error.message}`;
    } finally { this.refreshing = false; }
  }
  statusHtml(p) {
    const sleeping = p?.nextRunAt && new Date(p.nextRunAt).getTime() > Date.now() + 1000;
    const label = !p?.enabled ? '중지' : p.running ? '판단·실행 중' : sleeping ? '휴식 · 다음 확인 예약' : '계속 실행 · 다음 판단 차례 대기';
    return `<p>상태: ${label} · 실행 ${p?.runs || 0}회 / 행동 ${p?.actions || 0}회</p><p>최근 행동: ${e(p?.lastAction || '아직 없음')}</p><p>판단 이유: ${e(p?.lastReason || '아직 없음')}</p>${p?.lastErrorCode ? `<p class="area-warning">최근 오류: ${e(p.lastErrorCode)}</p>` : ''}<p>개선 제안: ${p?.suggestions || 0}건${p?.lastSuggestionAt ? ` · 최근 ${e(new Date(p.lastSuggestionAt).toLocaleString("ko-KR"))}` : ""}</p>${p?.lastSuggestionErrorCode ? `<p class="area-warning">제안 결과: ${e(p.lastSuggestionErrorCode)}</p>` : ""}${p?.lastRunAt ? `<p>최근 실행: ${e(new Date(p.lastRunAt).toLocaleString('ko-KR'))}</p>` : ''}${p?.enabled && p.nextRunAt ? `<p>다음 판단: ${sleeping ? e(new Date(p.nextRunAt).toLocaleString('ko-KR')) : '즉시 · 앞선 작업 처리 후'}</p>` : ''}<small>AI 탭을 보고 있을 때 15초마다 자동 갱신</small><p data-delegation-refresh-error role="status"></p>`;
  }
  historyHtml(p) {
    return `<h4>최근 AI 실행 기록</h4>${p?.history?.length ? p.history.map(entry => `<details class="delegation-log" data-run="${e(entry.runId || entry.at)}"><summary><time>${e(new Date(entry.at).toLocaleString('ko-KR'))}</time><b>${entry.errorCode ? '오류' : entry.acted ? '실행' : entry.recheck ? '재판단' : '휴식'}</b><span>${e(entry.action)}</span></summary><p>${e(entry.reason || '')}</p>${entry.suggestionSubmitted ? '<p>개선 제안을 등록했습니다.</p>' : ''}${entry.suggestionErrorCode ? `<p>제안 결과: ${e(entry.suggestionErrorCode)}</p>` : ''}${entry.errorCode ? `<p class="area-warning">${e(entry.errorCode)}</p>` : ''}</details>`).join('') : '<p class="detail-muted">저장된 실행 기록이 없습니다. 다음 판단부터 최근 50건을 저장합니다.</p>'}`;
  }
  message(form, value, failed = false) {
    const status = form.querySelector("[data-settings-status]");
    status.textContent = value;
    status.setAttribute("role", failed ? "alert" : "status");
  }
  async save(form) {
    if (form.dataset.busy) return;
    const data = new FormData(form),
      section = form.dataset.settingsForm;
    const token = this.api.token;
    form.dataset.busy = "true";
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((b) => {
      b.disabled = true;
    });
    this.message(form, "저장 중…");
    try {
      let result;
      if (section === "mode") {
        result = await this.api.saveUiMode(data.get("uiMode"));
        if (token !== this.api.token) return;
        this.data.account = result.account;
        this.onMode(result.account.preferences.uiMode);
      } else if (section === "email") {
        result = await this.api.changeEmail(
          data.get("email"),
          data.get("currentPassword"),
        );
        if (token !== this.api.token) return;
        this.data.account = result.account;
      } else if (section === "password") {
        if (data.get("newPassword") !== data.get("confirmPassword"))
          throw Error("새 비밀번호 확인이 일치하지 않습니다.");
        result = await this.api.changePassword(
          data.get("currentPassword"),
          data.get("newPassword"),
        );
        if (token !== this.api.token) return;
        this.api.setToken(result.token);
        this.onToken(result.token);
        this.data.delegation = this.data.delegation
          ? { ...this.data.delegation, enabled: false, running: false }
          : null;
        const delegateForm = this.root.querySelector(
          '[data-settings-form="delegation"]',
        );
        delegateForm.querySelector('[name="enabled"]').checked = false;
        const delegateStatus = delegateForm.querySelector(
          ".delegation-status p",
        );
        delegateStatus.textContent = `상태: 중지 · 실행 ${this.data.delegation?.runs || 0}회 / 행동 ${this.data.delegation?.actions || 0}회`;
      } else if (section === "delegation") {
        result = await this.api.saveDelegation({
          modelId: data.get("modelId"),
          strategy: data.get("strategy"),
          enabled: data.get("enabled") === "on",
          allowAttacks: data.get("allowAttacks") === "on",
          proposeImprovements: data.get("proposeImprovements") === "on",
          intervalSeconds: Number(data.get("intervalSeconds")),
          maxColonies: Number(data.get("maxColonies")),
        });
        if (token !== this.api.token) return;
        this.data.delegation = result.delegation;
        this.render();
        this.message(
          this.root.querySelector('[data-settings-form="delegation"]'),
          result.delegation.enabled
            ? "AI 대리를 시작했습니다."
            : "AI 대리를 중지했습니다.",
        );
        return;
      }
      if (section !== "password" && token !== this.api.token) return;
      form.querySelectorAll("input[type=password]").forEach((input) => {
        input.value = "";
      });
      this.message(
        form,
        section === "password"
          ? "비밀번호를 변경했습니다. 다른 로그인 세션과 AI 대리는 해제되었습니다."
          : "저장했습니다.",
      );
    } catch (error) {
      if (token === this.api.token) this.message(form, error.message, true);
    } finally {
      delete form.dataset.busy;
      buttons.forEach((b) => {
        b.disabled = false;
      });
    }
  }
  async stop() {
    const form = this.root.querySelector('[data-settings-form="delegation"]');
    if (form.dataset.busy) return;
    const token = this.api.token;
    form.dataset.busy = "true";
    form.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    });
    try {
      const result = await this.api.saveDelegation({ enabled: false });
      if (token !== this.api.token) return;
      this.data.delegation = result.delegation;
      this.render();
      this.message(
        this.root.querySelector('[data-settings-form="delegation"]'),
        "AI 대리를 중지했습니다.",
      );
    } catch (error) {
      if (token === this.api.token) {
        delete form.dataset.busy;
        form.querySelectorAll("button").forEach((b) => {
          b.disabled = false;
        });
        this.message(form, error.message, true);
      }
    }
  }
  render() {
    const { account, delegation: p, worker } = this.data;
    const status =
      '<p data-settings-status role="status" aria-live="polite"></p>';
    const password =
      '<label>현재 비밀번호<input type="password" name="currentPassword" autocomplete="current-password" required maxlength="128"></label>';
    const models = this.models
      .map(
        (m) =>
          `<option value="${e(m.id)}" ${String(p?.modelId) === m.id || (!p && m.isDefault) ? "selected" : ""}>${e(m.name)} · ${e(m.model)}</option>`,
      )
      .join("");
    this.root.innerHTML = `<div class="account-settings-header"><p>${e(account.username)} · 사용자 설정</p><button class="cmd-btn" data-settings-refresh>새로고침</button></div>
      <div class="account-settings-tabs" role="tablist" aria-label="설정 그룹"><button type="button" id="settings-account-tab" role="tab" aria-controls="settings-account-pane" data-settings-tab="account">계정·화면</button><button type="button" id="settings-ai-tab" role="tab" aria-controls="settings-ai-pane" data-settings-tab="ai">AI 대리</button></div>
      <div class="account-settings-pane" id="settings-account-pane" role="tabpanel" aria-labelledby="settings-account-tab" data-settings-pane="account"><div class="account-settings-grid">
      <form data-settings-form="mode" class="holo-card account-settings-card"><h3>화면 모드</h3><div class="mode-options">${[
        ["simple", "심플", "핵심 수치와 작업 버튼을 간결하게 표시합니다."],
        ["detailed", "상세", "설명과 세부 수치를 함께 표시합니다."],
        [
          "graphics",
          "그래픽",
          "자원·생산·주거·에너지 현황을 그래프로 표시합니다.",
        ],
      ]
        .map(
          ([value, label, description]) =>
            `<label title="${e(description)}"><input type="radio" name="uiMode" value="${value}" ${account.preferences.uiMode === value ? "checked" : ""}><span><strong>${label}</strong><small>${description}</small></span></label>`,
        )
        .join(
          "",
        )}</div>${status}<button class="cmd-btn" type="submit">화면 모드 저장</button></form>
      <form data-settings-form="email" class="holo-card account-settings-card"><h3>이메일 변경</h3><label>이메일<input type="email" name="email" value="${e(account.email)}" autocomplete="email" maxlength="254" required></label>${password}${status}<button class="cmd-btn" type="submit">이메일 변경</button></form>
      <form data-settings-form="password" class="holo-card account-settings-card"><h3>비밀번호 변경</h3>${password}<label>새 비밀번호<input type="password" name="newPassword" autocomplete="new-password" minlength="6" maxlength="128" required></label><label>새 비밀번호 확인<input type="password" name="confirmPassword" autocomplete="new-password" minlength="6" maxlength="128" required></label><p class="detail-muted">6자 이상, UTF-8 기준 72바이트 이하. 변경하면 다른 로그인 세션과 AI 대리가 해제됩니다.</p>${status}<button class="cmd-btn" type="submit">비밀번호 변경</button></form>
      </div></div><div class="account-settings-pane" id="settings-ai-pane" role="tabpanel" aria-labelledby="settings-ai-tab" data-settings-pane="ai"><form data-settings-form="delegation" class="holo-card account-settings-card delegation-card"><h3>AI 대리</h3><p class="detail-muted">모든 행성의 현황을 보고 필요한 작업을 이어서 처리합니다. 로그아웃 후에도 동작하며, 대리 중에도 직접 플레이할 수 있습니다.</p><p class="delegation-worker">실행 프로그램: ${!worker.configured ? "관리자 설정 필요" : worker.connected ? "연결됨" : "연결 대기"}</p>
      <label class="account-check"><input type="checkbox" name="enabled" ${p?.enabled ? "checked" : ""}> AI 대리 사용</label><label>AI 모델<select name="modelId" ${!models ? "disabled" : ""}>${models || '<option value="">사용 가능한 등록 모델 없음</option>'}</select></label>
      <label>전략<select name="strategy">${Object.entries(strategies)
        .map(
          ([id, label]) =>
            `<option value="${id}" ${p?.strategy === id ? "selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select></label><div class="account-settings-pair"><label>대기 후 재확인(초)<input type="number" name="intervalSeconds" min="120" max="3600" step="1" value="${Math.max(120, p?.intervalSeconds ?? 180)}" required></label><label>대리의 목표 최대 행성 수<input type="number" name="maxColonies" min="1" max="9" step="1" value="${p?.maxColonies ?? 3}" required></label></div><p class="detail-muted">실행할 일이 있으면 계속 판단합니다. 대기 시 설정한 간격(최소 2분) 후 다시 확인하며, 여러 계정의 작업은 순차 처리합니다.</p><label class="account-check"><input type="checkbox" name="allowAttacks" ${p?.allowAttacks ? "checked" : ""}> 다른 사용자 공격 허용</label><label class="account-check"><input type="checkbox" name="proposeImprovements" ${p?.proposeImprovements !== false ? 'checked' : ''}> 개선사항 자동 제안</label><p class="detail-muted">실제 플레이 중 확인한 문제와 개선 아이디어를 개선 요청 목록에 등록합니다. 중복을 확인하며 최대 6시간에 1건 제안합니다.</p>
      <div class="delegation-status">${this.statusHtml(p)}</div><div class="delegation-history">${this.historyHtml(p)}</div>
      ${status}<div class="account-settings-actions"><button class="cmd-btn" type="submit" ${!models ? "disabled" : ""}>대리 설정 저장</button><button class="cmd-btn" type="button" data-delegate-stop>대리 중지</button></div></form></div>`;
    this.selectTab(this.activeTab);
  }
}
