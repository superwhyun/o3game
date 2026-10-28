import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../apiClient.js";
import { runJob } from "../runner.js";
test("feedback rejection never cancels a successful game action", async () => {
  const original = ApiClient.prototype.request;
  let completed;
  ApiClient.prototype.request = async function (path) {
    if (path === "/api/auth/me")
      return {
        planets: [
          {
            _id: "p",
            galaxy: 1,
            system: 1,
            planet: 7,
            resources: { metal: 100 },
            buildings: {},
            area: { available: 1 },
          },
        ],
        queueState: { all: [] },
        research: {},
      };
    if (path === "/api/game/catalog")
      return {
        entities: [
          {
            entityType: "building",
            entityId: "mine",
            display: { name: "Mine" },
            costModel: { baseCost: { metal: 60 }, costMultiplier: 2 },
          },
        ],
      };
    if (path.startsWith("/api/game/galaxy")) return { positions: [] };
    if (path.startsWith("/api/game/scout-reports")) return { reports: [] };
    if (path === "/api/queue/build") return { ok: true };
    if (path === "/api/game/improvement-requests")
      throw Object.assign(new Error(), { code: "AI_SUGGESTION_DUPLICATE" });
    throw Error("Unexpected API path " + path);
  };
  const control = {
    request: async (path, body) => {
      if (path.endsWith("/decide"))
        return {
          decision: { actionId: "c1", reason: "광산 건설" },
          improvement: { title: "기존 제안", description: "개선 내용" },
        };
      if (path.endsWith("/complete")) {
        completed = body.result;
        return { completed: true };
      }
      throw Error("Unexpected control path");
    },
  };
  try {
    const result = await runJob("http://test.invalid", control, {
      token: "bot",
      playerId: "bot",
      runId: "run",
    });
    assert.equal(result.acted, true);
    assert.equal(result.errorCode, undefined);
    assert.equal(result.suggestionErrorCode, "AI_SUGGESTION_DUPLICATE");
    assert.equal(completed.acted, true);
  } finally {
    ApiClient.prototype.request = original;
  }
});

test("manual building completion during model decision discards the old level command", async () => {
  const original = ApiClient.prototype.request;
  let reads = 0,
    mutations = 0,
    completed;
  ApiClient.prototype.request = async function (path) {
    if (path === "/api/auth/me")
      return {
        planets: [
          {
            _id: "p",
            galaxy: 1,
            system: 1,
            planet: 7,
            resources: { metal: 1000 },
            buildings: { mine: ++reads === 1 ? 0 : 1 },
            area: { available: 10 },
          },
        ],
        queueState: { all: [] },
        research: {},
      };
    if (path === "/api/game/catalog")
      return {
        entities: [
          {
            entityType: "building",
            entityId: "mine",
            display: { name: "Mine" },
            costModel: { baseCost: { metal: 60 }, costMultiplier: 2 },
          },
        ],
      };
    if (path.startsWith("/api/game/galaxy")) return { positions: [] };
    if (path.startsWith("/api/game/scout-reports")) return { reports: [] };
    if (path === "/api/queue/build") {
      mutations++;
      return { ok: true };
    }
    throw Error("Unexpected API path " + path);
  };
  const control = {
    request: async (path, body) => {
      if (path.endsWith("/decide"))
        return { decision: { actionId: "c1", reason: "Build level 1" } };
      completed = body.result;
      return { completed: true };
    },
  };
  try {
    const result = await runJob("http://test.invalid", control, {
      token: "delegate",
      playerId: "p",
      runId: "r",
    });
    assert.equal(reads, 2);
    assert.equal(mutations, 0);
    assert.equal(result.acted, false);
    assert.equal(result.errorCode, undefined);
    assert.match(completed.action, /재판단/);
    assert.equal(completed.recheck,true);
  } finally {
    ApiClient.prototype.request = original;
  }
});

test('a colony action runs directly and survives manual selection changes during thinking', async () => {
  const original = ApiClient.prototype.request;
  let reads = 0, command;
  ApiClient.prototype.request = async function(path,body) {
    if(path === '/api/auth/me') return {currentPlanet:reads++ ? 1 : 0,planets:[0,1].map(index => ({_id:`p${index}`,name:`Colony${index}`,galaxy:1,system:1,planet:index+1,resources:{metal:reads > 1 ? 80 : 100},buildings:{},area:{available:index ? 10 : 0}})),research:{},queueState:{all:[]},fleetFormations:[]};
    if(path === '/api/game/catalog') return {entities:[{entityType:'building',entityId:'mine',display:{name:'Mine'},costModel:{baseCost:{metal:60}}}]};
    if(path.startsWith('/api/game/galaxy')) return {positions:[]};
    if(path.startsWith('/api/game/scout-reports')) return {reports:[]};
    if(path === '/api/queue/build') {command=body;return {ok:true};}
    throw Error(path);
  };
  const control={request:async(path,body) => path.endsWith('/decide') ? {decision:{actionId:body.candidates.find(c => c.details.originPlanetId === 'p1').id,reason:'다른 행성 개발'}} : {completed:true}};
  try {
    const result=await runJob('http://test.invalid',control,{token:'t',playerId:'p',runId:'r'});
    assert.equal(result.acted,true);
    assert.equal(command.planetId,'1');
  } finally {ApiClient.prototype.request=original;}
});
