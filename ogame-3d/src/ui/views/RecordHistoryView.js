import { escapeHtml as e } from "../dom.js";
import { reportCard } from "./ScoutReportsView.js";
import {
  renderBattleReports,
  battleOutcome,
  reportIsRead,
} from "./battleReports.js";
import "../record-history.css";
const idOf = (r) => String(r.id || r._id);
const coordinate = (p) => (p ? `[${p.galaxy}:${p.system}:${p.planet}]` : "—");

export class RecordHistoryView {
  constructor(root, { api, state, type, onCoordinate, onChanged }) {
    Object.assign(this, { root, api, state, type, onCoordinate, onChanged });
    this.page = 1;
    this.selected = new Set();
    this.rows = [];
    this.reading = new Set();
    this.pagination = { total: 0, totalPages: 1 };
    root.addEventListener("click", (event) => this.click(event));
    root.addEventListener("change", (event) => {
      if (event.target.matches("[data-select-record]")) {
        const id = event.target.dataset.selectRecord;
        event.target.checked ? this.selected.add(id) : this.selected.delete(id);
      } else if (event.target.matches("[data-select-page]")) {
        this.selected = new Set(
          event.target.checked ? this.rows.map(idOf) : [],
        );
      } else return;
      this.confirming = false;
      this.render();
    });
  }
  async show() {
    if (this.account !== String(this.state.userId)) {
      this.account = String(this.state.userId);
      this.page = 1;
      this.rows = [];
      this.detail = null;
      this.selected.clear();
      this.confirming = false;
      this.pagination = { total: 0, totalPages: 1 };
    }
    await this.load();
  }
  async load() {
    const account = String(this.state.userId);
    if (this.loading && this.loadingAccount === account) return;
    this.loadingAccount = account;
    const sequence = (this.sequence = (this.sequence || 0) + 1);
    this.loading = true;
    this.error = "";
    this.render();
    try {
      const result =
        this.type === "scout"
          ? await this.api.getScoutReports({ page: this.page, limit: 20 })
          : await this.api.getBattleReportPage(this.page, 20);
      if (account !== String(this.state.userId) || sequence !== this.sequence)
        return false;
      this.rows = result.reports;
      this.pagination = result.pagination || {
        total: this.rows.length,
        totalPages: 1,
      };
      if (this.page > this.pagination.totalPages) {
        this.page = this.pagination.totalPages;
        this.loading = false;
        return await this.load();
      }
      this.selected = new Set(
        [...this.selected].filter((id) =>
          this.rows.some((r) => idOf(r) === id),
        ),
      );
      if (this.detail)
        this.detail =
          this.rows.find((r) => idOf(r) === idOf(this.detail)) || this.detail;
      return true;
    } catch (error) {
      if (account === String(this.state.userId)) this.error = error.message;
      return false;
    } finally {
      if (sequence === this.sequence) {
        this.loading = false;
        if (account === String(this.state.userId)) this.render();
      }
    }
  }
  async click(event) {
    const coord = event.target.closest("[data-scout-galaxy]");
    if (coord)
      return this.onCoordinate?.({
        galaxy: Number(coord.dataset.scoutGalaxy),
        system: Number(coord.dataset.scoutSystem),
        planet: Number(coord.dataset.scoutPlanet),
      });
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.hasAttribute("data-record-open")) {
      await this.open(
        this.rows.find((r) => idOf(r) === button.dataset.recordOpen),
      );
    } else if (button.hasAttribute("data-record-step")) {
      await this.move(Number(button.dataset.recordStep));
    } else if (button.hasAttribute("data-record-back")) {
      const id = idOf(this.detail);
      this.detail = null;
      this.render();
      [...this.root.querySelectorAll("[data-record-open]")]
        .find((b) => b.dataset.recordOpen === id)
        ?.focus();
    } else if (button.hasAttribute("data-record-page")) {
      this.page = Number(button.dataset.recordPage);
      this.selected.clear();
      this.confirming = false;
      await this.load();
    } else if (button.hasAttribute("data-record-delete")) {
      this.confirming = true;
      this.render();
      this.root.querySelector("[data-record-cancel]")?.focus();
    } else if (button.hasAttribute("data-record-cancel")) {
      this.confirming = false;
      this.render();
    } else if (button.hasAttribute("data-record-confirm")) {
      const account = String(this.state.userId),
        ids = this.detail ? [idOf(this.detail)] : [...this.selected];
      let deleted = false;
      this.loading = true;
      this.error = "";
      this.render();
      try {
        await this.api.deleteReports(this.type, ids);
        if (account !== String(this.state.userId)) return;
        this.detail = null;
        this.selected.clear();
        this.confirming = false;
        deleted = true;
        this.onChanged?.();
      } catch (error) {
        if (account === String(this.state.userId)) this.error = error.message;
      } finally {
        this.loading = false;
      }
      if (account === String(this.state.userId)) {
        if (deleted) await this.load();
        else this.render();
      }
    }
  }
  isRead(report) {
    return this.type === "scout"
      ? !!report.ownerRead
      : reportIsRead(report, this.state.userId);
  }
  async open(report, focusSelector = "[data-record-back]") {
    if (!report) return;
    this.detail = report;
    this.confirming = false;
    this.error = "";
    this.render();
    const focusTarget =
      this.root.querySelector(`${focusSelector}:not(:disabled)`) ||
      this.root.querySelector("[data-record-back]");
    focusTarget?.focus();
    const account = String(this.state.userId),
      id = idOf(report),
      key = `${account}:${id}`;
    if (this.isRead(report) || this.reading.has(key)) return;
    this.reading.add(key);
    try {
      if (this.type === "scout") await this.api.markScoutReportRead(id);
      else await this.api.markBattleReportRead(id);
      if (account !== String(this.state.userId)) return;
      const field =
        this.type === "scout"
          ? "ownerRead"
          : String(report.attacker?.userId) === account
            ? "attackerRead"
            : "defenderRead";
      report[field] = true;
      const row = this.rows.find((r) => idOf(r) === id);
      if (row) row[field] = true;
      if (this.detail && idOf(this.detail) === id) this.detail[field] = true;
      this.onChanged?.();
    } catch (error) {
      if (
        account === String(this.state.userId) &&
        this.detail &&
        idOf(this.detail) === id
      )
        this.error = error.message;
    } finally {
      this.reading.delete(key);
      if (account === String(this.state.userId)) {
        const active = document.activeElement;
        const selector =
          this.root.contains(active) &&
          active.matches("[data-record-back],[data-record-step]")
            ? active.hasAttribute("data-record-back")
              ? "[data-record-back]"
              : `[data-record-step="${active.dataset.recordStep}"]`
            : null;
        this.render();
        if (selector)
          (
            this.root.querySelector(`${selector}:not(:disabled)`) ||
            this.root.querySelector("[data-record-back]")
          )?.focus();
      }
    }
  }
  async move(direction) {
    if (this.loading || !this.detail || ![-1, 1].includes(direction)) return;
    const index = this.rows.findIndex((r) => idOf(r) === idOf(this.detail));
    if (index < 0) return;
    const next = index + direction;
    if (next >= 0 && next < this.rows.length)
      return this.open(this.rows[next], `[data-record-step="${direction}"]`);
    const previousPage = this.page,
      account = String(this.state.userId);
    if (
      (direction < 0 && this.page <= 1) ||
      (direction > 0 && this.page >= this.pagination.totalPages)
    )
      return;
    this.page += direction;
    this.selected.clear();
    this.confirming = false;
    const loaded = await this.load();
    if (account !== String(this.state.userId)) return;
    if (!loaded) {
      this.page = previousPage;
      this.render();
      return;
    }
    if (this.rows.length)
      await this.open(
        direction > 0 ? this.rows[0] : this.rows.at(-1),
        `[data-record-step="${direction}"]`,
      );
    else {
      this.detail = null;
      this.render();
    }
  }
  render() {
    const disabled = this.loading ? "disabled" : "";
    const count = this.detail ? 1 : this.selected.size;
    const confirmation = this.confirming
      ? `<div class="record-delete-confirm" role="group" aria-label="기록 삭제 확인"><span>선택한 ${count}건을 내 목록에서 삭제할까요?</span><button class="holo-btn-small" data-record-confirm ${disabled}>삭제 확인</button><button class="holo-btn-small" data-record-cancel ${disabled}>취소</button></div>`
      : "";
    const status = `<p role="status" class="record-status">${e(this.error || (this.loading ? "기록을 불러오는 중…" : ""))}</p>`;
    if (this.detail) {
      const index = this.rows.findIndex((r) => idOf(r) === idOf(this.detail));
      const hasPrevious = index > 0 || (index === 0 && this.page > 1);
      const hasNext =
        index >= 0 &&
        (index < this.rows.length - 1 ||
          this.page < this.pagination.totalPages);
      this.root.innerHTML = `<div class="record-toolbar"><button class="holo-btn-small" data-record-back ${disabled}>← 목록</button><div class="record-detail-navigation" aria-label="기록 이동"><button class="holo-btn-small" data-record-step="-1" ${!hasPrevious || this.loading ? "disabled" : ""}>이전 기록</button><button class="holo-btn-small" data-record-step="1" ${!hasNext || this.loading ? "disabled" : ""}>다음 기록</button></div><span class="record-read-status ${this.isRead(this.detail) ? "is-read" : "is-unread"}">${this.isRead(this.detail) ? "읽음" : "안 읽음"}</span><button class="holo-btn-small" data-record-delete ${disabled}>이 기록 삭제</button></div>${confirmation}${status}<div class="record-detail"></div>`;
      const detailRoot = this.root.querySelector(".record-detail");
      if (this.type === "scout") detailRoot.innerHTML = reportCard(this.detail);
      else renderBattleReports(detailRoot, [this.detail], this.state.userId);
      detailRoot.querySelectorAll("details").forEach((details) => {
        details.open = true;
      });
      detailRoot.querySelector("[data-report-read]")?.remove();
      return;
    }
    const pages = this.pagination.totalPages;
    const pageButtons = [
      ...new Set([
        1,
        ...Array.from({ length: 5 }, (_, i) => this.page - 2 + i).filter(
          (p) => p >= 1 && p <= pages,
        ),
        pages,
      ]),
    ].sort((a, b) => a - b);
    let previous = 0;
    const numbers = pageButtons
      .map((page) => {
        const gap = previous && page - previous > 1 ? "<span>…</span>" : "";
        previous = page;
        return `${gap}<button class="holo-btn-small" data-record-page="${page}" ${page === this.page ? 'aria-current="page" disabled' : disabled}>${page}</button>`;
      })
      .join("");
    this.root.innerHTML = `<div class="record-toolbar"><label><input type="checkbox" data-select-page ${this.rows.length && this.selected.size === this.rows.length ? "checked" : ""} ${disabled}> 이 페이지 선택</label><span>총 ${this.pagination.total}건 · 선택 ${this.selected.size}건</span><button class="holo-btn-small" data-record-delete ${!count || this.loading ? "disabled" : ""}>선택 삭제</button></div>${confirmation}${status}<div class="record-list">${
      this.rows
        .map((r) => {
          const id = idOf(r),
            scout = this.type === "scout";
          const title = scout
            ? r.targetName ||
              {
                empty: "미점령 행성",
                friendly: "아군 행성",
                unavailable: "대상 확인 불가",
              }[r.outcome] ||
              "행성 관측"
            : r.formationName || "함대 전투";
          const result = scout
            ? r.intercepted
              ? "격추"
              : r.detected
                ? "탐지됨"
                : "미탐지"
            : battleOutcome(r, this.state.userId);
          const route = scout
            ? coordinate(r.destination)
            : `${coordinate(r.attacker?.coordinates)} → ${coordinate(r.defender?.coordinates)}`;
          const unread = !this.isRead(r);
          const date = new Date(scout ? r.observedAt : r.battleTime);
          const fullDate = date.toLocaleString("ko-KR");
          const pad = (value) => String(value).padStart(2, "0");
          const shortDate = `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
          return `<div class="record-row ${unread ? "is-unread" : "is-read"}"><input type="checkbox" data-select-record="${e(id)}" aria-label="${e(title)} 선택" ${this.selected.has(id) ? "checked" : ""} ${disabled}><button class="record-open" data-record-open="${e(id)}" ${disabled}><span class="record-heading"><span class="record-read-status ${unread ? "is-unread" : "is-read"}">${unread ? "안 읽음" : "읽음"}</span><strong title="${e(title)}">${e(title)}</strong></span><span class="record-coordinate" title="${e(route)}">${e(route)}</span><span class="record-result">${e(result)}</span><time title="${e(fullDate)}"><span class="record-date-full">${e(fullDate)}</span><span class="record-date-short">${e(shortDate)}</span></time></button></div>`;
        })
        .join("") || '<p class="record-empty">기록이 없습니다.</p>'
    }</div><nav class="record-pagination" aria-label="기록 페이지"><button class="holo-btn-small" data-record-page="${this.page - 1}" ${this.page <= 1 ? "disabled" : disabled}>이전</button>${numbers}<button class="holo-btn-small" data-record-page="${this.page + 1}" ${this.page >= pages ? "disabled" : disabled}>다음</button></nav>`;
    const checkbox = this.root.querySelector("[data-select-page]");
    checkbox.indeterminate =
      this.selected.size > 0 && this.selected.size < this.rows.length;
  }
}
