import { hostname } from "node:os";
import { ApiClient } from "./apiClient.js";
import { runJob } from "./runner.js";
const baseUrl = process.env.GAME_API_URL || "http://server:3000";
const key = process.env.AI_WORKER_SECRET;
if (!key || key.length < 32)
  throw new Error("AI_WORKER_SECRET must contain at least 32 characters");
const workerId = (process.env.AI_WORKER_ID || hostname())
  .replace(/[^a-zA-Z0-9_-]/g, "")
  .slice(0, 80);
const control = new ApiClient(baseUrl, key);
let stopping = false,
  heartbeatBusy = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function heartbeat() {
  if (heartbeatBusy || stopping) return;
  heartbeatBusy = true;
  try {
    await control.request("/api/ai-worker/heartbeat", { workerId });
  } catch {
  } finally {
    heartbeatBusy = false;
  }
}
const timer = setInterval(heartbeat, 10000);
console.log("AI API worker started");
while (!stopping) {
  let delay = 3000;
  try {
    const { job } = await control.request("/api/ai-worker/claim", { workerId });
    if (job && !stopping) {
      const result = await runJob(baseUrl, control, job);
      console.log(
        JSON.stringify({
          playerId: job.playerId,
          action: result.action,
          acted: result.acted,
          errorCode: result.errorCode,
          suggestionSubmitted: result.suggestionSubmitted,
          suggestionErrorCode: result.suggestionErrorCode,
          completionError: result.completionError,
        }),
      );
      delay = 250;
    }
  } catch (error) {
    console.error(JSON.stringify({ code: error.code || "API_UNAVAILABLE" }));
    delay = Math.max(5000, Math.min(60000, error.retryAfter * 1000 || 0));
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, delay));
}
clearInterval(timer);
