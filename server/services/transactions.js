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
    throw Object.assign(new Error("함대 기능에는 트랜잭션을 지원하는 DB 연결이 필요합니다."), {
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
      const conflict = error.name === "VersionError" || error.code === 11000;
      const unsupported =
        error.code === 20 ||
        /replica set|Transaction numbers/.test(error.message);
      res
        .status(error.statusCode || (conflict ? 409 : unsupported ? 503 : 500))
        .json(
          error.responseBody || {
            error: unsupported
              ? "함대 기능에는 트랜잭션을 지원하는 DB 연결이 필요합니다."
              : conflict
                ? "상태가 변경되었습니다. 최신 상태로 다시 시도하십시오."
                : error.message,
            code:
              error.code || (conflict ? "STATE_CONFLICT" : "REQUEST_FAILED"),
          },
        );
    }
  };
}
module.exports = { atomic, afterCommit, transactionalRoute, supportsTransactions, requireTransactions };
