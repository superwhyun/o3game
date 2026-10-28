const {apiError}=require('../utils/apiErrors');
const mongoose = require('mongoose');
const Movement = require('../models/FleetMovement');
const { GALAXY_COUNT, SYSTEM_COUNT } = require('../utils/universe');
function scope(galaxy, system) {
  if (!Number.isSafeInteger(galaxy) || galaxy < 1 || galaxy > GALAXY_COUNT || !Number.isSafeInteger(system) || system < 1 || system > SYSTEM_COUNT) throw apiError(400, 'INVALID_REQUEST', '성계 좌표가 올바르지 않습니다.');
  return { status: { $in: ['flying', 'returning'] }, $or: [{ 'origin.galaxy': galaxy, 'origin.system': system }, { 'destination.galaxy': galaxy, 'destination.system': system }] };
}
function projection(galaxy, system) {
  const endpoint = path => ({ $cond: [{ $and: [{ $eq: [`${path}.galaxy`, galaxy] }, { $eq: [`${path}.system`, system] }] }, { planet: `${path}.planet` }, { galaxy: `${path}.galaxy`, system: `${path}.system` }] });
  const returning = { $eq: ['$status', 'returning'] };
  return [
    { $project: { username: 1, ownerKey: { $toString: '$userId' }, status: 1, from: { $cond: [returning, endpoint('$destination'), endpoint('$origin')] }, to: { $cond: [returning, endpoint('$origin'), endpoint('$destination')] }, startedAt: { $cond: [returning, { $ifNull: ['$returnStartTime', { $subtract: ['$returnTime', { $subtract: ['$arrivalTime', '$startTime'] }] }] }, '$startTime'] }, endsAt: { $cond: [returning, '$returnTime', '$arrivalTime'] } } },
    { $set: { route: { ownerKey: '$ownerKey', status: '$status', from: '$from', to: '$to' } } },
  ];
}
const routeId = route => Buffer.from(JSON.stringify(route)).toString('base64url');
function publicRow(row, userId) {
  return { id: String(row._id), routeId: routeId(row.route), ownerKey: row.ownerKey, username: row.username, isSelf: row.ownerKey === String(userId), status: row.status, from: row.from, to: row.to, startedAt: row.startedAt, endsAt: row.endsAt };
}
async function list(userId, query) {
  const galaxy = Number(query.galaxy), system = Number(query.system);
  const match = scope(galaxy, system);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw apiError(400, 'INVALID_REQUEST', '목록 크기가 올바르지 않습니다.');
  const pipeline = [{ $match: match }, ...projection(galaxy, system)];
  const detail = [...pipeline];
  if (query.route) {
    if (typeof query.route !== 'string' || query.route.length > 1024) throw apiError(400, 'INVALID_REQUEST', '항로가 올바르지 않습니다.');
    let route;
    try { route = JSON.parse(Buffer.from(query.route, 'base64url').toString()); } catch { throw apiError(400, 'INVALID_REQUEST', '항로가 올바르지 않습니다.'); }
    if (!route || typeof route.ownerKey !== 'string' || !['flying','returning'].includes(route.status)) throw apiError(400, 'INVALID_REQUEST', '항로가 올바르지 않습니다.');
    const routeMatch = { ownerKey: route.ownerKey, status: route.status };
    for (const key of ['from', 'to']) {
      const point = route[key];
      if (!point || typeof point !== 'object') throw apiError(400, 'INVALID_REQUEST', '항로가 올바르지 않습니다.');
      const fields = point.planet === undefined ? ['galaxy','system'] : ['planet'];
      if (Object.keys(point).length !== fields.length || fields.some(field=>!Number.isSafeInteger(point[field]) || point[field]<1)) throw apiError(400, 'INVALID_REQUEST', '항로가 올바르지 않습니다.');
      for (const field of fields) routeMatch[`${key}.${field}`] = point[field];
      routeMatch[`${key}.${point.planet === undefined ? 'planet' : 'galaxy'}`] = { $exists: false };
    }
    detail.push({ $match: routeMatch });
  }
  if (query.cursor) {
    if (!mongoose.isValidObjectId(query.cursor)) throw apiError(400, 'INVALID_REQUEST', '페이지 위치가 올바르지 않습니다.');
    detail.push({ $match: { _id: { $gt: new mongoose.Types.ObjectId(query.cursor) } } });
  }
  const [groups, rows] = await Promise.all([
    Movement.aggregate([...pipeline, { $sort: { endsAt: 1, _id: 1 } }, { $group: { _id: '$route', count: { $sum: 1 }, first: { $first: '$$ROOT' } } }]),
    Movement.aggregate([...detail, { $sort: { _id: 1 } }, { $limit: limit + 1 }]),
  ]);
  const routes = groups.map(g => ({ ...publicRow(g.first, userId), id: routeId(g._id), count: g.count }));
  return { galaxy, system, serverTime: new Date(), routes, total: groups.reduce((n, g) => n + g.count, 0), movements: rows.slice(0, limit).map(r => publicRow(r, userId)), nextCursor: rows.length > limit ? String(rows[limit - 1]._id) : null };
}
module.exports = { list, scope, projection };
