const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { io: connect } = require('socket.io-client');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await pause(25);
  }
  throw new Error('Timed out waiting for presence update');
}

test('authenticated API limits isolate users sharing the same proxy IP', async () => {
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const { createApiLimiter, apiRateLimitKey } = require('../middleware/rateLimits');
  const express = require('express');
  const app = express();
  app.use(createApiLimiter()); app.get('/state', (req, res) => res.json({ ok: true }));
  const server = app.listen(0); await new Promise(resolve => server.on('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/state`;
    const tokens = Array.from({ length: 20 }, () => jwt.sign({ userId: new mongoose.Types.ObjectId().toString() }, process.env.JWT_SECRET));
    const statuses = await Promise.all(tokens.flatMap(token => Array.from({ length: 10 }, async () =>
      (await fetch(base, { headers: { Authorization: `Bearer ${token}` } })).status)));
    assert.ok(statuses.every(status => status === 200));
    const req = { ip: '127.0.0.1', headers: {} };
    assert.equal(apiRateLimitKey({ ...req, headers: { authorization: `Bearer ${jwt.sign({ userId: '111111111111111111111111' }, 'forged-secret')}` } }), apiRateLimitKey(req));
    const limit = process.env.NODE_ENV === 'test' ? 1000 : 120;
    for (let i = 10; i < limit; i++) {
      assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${tokens[0]}` } })).status, 200);
    }
    assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${tokens[0]}` } })).status, 429);
    assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${tokens[1]}` } })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('20 users and 40 sockets preserve private state, construction and multi-device presence', { timeout: 120000 }, async () => {
  const externalUri = process.env.MULTI_USER_TEST_MONGODB_URI;
  if (externalUri && !/^multi_user_.*_test$/.test(new URL(externalUri).pathname.slice(1))) throw new Error('Dedicated multi_user_*_test DB required');
  const repl = externalUri ? null : await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  let server, io, handlers;
  const sockets = [], socketErrors = [], timings = [];
  try {
    await mongoose.connect(externalUri || repl.getUri('multi_user_integration_test'));
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const User = require('../models/User');
    const Queue = require('../models/BuildingQueue');
    await require('../models/GameConfig').getConfig();
    await require('../services/EntityConfigService').initialize();
    await Promise.all([User.init(), Queue.init()]);
    const express = require('express');
    const app = express(); app.use(express.json());
    app.use('/api', require('../middleware/rateLimits').createApiLimiter());
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/game', require('../routes/game'));
    app.use('/api/queue', require('../routes/buildingQueue'));
    server = require('node:http').createServer(app);
    io = new (require('socket.io').Server)(server);
    handlers = new (require('../socket/handlers'))(io);
    io.on('connection', socket => handlers.handleConnection(socket));
    server.listen(0); await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, token, body, method = 'POST') {
      const started = performance.now();
      const response = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const result = { status: response.status, body: await response.json() };
      timings.push(performance.now() - started);
      return result;
    }
    const password = randomBytes(16).toString('hex');
    const users = await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const username = `concurrent${i}`;
      const registered = await request('/api/auth/register', null, { username, email: `${username}@test.invalid`, password });
      assert.equal(registered.status, 201, JSON.stringify(registered.body));
      const login = await request('/api/auth/login', null, { username, password });
      assert.equal(login.status, 200);
      return { id: login.body.user.id, token: login.body.token, username };
    }));
    const stored = await User.find().lean();
    assert.equal(new Set(stored.flatMap(user => user.planets.map(planet => planet.coordinateKey))).size, 20);
    await Promise.all(users.flatMap(user => Array.from({ length: 2 }, () => new Promise((resolve, reject) => {
      const socket = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push({ socket, user });
      const timer = setTimeout(() => reject(new Error('Socket authentication timeout')), 20000);
      socket.on('connect', () => socket.emit('authenticate', user.token));
      socket.on('auth_error', error => { socketErrors.push(error); clearTimeout(timer); reject(new Error(error)); });
      socket.on('error', error => socketErrors.push(error));
      socket.on('planetData', data => {
        if (data.id !== user.id) socketErrors.push('State leaked across users');
        clearTimeout(timer); resolve();
      });
    }))));
    assert.equal(handlers.connectedUsers.size, 40);
    assert.deepEqual(socketErrors, []);
    const reads = await Promise.all(users.flatMap(user => Array.from({ length: 10 }, async () => {
      const result = await request('/api/auth/me', user.token, undefined, 'GET');
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.id, user.id);
      return result;
    })));
    assert.equal(reads.length, 200);
    await Promise.all(Array.from({ length: 8 }, async () => {
      const result = await request('/api/auth/login', null, { username: users[0].username, password });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    }));
    const queues = await Promise.all(users.map(async user => {
      const result = await request('/api/queue/build', user.token, { buildingId: 'metalMine', planetId: '0' });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.snapshot.id, user.id);
      return result.body.queueItem;
    }));
    assert.equal(await Queue.countDocuments(), 20);
    const denied = await request(`/api/queue/${queues[1].id}`, users[0].token, undefined, 'DELETE');
    assert.equal(denied.status, 400);
    const otherPlanet = (await User.findById(users[1].id)).planets[0]._id;
    assert.equal((await request(`/api/game/planets/${otherPlanet}/name`, users[0].token, { name: '소유권 침범' }, 'PATCH')).status, 404);
    const sessions = sockets.filter(entry => entry.user.id === users[0].id);
    sessions[0].socket.disconnect();
    await waitFor(() => handlers.connectedUsers.size === 39);
    await waitFor(async () => (await User.findById(users[0].id)).isOnline === true);
    sessions[1].socket.disconnect();
    await waitFor(async () => (await User.findById(users[0].id)).isOnline === false);
    const reauth = sockets.find(entry => entry.user.id === users[2].id).socket;
    const serverSocket = io.sockets.sockets.get(reauth.id);
    reauth.removeAllListeners('planetData');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Reauthentication timeout')), 10000);
      reauth.once('authenticated', () => { clearTimeout(timer); resolve(); });
      reauth.emit('authenticate', users[3].token);
    });
    assert.equal(serverSocket.rooms.has(`user:${users[2].id}`), false);
    assert.equal(serverSocket.rooms.has(`user:${users[3].id}`), true);
    const apiFailure = new Promise(resolve => reauth.once('apiError', resolve));
    const legacyAuthMessage = await new Promise(resolve => { reauth.once('auth_error', resolve); reauth.emit('authenticate', 'invalid-token'); });
    assert.equal((await apiFailure).code, 'AUTH_INVALID_TOKEN');
    assert.equal(serverSocket.userId, null);
    assert.equal(serverSocket.rooms.has(`user:${users[3].id}`), false);
    assert.deepEqual(socketErrors.filter(error => error !== legacyAuthMessage), []);
    timings.sort((a, b) => a - b);
    console.log(JSON.stringify({ users: users.length, sockets: 40, stateReads: reads.length, constructions: queues.length, requests: timings.length, p95Ms: Math.round(timings[Math.floor(timings.length * .95)]), errors: 0 }));
  } finally {
    for (const { socket } of sockets) socket.disconnect();
    if (handlers) clearInterval(handlers.tickTimer);
    if (io) await new Promise(resolve => io.close(resolve));
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (handlers) await Promise.allSettled([...handlers.presenceUpdates.values()]);
    if (mongoose.connection.readyState) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (repl) await repl.stop();
  }
});
