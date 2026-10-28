// Isolated test-only failure injection; never imported by the production server.
let fault;
const states = require("../../services/GameStateService");
const settle = states.settleUserState;
states.settleUserState = (...args) =>
  fault === "snapshot"
    ? Promise.reject(new Error("audit state unavailable"))
    : settle(...args);
const entities = require("../../services/EntityConfigService");
const catalog = entities.toPublicCatalog.bind(entities);
entities.toPublicCatalog = () => {
  if (fault === "catalog") throw new Error("audit internal detail");
  return catalog();
};
process.on("message", (message) => {
  fault = message.fault;
  process.send({ updated: true });
});
const { server } = require("../../index");
server.once("listening", () => process.send({ port: server.address().port }));
