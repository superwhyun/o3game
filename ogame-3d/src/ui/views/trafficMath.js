export function ownerColor(ownerKey, isSelf) {
  if (isSelf) return '#54e0d2';
  let hash = 2166136261;
  for (const char of ownerKey) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const palette = ['#f4ad68', '#b6a0ff', '#ff82ac', '#90cf73', '#73bafa', '#e4d175'];
  return palette[(hash >>> 0) % palette.length];
}
export function progressOf(startedAt, endsAt, now) {
  const start = +new Date(startedAt), end = +new Date(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
}
export function curveOf(from, to, offset = 0) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
  const bend = 35 + offset * 18;
  return { from, to, control: { x: (from.x + to.x) / 2 - dy / length * bend, y: (from.y + to.y) / 2 + dx / length * bend } };
}
export function pointOnCurve({ from, to, control }, t) {
  return { x: (1-t)**2*from.x + 2*(1-t)*t*control.x + t*t*to.x, y: (1-t)**2*from.y + 2*(1-t)*t*control.y + t*t*to.y };
}
export const endpointLabel = p => p.planet !== undefined ? `${p.planet}궤도` : `[${p.galaxy}:${p.system}] 성계`;
