import { adminService } from "../../services/AdminService.js";
import { apiService } from "../../services/ApiService.js";
import { escapeHtml as esc } from "../dom.js";
import "../ai-players.css";
const strategies = {
  balanced: "균형",
  economy: "경제",
  expansion: "확장",
  military: "군사",
};
const providers = {
  openrouter: "OpenRouter",
  vercel: "Vercel AI Gateway",
  compatible: "로컬 / OpenAI 호환 API",
};
const options = (items, selected) =>
  Object.entries(items)
    .map(
      ([id, name]) =>
        `<option value="${esc(id)}" ${id === selected ? "selected" : ""}>${esc(name)}</option>`,
    )
    .join("");
export class AiPlayersView {
  constructor(root) {
    this.root = root;
    this.models = [];
    this.players = [];
    this.busy = false;
    root.addEventListener("submit", (e) => {
      e.preventDefault();
      this.perform(() => this.submit(e.target));
    });
    root.addEventListener("click", (e) => {
      const button = e.target.closest("[data-ai-action]");
      if (button) this.perform(() => this.action(button));
    });
    root.addEventListener("change", (e) => {
      if (e.target.name === "provider") this.providerFields();
    });
  }
  async load() {
    if (this.busy) return;
    try {
      await this.refresh();
    } catch (error) {
      this.message(error.message, true);
    }
  }
  message(message, error = false) {
    let el = this.root.querySelector("[data-ai-message]");
    if (!el) {
      this.root.innerHTML = '<p data-ai-message role="status"></p>';
      el = this.root.firstElementChild;
    }
    el.textContent = message;
    el.classList.toggle("ai-error", error);
  }
  async refresh() {
    const [models, players, user] = await Promise.all([
      adminService.request("/api/admin/ai-models"),
      adminService.request("/api/admin/ai-players"),
      apiService.request("/api/auth/me"),
    ]);
    this.models = models.models;
    this.players = players.players.filter((p) => p.kind !== "delegate");
    this.canEdit = user.adminRole === "superadmin";
    this.render(players.worker);
  }
  async perform(callback) {
    if (this.busy) return;
    this.busy = true;
    this.root.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await callback();
    } catch (error) {
      this.message(
        `${error.message}${error.code ? ` (${error.code})` : ""}`,
        true,
      );
    } finally {
      this.busy = false;
      this.root.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }
  render(worker) {
    const modelsOpen =
      this.root.querySelector(".ai-model-settings")?.open || false;
    const defaultModel = this.models.find((m) => m.isDefault && m.enabled);
    const modelOptions = options(
      Object.fromEntries(
        this.models.map((m) => [
          m.id,
          `${m.name}${m.isDefault ? " · 기본" : ""}${m.enabled ? "" : " · 중지"}`,
        ]),
      ),
      defaultModel?.id || "",
    );
    this.root.innerHTML = `<div class="ai-heading"><h3>AI 플레이어</h3><button type="button" data-ai-action="refresh">새로고침</button></div><p data-ai-message role="status"></p><p class="ai-worker-status">실행 프로그램: ${worker.connected ? "연결됨" : worker.configured ? "연결 대기" : "인증 키 미설정"}${worker.lastSeenAt ? ` · 마지막 연결 ${esc(new Date(worker.lastSeenAt).toLocaleString())}` : ""}</p><p class="ai-help">외부 AI가 게임 API로 플레이합니다. 모든 행성을 비교하며, 작업 후 바로 재판단하고 할 일이 없으면 최소 2분 대기합니다. 판단마다 모델 호출 비용이 발생할 수 있습니다. 연결 테스트도 모델 API를 호출합니다.</p>
      <details class="ai-model-settings" ${modelsOpen ? "open" : ""}><summary>모델 API 설정</summary><section><h4>모델 API 설정</h4><div class="ai-model-list">${this.models.map((m) => `<article class="ai-card"><strong>${esc(m.name)}</strong><span>${esc(providers[m.provider])} · ${esc(m.model)}</span><small>${esc(m.baseUrl)} · 키 ${m.apiKeyConfigured ? "등록됨" : "없음"} · ${m.enabled ? "활성" : "중지"}${m.isDefault ? " · 기본 모델" : ""}</small>${this.canEdit ? `<div class="ai-buttons"><button type="button" data-ai-action="edit-model" data-id="${esc(m.id)}">수정</button><button type="button" data-ai-action="test-model" data-id="${esc(m.id)}">연결 테스트</button><button type="button" data-ai-action="delete-model" data-id="${esc(m.id)}">삭제</button></div>` : ""}</article>`).join("") || "<p>등록된 모델이 없습니다.</p>"}</div>
      ${this.canEdit ? `<form data-ai-form="model" class="ai-form"><h4 data-model-title>모델 등록</h4><input type="hidden" name="id"><label>설정 이름<input name="name" maxlength="200" required></label><label>제공자<select name="provider">${options(providers, "openrouter")}</select></label><label data-base-url>API 기본 주소<input name="baseUrl" type="url" placeholder="http://host.docker.internal:11434/v1"></label><label>모델 ID<input name="model" maxlength="200" required placeholder="제공자의 모델 ID"></label><label>API 키<input name="apiKey" type="password" autocomplete="new-password" maxlength="4096"><small>수정 시 비워 두면 기존 키를 유지합니다.</small></label><label>응답 제한 시간(초)<input name="timeoutSeconds" type="number" min="5" max="90" value="60" required></label><label>최대 응답 토큰<input name="maxTokens" type="number" min="128" max="4096" value="512" required></label><label>Temperature<input name="temperature" type="number" min="0" max="2" step="0.1" value="0.3" required></label><label class="ai-check"><input name="enabled" type="checkbox" checked>활성화</label><label class="ai-check"><input name="isDefault" type="checkbox">기본 모델로 사용</label><div class="ai-buttons"><button type="submit">모델 저장</button><button type="button" data-ai-action="reset-model">새 모델 등록</button></div></form>` : ""}</section>
      </details>${this.canEdit ? `<section><form data-ai-form="create-player" class="ai-form"><h4>AI 봇 추가·무작위 배치</h4><label>추가할 봇 수<input name="count" type="number" min="1" max="50" value="1" required></label><label>이름 또는 이름 접두어<input name="username" maxlength="60" required></label><label>배치 은하<select name="galaxy"><option value="">전체 은하에 무작위 배치</option>${Array.from({ length: 9 }, (_, i) => `<option value="${i + 1}">${i + 1} 은하</option>`).join("")}</select></label><small>전체 은하 또는 선택한 은하의 빈 좌표에 무작위 배치합니다. 여러 봇을 추가하면 이름에 고유 번호가 붙습니다.</small><label>사용 모델<select name="modelId" required><option value="">모델 선택</option>${modelOptions}</select></label>${this.settingsFields({ maxColonies: 9 })}<button type="submit">플레이어 생성</button></form></section>` : ""}
      <section><h4>플레이어 목록</h4><div class="ai-player-list">${this.players.map((p) => `<article class="ai-card"><div class="ai-heading"><strong>${esc(p.username)}</strong><button type="button" data-ai-action="user-detail" data-id="${esc(p.userId)}">상세</button><small>${p.kind === "delegate" ? "사용자 대리" : "AI 봇"}</small><span>${p.isBanned ? "계정 정지" : p.enabled ? (p.running ? "판단 중" : "실행 대기") : "중지"}</span></div><small>행성 ${p.planets.length}개${p.planets[0] ? ` · 첫 행성 [${p.planets[0].galaxy}:${p.planets[0].system}:${p.planets[0].planet}]` : ""} · 판단 ${p.runs}회 · 행동 ${p.actions}회 · 제안 ${p.suggestions || 0}건</small><p>최근 행동: ${esc(p.lastAction || "실행 전")}</p><p>${esc(p.lastReason || "")}</p>${p.lastErrorCode ? `<p class="ai-error">${esc(p.lastErrorCode)}</p>` : ""}${p.lastSuggestionErrorCode ? `<p class="ai-error">개선 제안: ${esc(p.lastSuggestionErrorCode)}</p>` : ""}${this.canEdit ? `<form data-ai-form="player" data-id="${esc(p.id)}" class="ai-form"><label>사용 모델<select name="modelId">${options(Object.fromEntries(this.models.map((m) => [m.id, m.name])), p.modelId)}</select></label>${this.settingsFields(p)}<button type="submit">플레이어 설정 저장</button><button type="button" data-ai-action="toggle-player" data-id="${esc(p.id)}">${p.enabled ? "즉시 중지" : "시작"}</button></form>` : `<p>${esc(strategies[p.strategy])}</p>`}</article>`).join("") || "<p>AI 플레이어가 없습니다.</p>"}</div></section>`;
    this.providerFields();
  }
  settingsFields(p) {
    const scores = p.behaviorScores ||
      {
        economy: { development: 70, expansion: 20, attack: 10 },
        expansion: { development: 20, expansion: 70, attack: 10 },
        military: { development: 20, expansion: 20, attack: 60 },
      }[p.strategy] || { development: 40, expansion: 40, attack: 20 };
    return `<fieldset class="ai-behavior-scores"><legend>행동 성향 · 합계 100점</legend>${Object.entries(
      { development: "개발", expansion: "확장", attack: "공격" },
    )
      .map(
        ([key, label]) =>
          `<label>${label}<input name="score-${key}" type="number" min="0" max="100" step="1" required value="${scores[key]}"></label>`,
      )
      .join(
        "",
      )}</fieldset><label>전략<select name="strategy">${options(strategies, p.strategy || "balanced")}</select></label><label>대기 후 재확인(초)<input name="intervalSeconds" type="number" min="120" max="3600" value="${Math.max(120, p.intervalSeconds ?? 180)}" required></label><label>최대 보유 행성<input name="maxColonies" type="number" min="1" max="9" value="${p.maxColonies ?? 3}" required></label><label class="ai-check"><input name="allowAttacks" type="checkbox" ${p.allowAttacks ? "checked" : ""}>다른 플레이어 공격 허용</label><label class="ai-check"><input name="proposeImprovements" type="checkbox" ${p.proposeImprovements !== false ? "checked" : ""}>개선 사항 자동 제안 (6시간에 1건)</label><label class="ai-check"><input name="enabled" type="checkbox" ${p.enabled !== false ? "checked" : ""}>실행 활성화</label>`;
  }
  providerFields() {
    const f = this.root.querySelector('[data-ai-form="model"]');
    if (f) {
      f.querySelector("[data-base-url]").hidden =
        f.elements.provider.value !== "compatible";
      f.elements.baseUrl.required = f.elements.provider.value === "compatible";
    }
  }
  values(form) {
    const data = Object.fromEntries(new FormData(form));
    [
      "timeoutSeconds",
      "maxTokens",
      "temperature",
      "intervalSeconds",
      "count",
      "maxColonies",
    ].forEach((k) => {
      if (k in data) data[k] = Number(data[k]);
    });
    if (form.elements["score-development"]) {
      data.behaviorScores = Object.fromEntries(
        ["development", "expansion", "attack"].map((key) => [
          key,
          Number(data[`score-${key}`]),
        ]),
      );
      for (const key of ["development", "expansion", "attack"])
        delete data[`score-${key}`];
      if (
        Object.values(data.behaviorScores).reduce((sum, n) => sum + n, 0) !==
        100
      )
        throw Error("개발·확장·공격 점수의 합계를 100으로 맞춰 주세요.");
    }
    if (form.elements.galaxy) {
      data.randomPlacement = true;
      if (data.galaxy === "") delete data.galaxy;
      else data.galaxy = Number(data.galaxy);
    }
    data.enabled = form.elements.enabled.checked;
    if (form.elements.isDefault)
      data.isDefault = form.elements.isDefault.checked;
    if (form.elements.proposeImprovements)
      data.proposeImprovements = form.elements.proposeImprovements.checked;
    if (form.elements.allowAttacks)
      data.allowAttacks = form.elements.allowAttacks.checked;
    return data;
  }
  async submit(form) {
    const data = this.values(form),
      kind = form.dataset.aiForm;
    if (kind === "model") {
      const id = data.id;
      delete data.id;
      if (id && !data.apiKey) delete data.apiKey;
      await adminService.request(`/api/admin/ai-models${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(data),
      });
    } else if (kind === "create-player")
      await adminService.request("/api/admin/ai-players", {
        method: "POST",
        body: JSON.stringify(data),
      });
    else if (kind === "player")
      await adminService.request(`/api/admin/ai-players/${form.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    await this.refresh();
    this.message("저장했습니다.");
  }
  async action(button) {
    const { aiAction: action, id } = button.dataset;
    if (action === "user-detail") return window.uiManager.viewUserDetails(id);
    if (action === "refresh") return this.refresh();
    if (action === "reset-model") {
      this.root.querySelector('[data-ai-form="model"]').reset();
      this.root.querySelector('[data-ai-form="model"]').elements.id.value = "";
      this.root.querySelector("[data-model-title]").textContent = "모델 등록";
      this.providerFields();
      return;
    }
    if (action === "edit-model") {
      const m = this.models.find((m) => m.id === id),
        f = this.root.querySelector('[data-ai-form="model"]');
      f.reset();
      for (const [k, v] of Object.entries(m)) {
        if (f.elements[k]) {
          if (["enabled", "isDefault"].includes(k)) f.elements[k].checked = v;
          else f.elements[k].value = v;
        }
      }
      f.elements.id.value = id;
      this.root.querySelector("[data-model-title]").textContent = "모델 수정";
      this.providerFields();
      f.scrollIntoView({ block: "nearest" });
      return;
    }
    if (action === "test-model") {
      const response = await adminService.request(
        `/api/admin/ai-models/${id}/test`,
        { method: "POST", body: "{}" },
      );
      this.message(`연결 성공 · ${response.model}`);
      return;
    }
    if (action === "delete-model")
      await adminService.request(`/api/admin/ai-models/${id}`, {
        method: "DELETE",
      });
    if (action === "toggle-player") {
      const p = this.players.find((p) => p.id === id);
      await adminService.request(`/api/admin/ai-players/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !p.enabled }),
      });
    }
    await this.refresh();
    this.message("변경했습니다.");
  }
}
