/** Owns requests, never owns a timer. UIManager supplies the existing refresh cadence. */
export class FleetTrafficController {
 constructor({ fetchTraffic, getAccount, onData, onStatus, onDetails, onReset }) {
  Object.assign(this, { fetchTraffic, getAccount, onData, onStatus, onDetails, onReset });
  this.generation = 0; this.detailGeneration = 0; this.active = true; this.account = getAccount(); this.rows = [];
 }
 reset() {
  this.generation++; this.detailGeneration++; this.pending = null; this.detailPending = false;
  this.coords = null; this.route = null; this.rows = []; this.nextCursor = null; this.onReset?.();
 }
 ensureAccount() {
  const account = this.getAccount();
  if (account !== this.account) { const coords = this.coords; this.reset(); this.coords = coords; this.account = account; }
  return Boolean(account);
 }
 setSystem(coords) {
  this.ensureAccount();
  if (this.coords?.galaxy === coords.galaxy && this.coords?.system === coords.system) return;
  this.reset(); this.coords = { ...coords };
 }
 setActive(active) {
  if (active === this.active) return;
  this.active = active; this.generation++; this.detailGeneration++; this.pending = null; this.detailPending = false;
 }
 valid(generation, account) { return this.active && generation === this.generation && account === this.getAccount(); }
 async refresh() {
  if (!this.ensureAccount() || !this.active || !this.coords || this.pending) return;
  const generation = this.generation, account = this.account, coords = { ...this.coords }, request = {};
  this.pending = request;
  try {
   const data = await this.fetchTraffic(coords.galaxy, coords.system);
   if (!this.valid(generation, account)) return;
   this.onData(data); this.onStatus('');
   if (this.route) {
    const route = data.routes.find(r => r.id === this.route);
    if (route) await this.select(route); else { this.route = null; this.rows = []; this.detailGeneration++; }
   }
  } catch (error) { if (this.valid(generation, account)) this.onStatus(error.message); }
  finally { if (this.pending === request) this.pending = null; }
 }
 async select(route) {
  this.route = route.id; this.rows = []; this.nextCursor = null; this.detailGeneration++; this.detailPending = false;
  await this.loadMore();
 }
 async loadMore() {
  if (!this.ensureAccount() || !this.active || !this.coords || !this.route || this.detailPending) return;
  this.detailPending = true;
  const generation = this.generation, detailGeneration = this.detailGeneration, account = this.account, route = this.route;
  try {
   const options = { route, ...(this.nextCursor ? { cursor: this.nextCursor } : {}) };
   const data = await this.fetchTraffic(this.coords.galaxy, this.coords.system, options);
   if (!this.valid(generation, account) || detailGeneration !== this.detailGeneration) return;
   this.rows = [...new Map([...this.rows, ...data.movements].map(r=>[r.id,r])).values()];
   this.nextCursor = data.nextCursor; this.onDetails(this.rows, this.nextCursor);
  } catch (error) {
   if (this.valid(generation, account) && detailGeneration === this.detailGeneration) this.onDetails(this.rows, this.nextCursor, error.message);
  } finally { if (detailGeneration === this.detailGeneration) this.detailPending = false; }
 }
}
