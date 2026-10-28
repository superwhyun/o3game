const crypto = require("node:crypto");
const Model = require("../models/AiModel");
const { apiError } = require("../utils/apiErrors");
const { getJwtSecret } = require("../utils/authToken");
const DEFAULT_URLS = {
  openrouter: "https://openrouter.ai/api/v1",
  vercel: "https://ai-gateway.vercel.sh/v1",
};
const encryptionKey = () =>
  crypto
    .createHmac("sha256", getJwtSecret())
    .update("cosmic-empire/ai-model-keys/v1")
    .digest();
function encrypt(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((v) => v.toString("base64"))
    .join(".");
}
function decrypt(value) {
  try {
    const [iv, tag, data] = value
      .split(".")
      .map((v) => Buffer.from(v, "base64"));
    const cipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw apiError(
      503,
      "AI_KEY_UNAVAILABLE",
      "저장된 모델 키를 읽을 수 없습니다. 관리자 설정에서 API 키를 다시 저장해 주세요.",
    );
  }
}
function publicModel(model) {
  const row = model.toObject ? model.toObject() : model;
  return {
    id: String(row._id),
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled,
    isDefault: !!row.isDefault,
    timeoutSeconds: row.timeoutSeconds,
    maxTokens: row.maxTokens,
    temperature: row.temperature,
    apiKeyConfigured: !!row.apiKeyCipher,
    updatedAt: row.updatedAt,
  };
}
function clean(input = {}, old = {}) {
  const row = {};
  for (const field of ["name", "provider", "model"]) {
    const value = input[field] ?? old[field];
    if (typeof value !== "string" || !value.trim() || value.length > 200)
      throw apiError(400, "INVALID_REQUEST", `${field}를 확인해 주세요.`);
    row[field] = value.trim();
  }
  if (!["openrouter", "vercel", "compatible"].includes(row.provider))
    throw apiError(400, "INVALID_REQUEST", "지원하지 않는 AI 제공자입니다.");
  row.baseUrl = DEFAULT_URLS[row.provider] || input.baseUrl || old.baseUrl;
  try {
    const url = new URL(row.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error();
    row.baseUrl = url.toString().replace(/\/$/, "");
    if (row.baseUrl.endsWith("/chat/completions"))
      row.baseUrl = row.baseUrl.slice(0, -17);
  } catch {
    throw apiError(
      400,
      "INVALID_REQUEST",
      "유효한 API 기본 주소를 입력해 주세요.",
    );
  }
  for (const [field, min, max, fallback] of [
    ["timeoutSeconds", 5, 90, 60],
    ["maxTokens", 128, 4096, 512],
    ["temperature", 0, 2, 0.3],
  ]) {
    const value = input[field] ?? old[field] ?? fallback;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (field !== "temperature" && !Number.isInteger(value))
    )
      throw apiError(400, "INVALID_REQUEST", `${field} 범위를 확인해 주세요.`);
    row[field] = value;
  }
  row.enabled = input.enabled ?? old.enabled ?? true;
  if (typeof row.enabled !== "boolean")
    throw apiError(400, "INVALID_REQUEST", "enabled는 boolean이어야 합니다.");
  row.isDefault = input.isDefault ?? old.isDefault ?? false;
  if (typeof row.isDefault !== "boolean")
    throw apiError(400, "INVALID_REQUEST", "isDefault는 boolean이어야 합니다.");
  if (input.apiKey !== undefined) {
    if (
      typeof input.apiKey !== "string" ||
      input.apiKey.length > 4096 ||
      /[\r\n]/.test(input.apiKey)
    )
      throw apiError(400, "INVALID_REQUEST", "API 키 형식을 확인해 주세요.");
    row.apiKeyCipher = input.apiKey.trim() ? encrypt(input.apiKey.trim()) : "";
  } else
    row.apiKeyCipher =
      old.provider && old.provider !== row.provider
        ? ""
        : old.apiKeyCipher || "";
  if (row.provider !== "compatible" && !row.apiKeyCipher)
    throw apiError(400, "AI_KEY_REQUIRED", "제공자 API 키를 입력해 주세요.");
  return row;
}
async function save(id, input, actor) {
  const { atomic, requireTransactions } = require("./transactions");
  await requireTransactions();
  return atomic(async () => {
    await require("../models/SystemLock").findOneAndUpdate(
      { _id: "ai-model-default" },
      { $inc: { revision: 1 } },
      { upsert: true },
    );
    const old = id ? await Model.findById(id).select("+apiKeyCipher") : null;
    if (id && !old)
      throw apiError(404, "NOT_FOUND", "AI 모델 설정을 찾을 수 없습니다.");
    const patch = clean(input, old || {});
    if (patch.isDefault)
      await Model.updateMany(
        { ...(old ? { _id: { $ne: old._id } } : {}), isDefault: true },
        { $set: { isDefault: false } },
      );
    if (old) {
      Object.assign(old, patch, { updatedBy: actor });
      await old.save();
      return publicModel(old);
    }
    return publicModel(await Model.create({ ...patch, updatedBy: actor }));
  });
}
async function completion(id, messages, { maxTokens } = {}) {
  const model = await Model.findById(id).select("+apiKeyCipher");
  if (!model)
    throw apiError(404, "NOT_FOUND", "AI 모델 설정을 찾을 수 없습니다.");
  if (!model.enabled)
    throw apiError(
      409,
      "AI_MODEL_DISABLED",
      "AI 모델 설정이 중지되어 있습니다.",
    );
  const headers = { "Content-Type": "application/json" };
  if (model.apiKeyCipher)
    headers.Authorization = "Bearer " + decrypt(model.apiKeyCipher);
  if (model.provider === "openrouter")
    headers["X-Title"] = "Cosmic Empire AI Player";
  let response;
  try {
    response = await fetch(model.baseUrl + "/chat/completions", {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(model.timeoutSeconds * 1000),
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: model.temperature,
        max_tokens: maxTokens || model.maxTokens,
        stream: false,
      }),
    });
  } catch (error) {
    throw apiError(
      error.name === "TimeoutError" ? 504 : 502,
      error.name === "TimeoutError"
        ? "AI_MODEL_TIMEOUT"
        : "AI_MODEL_UNAVAILABLE",
      "AI 모델 API에 연결하지 못했습니다.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const code =
      response.status === 429
        ? "AI_MODEL_RATE_LIMITED"
        : response.status === 401 || response.status === 403
          ? "AI_MODEL_AUTH_FAILED"
          : "AI_MODEL_UNAVAILABLE";
    throw apiError(
      response.status === 429 ? 429 : 502,
      code,
      "AI 모델 API가 요청을 처리하지 못했습니다.",
    );
  }
  if (Number(response.headers.get("content-length")) > 1024 * 1024) {
    await response.body?.cancel();
    throw apiError(
      502,
      "AI_MODEL_INVALID_RESPONSE",
      "AI 모델 응답이 너무 큽니다.",
    );
  }
  let data;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw Error("too large");
      chunks.push(chunk);
    }
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError")
      throw apiError(
        504,
        "AI_MODEL_TIMEOUT",
        "AI 모델 응답 시간이 초과되었습니다.",
      );
    throw apiError(
      502,
      "AI_MODEL_INVALID_RESPONSE",
      "AI 모델이 올바른 JSON 응답을 반환하지 않았습니다.",
    );
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length > 100000)
    throw apiError(
      502,
      "AI_MODEL_INVALID_RESPONSE",
      "AI 모델의 텍스트 응답을 확인할 수 없습니다.",
    );
  return {
    content,
    usage:
      data.usage && typeof data.usage === "object"
        ? Object.fromEntries(
            ["prompt_tokens", "completion_tokens", "total_tokens"]
              .filter(
                (k) =>
                  Number.isSafeInteger(data.usage[k]) && data.usage[k] >= 0,
              )
              .map((k) => [k, data.usage[k]]),
          )
        : null,
    model: model.model,
  };
}
module.exports = { save, publicModel, completion, clean, DEFAULT_URLS };
