const { atomic, requireTransactions } = require('./transactions');
const { settleUserState, formatQueueItem } = require('./GameStateService');
const Queue = require('../models/BuildingQueue');
const { calculateArea, planetIndex, TERRAFORMING_MAX_LEVEL } = require('../utils/planetArea');
const { calculateBuildingCost, calculateResearchCost, calculateUnitCost, calculateQueueDuration, getEntityDefinition } = require('../utils/gameCalculations');
const activeFilter = userId => ({ userId, applied: false, status: { $in: ['building', 'pending'] } });
function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, statusCode: 400, details });
}
function checkRequirements(user, planet, requirements = {}) {
  for (const [id, level] of Object.entries(requirements.buildings || {})) {
    if ((planet.buildings?.[id] || 0) < level) fail('REQUIREMENTS_NOT_MET', `시설 ${id} Lv ${level} 필요`);
  }
  for (const [id, level] of Object.entries(requirements.research || {})) {
    const current = id === 'terraforming' ? user.terraformingLevel : planet.research?.[id];
    if ((current || 0) < level) fail('REQUIREMENTS_NOT_MET', `기술 ${id} Lv ${level} 필요`);
  }
}
async function enqueue(userId, { type, itemId, planetId, count = 1, action = 'upgrade' }) {
  await requireTransactions();
  return atomic(async () => {
    const settled = await settleUserState(userId);
    if (!settled) fail('INVALID_USER', '사용자를 찾을 수 없습니다.');
    const { user, config } = settled;
    const index = planetIndex(user, planetId);
    const planet = user.planets[index];
    const definition = getEntityDefinition(type, itemId);
    if (!definition || !['building', 'research', 'ship', 'defense'].includes(type)) fail('INVALID_ENTITY', '잘못된 항목입니다.');
    if (!['upgrade', 'demolish'].includes(action) || (action === 'demolish' && type !== 'building')) fail('INVALID_ACTION', '잘못된 명령입니다.');
    if (!Number.isSafeInteger(count) || count < 1 || count > 9999) fail('INVALID_COUNT', '수량은 1~9999 사이의 정수여야 합니다.');
    const queues = await Queue.find(activeFilter(userId)).sort({ endTime: 1, createdAt: 1 });
    const matching = queues.filter(q => q.type === type && q.itemId === itemId
      && (itemId === 'terraforming' || String(q.planetId) === String(index)));
    const current = type === 'building' ? (planet.buildings[itemId] || 0)
      : itemId === 'terraforming' ? (user.terraformingLevel || 0) : (planet.research?.[itemId] || 0);
    const projected = matching.length ? matching.at(-1).level : current;
    const nextLevel = action === 'demolish' ? current - 1 : projected + 1;
    let cost = {};
    if (action === 'demolish') {
      if (current < 1 || matching.length) fail('BUILDING_BUSY', '철거할 시설이 없거나 해당 시설의 작업이 진행 중입니다.');
      for (const q of queues.filter(q => String(q.planetId) === String(index))) {
        const req = getEntityDefinition(q.type, q.itemId)?.requirements?.buildings || {};
        if ((req[itemId] || 0) > nextLevel || (itemId === 'researchLab' && q.type === 'research')) {
          fail('BUILDING_BUSY', '진행 중인 작업에 필요한 시설은 철거할 수 없습니다.');
        }
      }
    } else {
      // Pending demolition cannot serve as a prerequisite for a new order.
      const effectiveBuildings = planet.buildings.toObject ? planet.buildings.toObject() : { ...planet.buildings };
      for (const q of queues.filter(q => String(q.planetId) === String(index) && q.action === 'demolish')) effectiveBuildings[q.itemId] = q.level;
      checkRequirements(user, { buildings: effectiveBuildings, research: planet.research }, definition.requirements);
      if (matching.some(q => q.action === 'demolish')) fail('BUILDING_BUSY', '철거 중인 시설입니다.');
      if (type === 'building') {
        const area = calculateArea(planet, user.terraformingLevel, queues, String(index));
        if (area.available < 1) fail('INSUFFICIENT_AREA', `건설 공간 부족: 필요 1칸 / 남은 ${area.available}칸`, { required: 1, available: area.available });
        cost = await calculateBuildingCost(itemId, nextLevel);
      } else if (type === 'research') {
        if (itemId === 'terraforming' && (projected >= TERRAFORMING_MAX_LEVEL || user.planets.every(p => calculateArea(p, projected).usablePercent >= 100))) fail('TERRAFORMING_MAX_LEVEL', '테라포밍 최대 단계이거나 모든 행성의 가용률이 100%입니다.');
        cost = await calculateResearchCost(itemId, projected);
      } else cost = await calculateUnitCost(type, itemId, count);
      for (const resource of ['metal', 'crystal', 'deuterium']) {
        const value = cost?.[resource] ?? 0;
        if (!Number.isFinite(value) || value < 0) fail('INVALID_COST', '비용 계산 실패');
        if ((planet.resources[resource] || 0) < value) fail('INSUFFICIENT_RESOURCES', '자원이 부족합니다.');
      }
    }
    const duration = calculateQueueDuration(type, itemId, action === 'demolish' ? current : nextLevel, planet.buildings, count, {
      serverSpeed: config.serverSpeed,
      timeMultiplier: type === 'building' ? config.buildingSettings?.buildTimeMultiplier : type === 'research' ? config.researchSettings?.researchTimeMultiplier : 1
    });
    const sameType = queues.filter(q => q.type === type && (type === 'research' || String(q.planetId) === String(index)));
    const last = sameType.at(-1);
    const now = new Date();
    const startTime = last ? new Date(Math.max(now.getTime(), new Date(last.endTime).getTime())) : now;
    for (const resource of ['metal', 'crystal', 'deuterium']) planet.resources[resource] -= cost[resource] || 0;
    const queueItem = await Queue.create({ userId, planetId: String(index), type, itemId, action,
      name: `${action === 'demolish' ? '철거 · ' : ''}${definition.display.name}`, icon: definition.display.icon,
      level: nextLevel, count, duration, startTime, endTime: new Date(startTime.getTime() + duration * 1000),
      status: last ? 'pending' : 'building', costSnapshot: cost });
    user.markModified('planets');
    await user.save();
    const refreshed = await settleUserState(userId);
    return { message: action === 'demolish' ? 'Demolition started' : 'Construction started',
      queueItem: formatQueueItem(queueItem), snapshot: refreshed.snapshot };
  });
}
async function cancel(userId, queueId) {
  await requireTransactions();
  return atomic(async () => {
    const { user, config } = await settleUserState(userId);
    const queue = await Queue.findOne({ ...activeFilter(userId), _id: queueId });
    if (!queue) fail('QUEUE_NOT_ACTIVE', '이미 완료되었거나 취소된 작업입니다.');
    // Keep level/cost reservations coherent: cancel later levels first.
    const later = await Queue.findOne({ ...activeFilter(userId), type: queue.type, itemId: queue.itemId,
      ...(queue.itemId === 'terraforming' ? {} : { planetId: queue.planetId }), level: { $gt: queue.level } });
    if (['building', 'research'].includes(queue.type) && later) fail('DEPENDENT_QUEUE', '같은 항목의 뒤쪽 예약부터 취소해 주세요.');
    const planet = user.planets[planetIndex(user, queue.planetId)];
    const rate = queue.status === 'pending' ? 1 : (config.resourceSettings?.cancellationRefundRate ?? 0.8);
    for (const resource of ['metal', 'crystal', 'deuterium']) planet.resources[resource] += Math.floor((queue.costSnapshot?.[resource] || 0) * rate);
    queue.status = 'cancelled'; await queue.save();
    user.markModified('planets'); await user.save();
    const refreshed = await settleUserState(userId);
    return { message: 'Cancelled', refundApplied: queue.action !== 'demolish', snapshot: refreshed.snapshot };
  });
}
async function selectPlanet(userId, planetId) {
  return atomic(async () => {
    const { user } = await settleUserState(userId);
    user.currentPlanet = planetIndex(user, planetId);
    await user.save();
    return { snapshot: (await settleUserState(userId)).snapshot };
  });
}
module.exports = { enqueue, cancel, selectPlanet, checkRequirements };
