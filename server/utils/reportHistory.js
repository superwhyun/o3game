const { apiError } = require("./apiErrors");
function pagination(query, defaultLimit) {
  const numbered = query.page !== undefined;
  const page = numbered ? Number(query.page) : 1;
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (numbered && (query.cursor !== undefined || query.before !== undefined))
  ) {
    throw apiError(
      400,
      "INVALID_REQUEST",
      "페이지 또는 목록 크기가 올바르지 않습니다.",
    );
  }
  return { numbered, page, limit, offset: numbered ? (page - 1) * limit : 0 };
}
const metadata = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});
function deleteIds(body) {
  if (
    !body ||
    !Array.isArray(body.ids) ||
    body.ids.length < 1 ||
    body.ids.length > 50 ||
    body.ids.some(
      (id) => typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id),
    ) ||
    new Set(body.ids.map((id) => id.toLowerCase())).size !== body.ids.length
  ) {
    throw apiError(
      400,
      "INVALID_REQUEST",
      "삭제할 기록 ID를 1~50개 선택해 주세요.",
      { field: "ids" },
    );
  }
  return body.ids;
}
module.exports = { pagination, metadata, deleteIds };
