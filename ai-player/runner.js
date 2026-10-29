import { ApiClient } from "./apiClient.js";
import { candidatesFor, observationFor } from "./candidates.js";
const commandKey = (candidate) =>
  JSON.stringify(
    {
      label: candidate.label,
      command: candidate.command,
      originPlanetId: candidate.details?.originPlanetId,
    },
    (key, value) => (key === "requestId" ? undefined : value),
  );
export async function runJob(baseUrl, control, job) {
  const player = new ApiClient(baseUrl, job.token, 8000);
  let result = { acted: false, action: "wait", reason: "" };
  let improvement;
  try {
    const [snapshot, catalog] = await Promise.all([
      player.request("/api/auth/me"),
      player.request("/api/game/catalog"),
    ]);
    const reports = await player.request("/api/game/scout-reports?limit=10");
    const systems = new Map(
      snapshot.planets.map((p) => [`${p.galaxy}:${p.system}`, p]),
    );
    for (const report of (reports.reports || []).slice(0, 2)) {
      const d = report.destination;
      if (d) systems.set(`${d.galaxy}:${d.system}`, d);
    }
    // Continue exploring beyond full local systems; rotate the frontier each turn.
    const cursor = job.runs || 0,
      base = snapshot.planets[cursor % snapshot.planets.length];
    const frontier = {
      galaxy: cursor % 8 === 7 ? (base.galaxy % 9) + 1 : base.galaxy,
      system: ((base.system + (cursor % 499)) % 499) + 1,
    };
    systems.set(`${frontier.galaxy}:${frontier.system}`, frontier);
    const galaxy = await Promise.all(
      [...systems.values()].map((p) =>
        player
          .request(`/api/game/galaxy?galaxy=${p.galaxy}&system=${p.system}`)
          .then((g) => ({ ...g, galaxy: p.galaxy, system: p.system })),
      ),
    );
    const candidates = candidatesFor(snapshot, catalog, galaxy, job);
    const response = await control.request(
      "/api/ai-worker/decide",
      {
        playerId: job.playerId,
        runId: job.runId,
        observation: {
          ...observationFor(snapshot, catalog, job),
          galaxy,
          scoutReports: reports.reports,
        },
        candidates: candidates.map(({ command, ...c }) => c),
      },
      "POST",
      95000,
    );
    const { decision } = response;
    improvement = response.improvement;
    const choice = candidates.find((c) => c.id === decision.actionId);
    if (!choice)
      throw Object.assign(new Error(), { code: "AI_MODEL_INVALID_RESPONSE" });
    result = {
      acted: false,
      action: choice.label.slice(0, 100),
      reason: decision.reason.slice(0, 500),
    };
    if (choice.command) {
      // Model latency can overlap manual commands. Recheck legal actions against
      // fresh state; candidate IDs and global revisions are not stable identities.
      const fresh = await player.request("/api/auth/me");
      const currentChoice = candidatesFor(fresh, catalog, galaxy, job).find(
        (candidate) =>
          candidate.command && commandKey(candidate) === commandKey(choice),
      );
      if (currentChoice) {
        await player.request(
          currentChoice.command.path,
          currentChoice.command.body,
          currentChoice.command.method || "POST",
        );
        result.acted = true;
      } else {
        result.recheck = true;
        result.action = `재판단 · ${choice.label}`.slice(0, 100);
        result.reason =
          "선택한 작업이 완료됐거나 현재 자원·작업 조건으로 실행할 수 없어, 대기하지 않고 최신 상태에서 다른 작업을 즉시 재판단합니다.";
      }
    }
  } catch (error) {
    result.errorCode =
      error.code ||
      (["TimeoutError", "AbortError"].includes(error.name)
        ? "API_TIMEOUT"
        : "API_UNAVAILABLE");
  }
  if (improvement) {
    try {
      await player.request("/api/game/improvement-requests", improvement);
      result.suggestionSubmitted = true;
    } catch (error) {
      result.suggestionErrorCode = error.code || "API_UNAVAILABLE";
    }
  }
  // Never retry mutations: ambiguous network failures are re-observed on the next turn.
  try {
    await control.request("/api/ai-worker/complete", {
      playerId: job.playerId,
      runId: job.runId,
      result,
    });
  } catch (error) {
    result.completionError = error.code || "API_UNAVAILABLE";
  }
  return result;
}
