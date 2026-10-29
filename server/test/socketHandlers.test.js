const assert = require('node:assert/strict');
const test = require('node:test');

const SocketHandlers = require('../socket/handlers');

function createSocket() {
  const handlers = new Map();

  return {
    id: 'test-socket',
    handlers,
    on(event, handler) {
      handlers.set(event, handler);
    }
  };
}

test('socket connections do not expose immediate resource-spending actions', () => {
  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });

  try {
    const socketHandlers = new SocketHandlers({});
    const socket = createSocket();

    socketHandlers.handleConnection(socket);

    assert.equal(socket.handlers.has('build'), false);
    assert.equal(socket.handlers.has('research'), false);
    assert.equal(socket.handlers.has('buildShip'), false);
    assert.equal(socket.handlers.has('sendFleet'), false);
  } finally {
    global.setInterval = originalSetInterval;
  }
});

test('global ticks do not overlap and recover from settlement failures', async () => {
  const originalSetInterval = global.setInterval;
  const originalConsoleError = console.error;
  let tick;
  const errors = [];
  global.setInterval = callback => { tick = callback; return { unref() {} }; };
  console.error = (...args) => errors.push(args);
  try {
    const handlers = new SocketHandlers({});
    let calls = 0, reject;
    handlers.processFleetArrivals = () => {
      calls++;
      return new Promise((resolve, fail) => { reject = fail; });
    };
    const first = tick();
    await tick();
    assert.equal(calls, 1);
    reject(new Error('temporary DB failure'));
    await first;
    assert.equal(handlers.processingTick, false);
    assert.equal(errors.length, 1);
    const next = tick();
    assert.equal(calls, 2);
    reject(new Error('second temporary DB failure'));
    await next;
    assert.equal(handlers.processingTick, false);
  } finally {
    global.setInterval = originalSetInterval;
    console.error = originalConsoleError;
  }
});

test('delayed private reports are discarded after a socket changes accounts', async () => {
  const BattleReport = require('../models/BattleReport');
  const originalFind = BattleReport.find;
  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  let resolve;
  BattleReport.find = () => ({ sort: () => ({ limit: () => new Promise(done => { resolve = done; }) }) });
  try {
    const handlers = new SocketHandlers({});
    const received = [];
    const socket = { userId: 'first-user', connected: true, emit: (...args) => received.push(args) };
    const pending = handlers.getBattleReports(socket);
    socket.userId = 'second-user';
    resolve([{ private: 'first-user report' }]);
    await pending;
    assert.deepEqual(received, []);
  } finally {
    BattleReport.find = originalFind;
    global.setInterval = originalSetInterval;
  }
});
