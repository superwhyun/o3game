const { randomUUID } = require("node:crypto");
const DEFAULT_CODES = {
  400: "INVALID_REQUEST",
  401: "AUTH_INVALID_TOKEN",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "STATE_CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
};
const MESSAGES = {
  DEPLOY_TARGET_NOT_OWNED: "함대는 내 행성으로만 이동할 수 있습니다.",
  TRANSPORT_TARGET_NOT_OWNED: "자원은 내 행성으로만 수송할 수 있습니다.",
  PIRATE_TRANSPORT_FORBIDDEN: "해적 행성에는 자원을 수송할 수 없습니다.",
  MAINTENANCE_MODE: "서버 점검 중에는 게임 명령을 실행할 수 없습니다.",
  AI_KEY_UNAVAILABLE:
    "저장된 모델 키를 읽을 수 없습니다. API 키를 다시 저장해 주세요.",
  AI_MODEL_TIMEOUT: "AI 모델 응답 시간이 초과되었습니다.",
  AI_MODEL_UNAVAILABLE: "AI 모델 API에 연결하지 못했습니다.",
  AI_MODEL_AUTH_FAILED:
    "AI 모델 API 인증에 실패했습니다. API 키를 확인해 주세요.",
  AI_MODEL_INVALID_RESPONSE: "AI 모델이 올바른 응답을 반환하지 않았습니다.",
  AI_WORKER_NOT_CONFIGURED: "AI 실행 프로그램의 인증 키가 설정되지 않았습니다.",
  INTERNAL_ERROR: "서버에서 요청을 처리하지 못했습니다.",
  SERVICE_UNAVAILABLE: "서비스를 일시적으로 사용할 수 없습니다.",
  TRANSACTIONS_REQUIRED: "트랜잭션을 지원하는 DB 연결이 필요합니다.",
};
function apiError(statusCode, code, message, details) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    details,
    expose: true,
  });
}
function normalizeError(error) {
  let status = error.statusCode || error.status;
  let code =
    typeof error.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(error.code)
      ? error.code
      : undefined;
  let message = error.message;
  if (error.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "올바른 JSON 본문을 보내 주세요.";
  } else if (error.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "요청 본문이 너무 큽니다.";
  } else if (
    error.type === "encoding.unsupported" ||
    error.type === "charset.unsupported"
  ) {
    status = 415;
    code = "UNSUPPORTED_MEDIA_TYPE";
  } else if (error.name === "TokenExpiredError") {
    status = 401;
    code = "AUTH_TOKEN_EXPIRED";
    message = "로그인 토큰이 만료되었습니다.";
  } else if (["JsonWebTokenError", "NotBeforeError"].includes(error.name)) {
    status = 401;
    code = "AUTH_INVALID_TOKEN";
    message = "유효하지 않은 로그인 토큰입니다.";
  } else if (error.name === "CastError") {
    status = 400;
    code = "INVALID_REQUEST";
    message = "입력 값의 형식이 올바르지 않습니다.";
  } else if (error.name === "ValidationError") {
    status = 400;
    code = "VALIDATION_FAILED";
    message = "입력 값이 허용 범위를 벗어났습니다.";
  } else if (error.code === 11000) {
    status = 409;
    code =
      error.keyValue?._id === "first-admin"
        ? "ADMIN_ALREADY_EXISTS"
        : "RESOURCE_CONFLICT";
    message = "이미 존재하는 값이거나 다른 요청과 충돌했습니다.";
  } else if (
    error.name === "VersionError" ||
    error.hasErrorLabel?.("TransientTransactionError")
  ) {
    status = 409;
    code = "STATE_CONFLICT";
    message = "상태가 변경되었습니다. 최신 상태를 확인해 주세요.";
  } else if (error.code === 20) {
    status = 503;
    code = "TRANSACTIONS_REQUIRED";
  } else if (
    [
      "MongoNetworkError",
      "MongoServerSelectionError",
      "MongoNotConnectedError",
      "MongooseServerSelectionError",
    ].includes(error.name)
  ) {
    status = 503;
    code = "SERVICE_UNAVAILABLE";
  }
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  if (
    status >= 500 &&
    ![
      "TRANSACTIONS_REQUIRED",
      "SERVICE_UNAVAILABLE",
      "MAINTENANCE_MODE",
      ...Object.keys(MESSAGES).filter((code) => code.startsWith("AI_")),
    ].includes(code)
  )
    code = status === 503 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR";
  code ||= DEFAULT_CODES[status] || "INTERNAL_ERROR";
  if (status >= 500)
    message =
      MESSAGES[code] ||
      MESSAGES[status === 503 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR"];
  const details =
    status < 500 && error.details && typeof error.details === "object"
      ? error.details
      : undefined;
  return {
    status,
    code,
    message: message || "요청을 처리하지 못했습니다.",
    details,
  };
}
function apiContext(req, res, next) {
  if (req.apiRequestId) return next();
  // Always generate a server ID: untrusted caller headers are not log identifiers.
  req.apiRequestId = randomUUID();
  res.setHeader("X-Request-Id", req.apiRequestId);
  const json = res.json.bind(res);
  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === "object" &&
      typeof body.error === "string"
    ) {
      const normalized = normalizeError({
        statusCode: res.statusCode,
        code: body.code,
        message: body.error,
        details: body.details,
      });
      const safeDetails = normalized.status < 500 ? body.details : undefined;
      const extra =
        normalized.status < 500
          ? Object.fromEntries(
              Object.entries(body).filter(([key]) =>
                ["required", "available", "field"].includes(key),
              ),
            )
          : {};
      body = {
        ...extra,
        error: normalized.message,
        code: normalized.code,
        requestId: req.apiRequestId,
        ...(safeDetails ? { details: safeDetails } : {}),
      };
    }
    return json(body);
  };
  next();
}
function sendError(req, res, error) {
  if (!req.apiRequestId) apiContext(req, res, () => {});
  const result = normalizeError(error);
  if (result.status >= 500)
    console.error(
      JSON.stringify({
        requestId: req.apiRequestId,
        code: result.code,
        name: error.name || "Error",
      }),
    );
  const body = {
    error: result.message,
    code: result.code,
    requestId: req.apiRequestId || randomUUID(),
  };
  if (result.details)
    Object.assign(body, { details: result.details }, result.details);
  return res.status(result.status).json(body);
}
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  sendError(req, res, error);
}
module.exports = {
  apiError,
  normalizeError,
  apiContext,
  sendError,
  errorHandler,
  DEFAULT_CODES,
};
