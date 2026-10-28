import { createRequestId } from '../../utils/requestId.js';

// One request identity per click; uncertain requests survive reload for this user.
export class ScoutController {
  constructor({ api, state, notify, onChange, storage = sessionStorage }) {
    Object.assign(this, { api, state, notify, onChange, storage });
    this.user = null;
    this.pending = {};
    this.inflight = new Set();
    this.reports = [];
    this.alerts = [];
    this.targetReports = [];
    this.target = null;
    this.epoch = 0;
  }
  ensureAccount() {
    const id = String(this.state.userId || "");
    if (id !== this.user) {
      this.user = id;
      this.epoch++;
      this.reports = [];
      this.alerts = [];
      this.targetReports = [];
      this.target = null;
      this.inflight.clear();
      this.seenReport = null;
      this.seenAlert = null;
      try {
        this.pending = JSON.parse(this.storage.getItem("scouts:" + id) || "{}");
      } catch {
        this.pending = {};
      }
    }
  }
  persist() {
    this.storage.setItem("scouts:" + this.user, JSON.stringify(this.pending));
  }
  available() {
    this.ensureAccount();
    const committed = new Set(
      (this.state.fleetMovements || []).map((m) => m.requestId),
    );
    const reserved = Object.values(this.pending).filter(
      (o) =>
        String(o.originPlanetId) === String(this.state.planet.id) &&
        !committed.has(o.requestId),
    ).length;
    return Math.max(
      0,
      (this.state.unassignedShips?.espionageProbe || 0) - reserved,
    );
  }
  launch(destination) {
    this.ensureAccount();
    if (this.available() < 1) return;
    let requestId;
    try { requestId = createRequestId(); }
    catch (error) {
      this.notify('정찰 출격 실패', error.message, 'error');
      return;
    }
    const order = {
      requestId,
      originPlanetId: this.state.planet.id,
      destination: { ...destination },
    };
    this.pending[order.requestId] = order;
    this.persist();
    this.onChange();
    void this.dispatch(order, false);
  }
  async dispatch(order, recovery) {
    const user = this.user,
      epoch = this.epoch;
    if (this.inflight.has(order.requestId)) return;
    this.inflight.add(order.requestId);
    try {
      let result;
      if (recovery) {
        try {
          await this.api.getFleetRequest(order.requestId);
          result = { snapshot: await this.api.getCurrentUser() };
        } catch (error) {
          if (error.status !== 404) throw error;
          result = await this.api.launchScout(order);
        }
      } else result = await this.api.launchScout(order);
      if (this.epoch !== epoch || String(this.state.userId) !== user) return;
      delete this.pending[order.requestId];
      this.persist();
      if (result.snapshot) this.state.syncFromServer(result.snapshot);
      this.notify(
        "정찰 출격",
        `[${Object.values(order.destination).join(":")}] · 정찰선 1척`,
        "success",
      );
    } catch (error) {
      if (this.epoch !== epoch || String(this.state.userId) !== user) return;
      if (error.status && error.status < 500 && error.code !== "AUTH_CHANGED") {
        delete this.pending[order.requestId];
        this.persist();
        this.notify("정찰 출격 실패", error.message, "error");
      } else
        this.notify(
          "정찰 출격 확인 중",
          "응답을 확인하는 중입니다. 같은 요청으로 결과를 복구합니다.",
          "info",
        );
    } finally {
      if (this.epoch === epoch) {
        this.inflight.delete(order.requestId);
        this.onChange();
      }
    }
  }
  async selectTarget(target) {
    this.ensureAccount();
    if (JSON.stringify(this.target) === JSON.stringify(target)) return;
    if (JSON.stringify(this.target) !== JSON.stringify(target)) {
      this.targetReports = [];
      this.targetCursor = null;
    }
    this.target = target;
    this.onChange();
    const epoch = this.epoch,
      queryId = (this.queryId = (this.queryId || 0) + 1);
    try {
      const result = await this.api.getScoutReports(target);
      if (this.epoch !== epoch || queryId !== this.queryId) return;
      this.targetReports = result.reports;
      this.targetCursor = result.nextCursor;
      this.error = "";
      this.onChange();
    } catch (error) {
      if (this.epoch === epoch && queryId === this.queryId) {
        this.error = error.message;
        this.onChange();
      }
    }
  }
  async refresh(target = this.target, { minAge = 0 } = {}) {
    this.ensureAccount();
    if (!this.api.isAuthenticated()) return;
    if (this.lastRefreshEpoch === this.epoch && Date.now() - (this.lastRefreshAt || 0) < minAge) return;
    if (this.refreshingEpoch === this.epoch) return;
    this.refreshingEpoch = this.epoch;
    if (JSON.stringify(this.target) !== JSON.stringify(target)) {
      this.targetReports = [];
      this.targetCursor = null;
    }
    this.target = target;
    const epoch = this.epoch,
      queryId = (this.queryId = (this.queryId || 0) + 1);
    const user = this.user;
    try {
      const [history, alerts, selected] = await Promise.all([
        this.api.getScoutReports(),
        this.api.getScoutAlerts(),
        target
          ? this.api.getScoutReports(target)
          : Promise.resolve({ reports: [] }),
      ]);
      if (
        this.epoch !== epoch ||
        String(this.state.userId) !== user ||
        queryId !== this.queryId
      )
        return;
      const latest = history.reports[0]?.id,
        alert = alerts.alerts[0]?.id;
      if (this.seenReport && latest && latest !== this.seenReport)
        this.notify(
          "정찰 보고 도착",
          "성계도에서 최신 관측을 확인하십시오.",
          "success",
        );
      if (this.seenAlert && alert && alert !== this.seenAlert)
        this.notify(
          "정찰 침입 탐지",
          "정찰 보고 영역에서 탐지 기록을 확인하십시오.",
          "info",
        );
      this.seenReport = latest || this.seenReport || "none";
      this.seenAlert = alert || this.seenAlert || "none";
      this.reports = history.reports;
      this.alerts = alerts.alerts;
      this.targetReports = selected.reports;
      this.targetCursor = selected.nextCursor;
      this.lastRefreshEpoch = epoch;
      this.lastRefreshAt = Date.now();
      this.historyCursor = history.nextCursor;
      this.alertsCursor = alerts.nextCursor;
      this.error = "";
      this.onChange();
    } catch (error) {
      if (this.epoch === epoch && queryId === this.queryId) {
        this.error = error.message;
        this.onChange();
      }
    } finally {
      if (this.refreshingEpoch === epoch) this.refreshingEpoch = null;
    }
    for (const order of Object.values(this.pending))
      void this.dispatch(order, true);
  }
  async older(target) {
    this.ensureAccount();
    const epoch = this.epoch;
    const list = await this.api.getScoutReports({ ...target, limit: 50 });
    if (this.epoch === epoch) {
      this.targetReports = list.reports;
      this.onChange();
    }
  }
  reset() {
    this.user = null;
    this.epoch++;
    this.pending = {};
    this.reports = [];
    this.alerts = [];
    this.targetReports = [];
    this.target = null;
    this.seenReport = null;
    this.seenAlert = null;
  }
}
