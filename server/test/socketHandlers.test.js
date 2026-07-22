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
