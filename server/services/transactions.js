const mongoose = require("mongoose");
const { AsyncLocalStorage } = require("node:async_hooks");
mongoose.set("transactionAsyncLocalStorage", true);
const effects = new AsyncLocalStorage();
function afterCommit(fn) {
  const callbacks = effects.getStore();
  if (callbacks) callbacks.push(fn);
  else fn();
}
const topologyChecks = new WeakMap();
async function supportsTransactions() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected");
  if (!topologyChecks.has(db)) {
    const check = db.admin().command({ hello: 1 })
      .then((hello) => Boolean(hello.setName || hello.msg === "isdbgrid"))
      .catch((error) => { topologyChecks.delete(db); throw error; });
    topologyChecks.set(db, check);
  }
  return topologyChecks.get(db);
}
async function requireTransactions() {
  if (!(await supportsTransactions())) {
    throw Object.assign(new Error("건설·함대 기능에는 트랜잭션을 지원하는 DB 연결이 필요합니다."), {
      code: 20, statusCode: 503,
    });
  }
}
async function atomic(fn) {
  if (mongoose.transactionAsyncLocalStorage.getStore()?.session) return fn();
  // Keep the existing standalone gameplay path available. New multi-document
  // fleet mutations explicitly require transactions before entering this helper.
  if (!(await supportsTransactions())) return fn();
  let callbacks;
  const result = await mongoose.connection.transaction(async () => {
    callbacks = [];
    return effects.run(callbacks, fn);
  });
  for (const callback of callbacks) {
    try {
      callback();
    } catch (error) {
      console.error("Post-commit notification failed:", error.message);
    }
  }
  return result;
}
function transactionalRoute(handler) {
  return async (req, res) => {
    let status = 200,
      body;
    const buffered = {
      status(value) {
        status = value;
        return this;
      },
      json(value) {
        body = value;
        return this;
      },
    };
    try {
      await atomic(async () => {
        status = 200;
        body = undefined;
        await handler(req, buffered);
        if (status >= 400)
          throw Object.assign(new Error(body?.error || "Request failed"), {
            statusCode: status,
            responseBody: body,
          });
      });
      res.status(status).json(body);
    } catch (error) {
      if (error.responseBody) {
        require('../utils/apiErrors').sendError(req, res, Object.assign(error, { code: error.responseBody.code }));
      } else require('../utils/apiErrors').sendError(req, res, error);
    }
  };
}
module.exports = { atomic, afterCommit, transactionalRoute, supportsTransactions, requireTransactions };
