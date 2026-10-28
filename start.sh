#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

command -v node >/dev/null || { echo 'Node.js 22 이상이 필요합니다.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null

# Keep existing credentials; create persistent development secrets on first run.
node --input-type=module <<'JS'
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
const path = 'server/.env';
let content = readFileSync(existsSync(path) ? path : 'server/.env.example', 'utf8');
const env = parseEnv(content);
const defaults = new Set(['your-secret-key', 'your-super-secret-jwt-key-change-in-production']);
for (const key of ['JWT_SECRET', 'AI_WORKER_SECRET']) {
  const value = process.env[key] || env[key];
  if (!value || value.trim().length < 32 || defaults.has(value)) {
    if (process.env[key]) throw new Error(`${key}: 32자 이상의 유효한 값을 설정하세요.`);
    content = content.replace(new RegExp(`^${key}=.*(?:\\r?\\n|$)`, 'gm'), '');
    content += `\n${key}=${randomBytes(32).toString('hex')}\n`;
  }
}
writeFileSync(path, content, { mode: 0o600 });
chmodSync(path, 0o600);
JS

# Reuse the running installation's project and database volume.
project="${COMPOSE_PROJECT_NAME:-$(docker inspect ogame-mongo --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)}"
project="${project:-o3game}"
compose=(docker compose --env-file server/.env -p "$project" -f docker-compose.yml)

"${compose[@]}" up -d mongodb redis
echo 'MongoDB 준비 중…'
db_ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if "${compose[@]}" exec -T mongodb mongosh --quiet --eval '
    try { rs.status(); }
    catch (error) {
      if (error.code !== 94) throw error;
      const result = rs.initiate({_id:"oogame",members:[{_id:0,host:"mongodb:27017"}]});
      if (!result.ok) throw new Error(JSON.stringify(result));
    }
    if (!db.hello().isWritablePrimary) quit(1);
  ' >/dev/null 2>&1; then
    db_ready=true
    break
  fi
  sleep 2
done
if [[ "$db_ready" != true ]]; then
  echo 'MongoDB 준비에 실패했습니다. docker logs ogame-mongo 로 확인하세요.' >&2
  exit 1
fi

"${compose[@]}" up -d --build --wait --wait-timeout 240
echo
echo "게임: http://localhost:${CLIENT_PORT:-5173}"
echo "백엔드: http://localhost:${SERVER_PORT:-3999}/ready"
echo '로그: docker logs -f ogame-server (또는 ogame-client, ogame-ai-player)'
