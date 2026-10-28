/**
 * Throwaway full stack for browser tests: in-memory MongoDB replica set, the real game server,
 * a fake Metanomic and a small control port to move time along. Nothing here touches a real
 * database or the real payment service.
 *
 *   node scripts/e2eStack.js            # game API :3999, control :3998
 *   cd ogame-3d && VITE_SERVER_URL=http://localhost:3999 npx vite --host 127.0.0.1 --port 5179
 *
 * Fixtures are written to E2E_FIXTURE (default /tmp/oogame-cgc-e2e.json).
 */
const http = require('node:http');
const { writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

const GAME_PORT = Number(process.env.E2E_GAME_PORT || 3999);
const CONTROL_PORT = Number(process.env.E2E_CONTROL_PORT || 3998);
const CLIENT_URL = process.env.E2E_CLIENT_URL || 'http://localhost:5179';
const FIXTURE = process.env.E2E_FIXTURE || '/tmp/oogame-cgc-e2e.json';

async function main() {
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const { startFakeMetanomic } = require('../test/helpers/fakeMetanomic');
  const fake = await startFakeMetanomic({ budgetMicro: 500_000_000n, autoFinalize: true });

  Object.assign(process.env, {
    NODE_ENV: 'test', PORT: String(GAME_PORT), CLIENT_URL, MONGODB_URI: repl.getUri('cgc_e2e'),
    JWT_SECRET: 'cgc-e2e-secret-only-for-browser-tests-2026', ...fake.env
  });
  require('../index.js');
  await new Promise((resolve) => {
    const tick = () => fetch(`http://127.0.0.1:${GAME_PORT}/health`).then(resolve, () => setTimeout(tick, 200));
    tick();
  });

  const mongoose = require('mongoose');
  const jwt = require('jsonwebtoken');
  const User = require('../models/User'), Movement = require('../models/FleetMovement'), Config = require('../models/GameConfig');
  const MonsterEvent = require('../models/MonsterEvent'), Debris = require('../models/DebrisField');
  await Config.getConfig();
  // Prices are normally set by an administrator; the stack seeds the ones the browser scenarios buy.
  await Config.updateOne({}, { $set: { 'shop.prices': { 'emblem.dragon': '5000000', 'emblem.comet': '4000000', 'speedup.1h': '500000', 'speedup.6h': '2500000', 'speedup.24h': '8000000' } } });
  const sign = (user) => jwt.sign({ userId: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '4h' });
  const make = async (username, planet, extra = {}) => {
    const user = await User.create({
      username, email: `${username}@e2e.invalid`, password: randomUUID(), lastLogin: new Date(),
      planets: [{ name: `${username}-home`, galaxy: 1, system: 1, planet, resources: { metal: 5e6, crystal: 5e6, deuterium: 5e6 }, fleet: { cruiser: 60, recycler: 4, colonyShip: 1, smallCargo: 5 }, ...(extra.planet || {}) }],
      ...(extra.user || {})
    });
    return { id: String(user._id), username, token: sign(user), planetId: String(user.planets[0]._id) };
  };
  const admin = await make('e2e_admin', 4, { user: { isAdmin: true, adminRole: 'superadmin' } });
  const buyer = await make('e2e_buyer', 5);
  const player = await make('e2e_player', 6);
  const rival = await make('e2e_rival', 9);
  writeFileSync(FIXTURE, JSON.stringify({ admin, buyer, player, rival, gameUrl: `http://127.0.0.1:${GAME_PORT}`, control: `http://127.0.0.1:${CONTROL_PORT}`, jwtSecret: process.env.JWT_SECRET }), { mode: 0o600 });

  // Control port: make fleets arrive now, inspect the fake payment service.
  const control = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://x');
      const [, action, arg] = url.pathname.split('/');
      if (action === 'arrive') {
        const past = new Date(Date.now() - 1000);
        const movement = await Movement.findById(arg);
        if (!movement) return send(404, { error: 'no movement' });
        if (movement.status === 'flying') movement.arrivalTime = past; else movement.returnTime = past;
        movement.startTime = new Date(+past - 60_000);
        await movement.save();
        return send(200, { status: movement.status });
      }
      if (action === 'movements') return send(200, (await Movement.find({ userId: arg }).sort({ _id: 1 }).lean()).map((m) => ({ id: String(m._id), mission: m.mission, status: m.status, notice: m.notice, cargo: m.cargo })));
      if (action === 'fake') return send(200, { payments: [...fake.state.payments.values()].map((p) => ({ orderId: p.orderId, status: p.status, amount: p.amount })), rewards: fake.state.rewards.size, budget: fake.state.budget.toString(), balances: Object.fromEntries([...fake.state.balances].map(([k, v]) => [k, v.toString()])) });
      if (action === 'monsters') return send(200, (await MonsterEvent.find().lean()).map((e) => ({ id: String(e._id), status: e.status, location: e.location, version: e.version })));
      if (action === 'debris') return send(200, await Debris.find().lean());
      if (action === 'grant') {
        // /grant/<userId>/<wallet>?speedup=7200&emblems=comet,dragon  (stand-in for a finished purchase)
        const update = { 'entitlements.speedupSeconds': Number(url.searchParams.get('speedup') || 0), 'entitlements.emblems': (url.searchParams.get('emblems') || '').split(',').filter(Boolean) };
        const [, , , wallet] = url.pathname.split('/');
        if (wallet) update.wallet = { address: wallet.toLowerCase(), linkedAt: new Date() };
        await User.updateOne({ _id: arg }, { $set: update, $inc: { stateRevision: 1 } });
        return send(200, {});
      }
      if (action === 'seed-resources') { await User.updateOne({ _id: arg }, { $set: { 'planets.0.resources.metal': 5e7 } }); return send(200, {}); }
      send(404, { error: 'unknown' });
    } catch (error) { send(500, { error: error.message }); }
  });
  await new Promise((resolve) => control.listen(CONTROL_PORT, '127.0.0.1', resolve));
  console.log(`E2E stack ready: game ${GAME_PORT}, control ${CONTROL_PORT}, fixture ${FIXTURE}`);

  const stop = async () => { control.close(); await fake.close(); await mongoose.disconnect(); await repl.stop(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main().catch((error) => { console.error(error); process.exit(1); });
