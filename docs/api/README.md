# Cosmic Empire API 명세

기준: 2026-10-09 현재 서버 코드. [OpenAPI 3.0.3 명세](openapi.json)는 77개 HTTP 작업을 담고 있으며 Swagger Editor나 Postman에서 가져올 수 있습니다. [오류 처리 점검 결과](ERROR-AUDIT.md)도 함께 읽어 주세요. 공통 오류 계약과 입력 검증은 서버에 적용되어 있습니다. 운영 배포 범위와 별도 검증 항목은 오류 처리 문서에 구분했습니다.

## 접속과 인증

- 현재 Docker 직접 접속: `http://<서버 주소>:3999`. 컨테이너 내부 서버 포트 기본값은 3000입니다. 저장소 docker-compose.yml의 호스트 포트도 3000이므로 새 설치 시 포트 매핑을 확인하세요.
- 게임 화면과 같은 주소: `http://<서버 주소>:5173/api/...`. Vite가 `/api`와 `/socket.io`를 서버로 프록시합니다. `/health`는 이 프록시에 포함되지 않습니다.
- 요청 본문은 `Content-Type: application/json`. 로그인 이후 `Authorization: Bearer <token>`을 보냅니다.
- 신규 가입/최초 관리자 비밀번호는 6자 이상, UTF-8 기준 72바이트 이하입니다. 로그인은 기존 계정 호환을 위해 최대 128자를 허용합니다.
- 로그인 토큰 만료는 7일입니다. refresh token이나 서버 logout/revoke API는 현재 없습니다. 클라이언트 로그아웃은 저장 토큰을 삭제합니다.
- 브라우저의 다른 origin에서 호출하려면 서버의 `CLIENT_URL` CORS 설정이 필요합니다. 브라우저 외 HTTP 클라이언트에는 CORS가 적용되지 않습니다.
- 문서 버전 `2026-10-09.11`는 문서 기준일입니다. `/api/v1` 경로나 호환성 보장 정책은 아직 구현되어 있지 않습니다.

```sh
curl -X POST 'http://localhost:3999/api/auth/login' \
  -H 'Content-Type: application/json' \
  --data '{"username":"사용자명","password":"비밀번호"}'
```

성공: `{"token":"JWT...","user":{"id":"...","username":"...","email":"...","isAdmin":false}}`.

```sh
curl 'http://localhost:3999/api/auth/me' \
  -H 'Authorization: Bearer <로그인 응답 token>'
```

`/auth/me`는 `GameSnapshot`을 직접 반환합니다. 주요 값은 `planets`, `currentPlanet`, `research`, `fleetFormations`, `unassignedShips`, `queueState`, `fleetMovements`, `serverTime`, `stateRevision`입니다. 명령 응답에 `snapshot`이 있으면 같은 구조입니다.

## ID와 시간 규칙

- 일반 행성·함대·기록 ID는 응답에서 받은 MongoDB ObjectId 문자열입니다.
- **대기열 API의 `planetId`만 0부터 시작하는 행성 인덱스 문자열입니다.** 예: `"0"`. 현재 구현은 이 필드에 행성 ObjectId를 지원하지 않습니다. 생략 시 현재 선택 행성을 사용합니다.
- `currentPlanet`은 인덱스 숫자, `planets[index]._id`는 ObjectId입니다. 두 값을 구분하세요.
- 좌표: `{galaxy, system, planet}`. 각각 1~9, 1~499, 1~15의 정수입니다.
- 날짜는 JSON의 ISO 8601 문자열, `duration`/`remaining`은 초입니다. 자원 생산량은 시간당이며 `energyState`는 생산·소비·잔여 전력량입니다.
- `expectedRevision`에는 **함대 편성의 `revision`**을 넣습니다. 전체 사용자 `stateRevision`과 다릅니다.
- 엔티티 ID와 비용·선행조건은 `GET /api/game/catalog`의 `entities` 배열에서 읽습니다. 개별 항목은 `entityType`, `entityId`, `display`, `requirements`, `costModel`, `timeModel`, `effects`, `stats`를 제공합니다.
- 추가 응답 필드는 무시할 수 있게 구현하세요. 명세의 확장 가능한 객체는 모든 내부 모델 필드를 고정하지 않았습니다.

## HTTP 기능 목록

모든 경로의 요청 필드와 응답 형태는 `openapi.json`에 있습니다. 인증 없는 경로는 `/health`, 회원 가입, 로그인, 관리자 존재 확인과 최초 관리자 생성입니다. 나머지는 사용자 토큰이 필요합니다.

| 구분 | 경로와 사용법 |
| --- | --- |
| 인증 | `POST /api/auth/register`, `/login`, `/setup-admin`; `GET /api/auth/me`, `/check-admin` |
| 대기열 | `GET /api/queue`; `POST /api/queue/build`, `/demolish`, `/research`, `/ship`, `/planet`, `/check/{id}`; `DELETE /api/queue/{id}` |
| 행성 | `PATCH /api/game/planets/{planetId}/name`; `POST /api/game/trade` |
| 카탈로그·성계 | `GET /api/game/catalog`, `/galaxy?galaxy=1&system=1`, `/galaxy/traffic?galaxy=1&system=1` |
| 함대 편성 | `GET/POST /api/game/fleet-formations`; `PATCH/DELETE /api/game/fleet-formations/{id}` |
| 출격·복귀 | `GET/POST /api/game/fleets`; `GET /api/game/fleet-requests/{requestId}`; `POST /api/game/fleets/{id}/recall` |
| 정찰 | `POST /api/game/scouts`; `GET /api/game/scout-reports`, `/scout-reports/{id}`, `/scout-alerts`; `DELETE /api/game/scout-reports` |
| 전투 기록 | `GET /api/game/reports`; `PATCH /api/game/reports/{id}/read`; `DELETE /api/game/reports` |
| 개선요청 | `GET/POST /api/game/improvement-requests`; 관리자 `PATCH /{id}/review`, `DELETE /{id}` |
| 관리자 | `/api/admin/config`, `/speed`, `/stats`, `/users`, `/users/{userId}`, `/users/{userId}/resources`, `/maintenance`, `/announcement`, `/logs`, `/entity-config` 및 하위 작업 |

관리자 조회·공지·자원 추가·개선요청 검토/삭제는 `isAdmin=true`가 필요합니다. 게임 설정·배율·사용자 수정/삭제·엔티티 수정에는 추가로 `adminRole=superadmin`이 필요합니다. `/api/admin/logs`는 현재 빈 목록만 반환합니다. 정지 계정은 로그인·HTTP·Socket.IO 인증이 차단됩니다. 점검 모드는 /api/game 및 /api/queue 변경 명령을 차단하고 조회·관리자 복구는 허용합니다.

## 건설과 연구

```json
POST /api/queue/build
{"buildingId":"metalMine","planetId":"0"}
```

성공 응답: `{message, queueItem, snapshot}`. 예약 시 자원이 차감되며 서버가 완료를 적용합니다. `POST /api/queue/check/{id}`의 `completed`는 실제 적용 완료 여부입니다. 일반 대기열 등록에는 출격처럼 `requestId` 중복 방지가 없으므로 통신 실패 후 무조건 다시 등록하면 중복 작업이 생길 수 있습니다.

연구는 사용자 전체에 귀속됩니다. `planetId`는 비용을 지불하고 출발 연구소를 제공하는 행성입니다. 연구 네트워크는 서버가 선행조건에 맞는 연구소를 연결합니다. 연구소 건설/철거와 공통 연구는 동시에 진행할 수 없습니다. 방어 시설은 `/api/queue/ship`에 `entityType:"defense"`와 방어 시설 ID를 `shipId`로 보냅니다.

## 함대 출격 절차와 재시도

1. `/auth/me`로 선택 행성과 보유 함선을 조회합니다. 필요하면 `/queue/planet`에 인덱스를 보내 출발 행성을 선택합니다.
2. `/fleet-formations`에 `{originPlanetId:"행성 ObjectId"}`로 빈 편성을 만듭니다.
3. 편성 ID로 PATCH: `{name:"1함대", ships:{smallCargo:2}, expectedRevision:0}`. 실제 보유 함선 및 최신 revision을 사용합니다.
4. `/galaxy`에서 목적지와 대상 행성 ID를 확인합니다. 타 제국 정보는 본인의 정찰 범위에 따라 공개됩니다.
5. `/fleets`에 다음 형식으로 명령을 보냅니다.

```json
{
  "requestId":"12345678-1234-4234-8234-123456789abc",
  "formationId":"함대 ObjectId",
  "originPlanetId":"출발 행성 ObjectId",
  "expectedTargetPlanetId":"대상 행성 ObjectId",
  "expectedRevision":1,
  "mission":"transport",
  "destination":{"galaxy":1,"system":1,"planet":9},
  "cargo":{"metal":100,"crystal":0,"deuterium":0},
  "speed":100
}
```

예시의 ID 자리표시자는 실제 ID로 바꿔야 합니다. 공격은 `mission:"attack"`, 개척은 `mission:"colonize"`입니다. 개척에서는 `expectedTargetPlanetId`를 생략하고 `colonists`를 지정합니다(기본 10명). 식민선이 있어야 하며 인구 1명은 적재 공간 1을 사용합니다. 성공한 개척은 식민선 1척을 소비하고 자원·인구를 새 행성에 정착시킵니다. 속도는 10~100 사이 10단위입니다. 현재 출격 연료는 차감하지 않습니다.

`requestId`는 16~80자의 영문·숫자·하이픈입니다. UUID를 쓰면 됩니다. 새 출격마다 새 ID를 만들고, **같은 출격의 통신 실패 재시도에는 같은 ID와 같은 본문**을 사용합니다. 같은 ID로 다른 명령을 보내면 충돌입니다. 응답이 유실되면 먼저 `GET /api/game/fleet-requests/{requestId}`를 조회하세요. `404`는 그 순간 저장된 이동이 없다는 뜻이며, 원래 요청이 아직 진행 중일 수도 있습니다.

`201` 응답에 `snapshotPending:true`가 있어도 **출격은 성공한 상태**입니다. 새 ID로 다시 출격하지 말고 상태를 다시 조회하세요. `409`라면 최신 편성·대상 상태를 조회하고 사용자 의도를 다시 확인합니다. 안전한 재시도가 자동 보장되는 것은 출격/정찰 요청 ID 처리와 이미 취소한 함대의 복귀 요청 등 일부 작업입니다.

## 정찰, 전투와 페이지 이동

정찰은 별도 편성 없이 미배정 정찰선 1척을 사용합니다.

```json
POST /api/game/scouts
{"requestId":"12345678-1234-4234-8234-123456789abd","originPlanetId":"행성 ObjectId","destination":{"galaxy":1,"system":1,"planet":11}}
```

정찰 기록의 `sections`는 정보 단계에 따라 일부 항목만 있습니다. 누락은 0이라는 뜻이 아닙니다. `sections.environment`와 성계 응답의 `survey`는 관측 당시 정보입니다. 관측 이후 소유권이나 이름이 바뀔 수 있습니다.

- 정찰 기록/알림: `limit` 기본 20, 최대 50. `nextCursor`를 다음 요청의 `cursor`에 그대로 넣습니다. 좌표 필터는 세 좌표 모두 전달합니다.
- 전투 기록/개선요청: 기본 페이지 50건. `nextCursor`를 다음 요청의 `before`에 넣습니다.
- 성계 교통: `limit` 기본 50, 최대 100. `nextCursor`는 `cursor`, 항로의 `routeId`는 `route`로 전달합니다.
- 관리자 사용자 목록: `page`/`limit` 방식. 기본 1/50.

정찰·전투 기록은 `?page=1&limit=20` 방식의 번호 페이지 조회도 지원합니다. `limit`은 1~50이며 응답의 `pagination`은 `{page,limit,total,totalPages}`입니다. `page`와 `cursor`/`before`를 함께 보내면 `400 INVALID_REQUEST`입니다. 기존 커서 방식은 그대로 사용할 수 있습니다.

선택 삭제는 `DELETE /api/game/scout-reports` 또는 `DELETE /api/game/reports`에 `{"ids":["기록 ObjectId", "기록 ObjectId"]}`를 보냅니다. 서로 다른 ID 1~50개만 허용합니다. 성공 응답은 `{"deletedCount":2}`이며 재시도해도 안전합니다. 다른 사용자의 기록 또는 존재하지 않는 ID가 포함되면 전체 요청이 `404 NOT_FOUND`로 실패합니다. 삭제는 본인 목록에만 적용되며 상대방의 전투 기록, 상대방의 정찰 탐지 알림, 정찰 지식은 유지됩니다. 정찰 목록의 좌표 필터 조회는 성계 상세의 관측 정보에 사용하므로 삭제한 기록도 포함할 수 있습니다. 삭제된 정찰 기록의 단건 조회는 404입니다.

전투 기록의 `result`에 승자·손실·약탈량·잔해가 있습니다. 약탈 자원이 출발 행성에 돌아오는 시점은 실제 귀환 시점입니다. 현재 연료 기록은 `fuelPolicy:"notCharged"`, `fuelConsumed:{deuterium:0}`입니다. 과거 기록의 `fuelConsumed:null`은 미기록입니다.

## 오류와 호출 제한

모든 HTTP 오류는 다음 JSON 형식을 사용합니다. 기존 화면이 사용하는 `error` 문자열을 유지하고, 모든 오류에 문자열 `code`와 서버 생성 `requestId`를 제공합니다. `X-Request-Id` 응답 헤더도 같은 값입니다. 자세한 오류 코드와 검증 결과는 [ERROR-AUDIT.md](ERROR-AUDIT.md)에 있습니다.

```json
{
  "error":"자원이 부족합니다.",
  "code":"INSUFFICIENT_RESOURCES",
  "requestId":"12345678-1234-4234-8234-123456789abc"
}
```

입력/업무 오류는 선택적인 `details` 객체를 포함할 수 있습니다. 예: `details:{field:"amount"}`. 면적 부족의 `required`/`available`은 기존 화면 호환을 위해 최상위에도 유지합니다. 내부 500/503 예외 메시지·DB 숫자 코드는 공개하지 않습니다. 트랜잭션 미지원은 문자열 `TRANSACTIONS_REQUIRED`로 반환합니다.

| 상태 | 처리 |
| --- | --- |
| 400 | 입력 형식·범위, 잘못된 JSON/ID, 게임 조건 확인 |
| 401 | AUTH_REQUIRED / AUTH_INVALID_TOKEN / AUTH_TOKEN_EXPIRED / AUTH_INVALID_CREDENTIALS. 재인증 또는 로그인 입력 확인 |
| 403 | FORBIDDEN / ACCOUNT_BANNED. 권한 또는 계정 상태 확인 |
| 404 | NOT_FOUND / ROUTE_NOT_FOUND. 대상 또는 경로 확인 |
| 405 | METHOD_NOT_ALLOWED. Allow 헤더의 메서드 사용 |
| 409 | 상태·중복값 충돌. 최신 상태 조회 후 명령 재검토 |
| 413 | PAYLOAD_TOO_LARGE. JSON 본문 10MB 제한 |
| 415 | UNSUPPORTED_MEDIA_TYPE. 변경 요청 본문은 application/json 사용 |
| 429 | RATE_LIMITED. Retry-After 대기 초 및 RateLimit-* 헤더 확인 |
| 500 | INTERNAL_ERROR. 내부 예외 원문 비공개. requestId로 운영자에게 문의 |
| 503 | SERVICE_UNAVAILABLE / TRANSACTIONS_REQUIRED / MAINTENANCE_MODE. 서비스 복구 또는 DB/점검 상태 확인 |

- 일반 `/api` 제한: 인증 사용자별 분당 120회. 토큰이 없거나 유효하지 않으면 IP별로 제한합니다.
- 로그인/회원 가입/최초 관리자 생성: 위 제한에 더해 IP별 15분당 100회(세 경로의 제한을 공유). 인증 제한도 JSON RATE_LIMITED를 반환합니다.
- 테스트 환경에서는 HTTP 제한값이 1000으로 바뀝니다.
- `5xx`는 제한적으로 백오프하되 변경 명령은 상태를 먼저 확인합니다. 출격/정찰은 requestId를 유지합니다. 일반 명령의 범용 Idempotency-Key는 아직 지원하지 않습니다.
- 오류 메시지 문구가 아닌 code로 분기하세요. OpenAPI의 x-error-codes에는 공통 실패 코드도 포함됩니다. 새 코드를 받을 때도 상태와 표시 메시지로 처리할 수 있는 기본 분기를 두세요.
- `/health`는 실행 여부, `/ready`는 DB ping 및 트랜잭션 준비 여부입니다. 현재 Vite 프록시에 둘 다 포함되지 않으므로 서버 직접 주소로 조회합니다.

## Socket.IO 계약

Socket.IO는 순수 WebSocket JSON 프로토콜이 아닙니다. `socket.io-client` 등 Socket.IO 호환 클라이언트로 서버 origin에 연결합니다. 기본 경로는 `/socket.io`, 현재 화면은 `transports:["websocket"]`를 사용합니다.

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:3999', { transports: ['websocket'] });
socket.on('planetData', snapshot => { /* 최신 상태 반영 */ });
socket.on('fleetStateChanged', () => { /* GET /api/game/fleets 또는 /auth/me 재조회 */ });
socket.on('auth_error', message => { /* 인증 실패 표시 */ });
socket.on('apiError', error => { /* {error,message,code,status,requestId} */ });
socket.on('error', error => { /* 이전 클라이언트 호환 오류 이벤트 */ });
socket.on('connect', () => socket.emit('authenticate', token));
```

| 방향 | 이벤트 | 데이터/동작 |
| --- | --- | --- |
| 클라이언트 → 서버 | `authenticate` | JWT 문자열. 재연결 시 다시 전송. 만료·계정 정지 및 삭제 여부 검사 |
| 서버 → 클라이언트 | `authenticated` / `auth_error` | `{username}` / 오류 문자열 |
| 클라이언트 → 서버 | `getPlanetData` | 본문 없음. `planetData` 전체 스냅샷 수신 |
| 클라이언트 → 서버 | `getGalaxy` | `{galaxy,system}`. `galaxyData`; HTTP와 같은 본인 정찰 공개 규칙 및 positions 형식 |
| 클라이언트 → 서버 | `getBattleReports` | 본문 없음. `battleReports` 목록; 페이지·읽음 처리는 HTTP 사용 |
| 서버 → 클라이언트 | `apiError` | `{error,message,code,status,requestId}`. 모든 등록 이벤트 오류에 제공 |
| 서버 → 클라이언트 | `fleetStateChanged` | 본문 없음. 출격·복귀·처리 후 재조회 신호 |
| 서버 → 클라이언트 | `gameConfigUpdated` | 게임 설정 객체 |
| 서버 → 클라이언트 | `serverSpeedChanged` | `{speed}` |
| 서버 → 클라이언트 | `entityConfigUpdated` | `{entityType, entityId?, revision}` |
| 서버 → 클라이언트 | `maintenanceMode` | `{enabled,message?}` |
| 서버 → 클라이언트 | `adminAnnouncement` | `{message,type,from}` |

등록 이벤트는 ack 콜백을 지원합니다. 성공은 `{ok:true,requestId}`, 실패는 `{ok:false,error:{error,message,code,status,requestId}}`입니다. 실패 시 `apiError`도 전송합니다. `auth_error` 문자열 및 `error` 이벤트는 이전 화면 호환을 위해 유지합니다. 인증 시도는 서버 프로세스 내 IP별 분당 120회, 인증 후 이벤트는 사용자별 분당 120회입니다. 인증 후 요청마다 토큰·계정 상태를 다시 확인합니다.

코드에 남아 있는 Socket.IO `build`, `research`, `buildShip`, `sendFleet` 메서드는 현재 서버 연결 핸들러에 등록되어 있지 않습니다. 게임 명령은 HTTP API를 사용하세요. 개별 건설 완료 이벤트를 구독하면 항상 알림이 온다고 보장하지 않습니다. 서버의 완료 정산 주기는 현재 5초이며, 클라이언트는 스냅샷 재조회로 상태를 확인해야 합니다.

## 명세 갱신과 검증

라우트나 오류 계약을 바꾸면 OpenAPI와 이 문서도 함께 갱신합니다. 라우트 공통 입력 검증과 업무별 검증을 적용합니다. OpenAPI 전체 스키마를 런타임 validator로 그대로 실행하는 구조는 아닙니다. HTTP 전체 라우트 포함 여부는 `server/scripts/checkApiSpec.js`로 검사할 수 있습니다. 오류 특성 회귀 테스트는 `server/test/apiErrorAudit.integration.test.js`이며 별도 테스트 DB와 실제 서버 미들웨어로 실행합니다.

AI 모델 등록·플레이어 관리·API 전용 실행 프로그램은 [AI-PLAYERS.md](AI-PLAYERS.md)를 참조하세요. OpenRouter, Vercel AI Gateway, 로컬 OpenAI 호환 API를 지원합니다.

관리자 `GET /api/admin/users/{userId}`는 사용자 기본 정보와 `gameSnapshot`, `gameCatalog`를 제공합니다. 최신 생산·완료 작업을 정산한 행성별 자원/생산/에너지/인구/개발 면적/건물/함선/미편성 함선/방어, 사용자 공통 연구, 전체 대기열과 함대 이동을 확인할 수 있습니다. 비밀번호는 반환하지 않으며 일반 사용자의 호출은 403입니다. 유저 관리에서 사용자 이름 또는 상세 버튼으로 열고 행성을 선택해 비교하며 새로고침으로 현재 수치를 다시 읽습니다.

### 단독 개척과 이동시간

`POST /api/game/fleets`에 `mission: "colonize"`를 지정하고 `formationId`를 생략하여 현재 출발 행성의 미배정 식민선 1척을 사용합니다. 편성 함대를 이용한 개척은 지원하지 않으며, `formationId`를 지정한 개척 요청은 `400 INVALID_MISSION`으로 거절합니다. `expectedRevision`은 필요하지 않습니다. `originPlanetId`, `destination`, 고유 `requestId` 및 인구/적재 자원은 기존 개척 규칙을 따릅니다. 편성된 식민선은 직접 출격에 사용할 수 없습니다. 재시도는 동일 본문과 요청 ID를 사용하며 취소는 기존 recall API를 사용합니다.

새 출격의 거리 D는 `100000 × 은하 차이 + (성계 차이가 있으면 2700 + 95 × 성계 차이) + (궤도 차이가 있으면 1000 + 5 × 궤도 차이)`입니다. 동일 좌표는 1입니다. 다른 은하에서도 성계·행성 차이를 합산합니다. 시간(초)은 `ceil((10 + D/100 + (35000/출발속도%) × sqrt(10D/최저함선속도)) / flightSpeedMultiplier)`, 최소 1초입니다. 이동에는 경제·건설의 `serverSpeed`를 적용하지 않습니다. 관리자 설정의 `fleetSettings.flightSpeedMultiplier`(0.1~100, 기본 1)로 정찰·개척·이동·수송·공격을 조절합니다. 화면 예상시간과 서버 계산은 동일합니다. 이미 출발한 임무의 도착/귀환 시각은 변경하지 않습니다. 함대 설정의 부분 저장은 다른 함대 설정을 보존합니다.

### 브라우저의 요청 제한 처리

게임 클라이언트는 동일 계정의 같은 GET 요청이 동시에 진행되면 하나의 HTTP 요청을 공유합니다. `429 RATE_LIMITED` 응답을 받으면 `Retry-After` 기간 동안 추가 HTTP 요청을 보내지 않습니다. 기간 종료 후 다음 조회부터 정상 요청하며 액션을 자동으로 재전송하지 않습니다. 성계도 자동 갱신은 기존 화면을 유지하고 오류 안내를 표시합니다. 함대 상태 자동 갱신은 15초 주기이며, 포커스/소켓/타이머가 겹치는 갱신은 합칩니다. 서버의 사용자별 분당 120회 제한은 유지됩니다.

호출 주기와 화면별 자동 조회량은 [API 호출 점검](API-CALL-AUDIT.md)을 참고하세요.

### 행성 포기

`DELETE /api/game/planets/{planetId}`에 `{"confirmationName":"현재 행성 이름"}`을 보냅니다. 마지막 행성은 `409 LAST_PLANET`, 활성 작업·출발/접근 함대·연구소가 있는 행성의 공통 연구 진행은 `409 PLANET_BUSY`, 이름 불일치는 `400 PLANET_NAME_MISMATCH`입니다. 다른 사용자의 행성과 이미 포기한 ID는 `404 NOT_FOUND`입니다.

성공 응답은 `{abandonedPlanet,snapshot}`입니다. 시설·자원·인구·주둔 함선·방어시설·편성은 소실되고 공통 연구와 다른 행성의 자산은 유지됩니다. 선택 행성과 나머지 행성의 작업 인덱스는 자동 보정합니다. 다른 행성이 있으면 최초 행성도 포기할 수 있습니다. 포기한 자리는 개발 수준에 따른 해적 NPC 거점으로 전환되며 소탕 전에는 점령할 수 없습니다. 기존 비축 자원·함선·연구는 승계하지 않습니다. 소탕 후에는 다시 개척할 수 있으며 이전 자산은 복원되지 않습니다. 이동은 새 행성을 먼저 개척하고 자원·함선을 옮긴 뒤 기존 행성을 포기하는 순서입니다. 현재 일반 사용자의 보유 행성 수에 대한 서버 한도는 별도로 구현되어 있지 않습니다.

관리자 유저 수정·자원 추가 API에서 수정 가능한 자원은 `metal`, `crystal`, `deuterium`, `food`입니다. `energy`는 시설 상태로 자동 계산하므로 직접 수정·추가하면 `400 INVALID_REQUEST`입니다. 유저 상세의 `gameSnapshot.planets[].energyState`에서 생산·소비·수지를 확인합니다.

### 사용자 설정·AI 대리

왼쪽 메뉴의 사용자 설정에서 이메일·비밀번호를 변경하고 심플·상세·그래픽 화면 모드를 저장합니다. 심플은 핵심 작업과 수치 중심, 상세는 설명·수치 중심, 그래픽은 자원 저장량·생산량·인구·행성 개발·에너지 그래프와 자원 추이를 표시합니다. 화면 모드는 계정에 저장되며 새 로그인에도 유지됩니다.

- `GET /api/account/settings`: 계정 정보·환경설정·본인 AI 대리 현황·실행 프로그램 연결 상태
- `PATCH /api/account/settings`: `{uiMode:"simple"|"detailed"|"graphics"}`
- `PATCH /api/account/email`: `{email,currentPassword}`; 이메일 중복 409, 비밀번호 불일치 401. 이메일 확인 메일은 발송하지 않습니다.
- `POST /api/account/password`: `{currentPassword,newPassword}`; 6자 이상/UTF-8 72바이트 이하. 새 token을 반환하며 이전 토큰·웹소켓 세션을 폐기하고 AI 대리를 중지합니다.
- `GET /api/account/ai-models`: 관리자 등록 활성 모델의 공개 메타데이터만 반환합니다.
- `PATCH /api/account/delegation`: `{enabled,modelId,strategy,allowAttacks,intervalSeconds,maxColonies}`. `enabled:false`만으로도 중지할 수 있습니다.

AI 대리는 관리자 등록 모델과 기존 AI 실행 프로그램을 사용합니다. 로그아웃 후에도 내 자원으로 행동합니다. 계정은 일반 사용자로 유지하며 관리자 권한이 있는 사용자도 AI 작업 토큰으로 관리자 API를 호출할 수 없습니다. AI는 HTTP 게임 API 중 건설·연구·조병·함대 편성·정찰·개척과 허용된 공격만 실행합니다. 계정 설정, 모델 관리, 행성 포기, 웹소켓 접속은 허용하지 않습니다. 중지하면 실행 lease를 폐기해 다음 판단·명령을 차단하며 이미 승인된 명령은 완료될 수 있습니다. `maxColonies`는 사용자 전체 한도가 아니라 대리의 개척 목표 한도입니다. 실행 상태·최근 행동·판단 이유·오류는 설정 새로고침으로 확인합니다. 모델 키와 실행 토큰은 사용자에게 노출되지 않습니다.

## 함대 인구와 유지비

함대 편성 저장 시 `stats.crew × 함선 수`만큼 승무원을 자동 배치하고 행성 인구에서 옮깁니다. 추가 인구가 부족하면 전체 변경이 `409 INSUFFICIENT_POPULATION`으로 취소됩니다. 감원·해산 시 행성으로 복귀하며 주거 초과도 허용합니다. 출격·귀환 시에는 승무원을 다시 차감하거나 복귀시키지 않습니다. 전투에서 파괴된 함선의 승무원은 손실 처리하고 전투 기록에 양측 승무원 손실을 남깁니다.

시간당 식량은 배치 승무원 수 × 인구당 식량 소비, 금속·중수소는 함종별 `stats.upkeep` 합계입니다. 서버 속도를 적용하며 정박·출격·귀환 중 모두 보급 기지 행성에서 지속 차감합니다. `planet.production`은 유지비 차감 후 수지, `planet.fleetSupport`는 총 승무원·시간당 비용·부족 자원, 편성의 `crew/requiredCrew/upkeep`은 개별 현황입니다. 자원은 음수가 되지 않습니다. 유지 자원이 고갈되고 순생산도 부족하면 새 출격은 `409 FLEET_SUPPLY_SHORTAGE`로 제한하지만 이미 이동 중인 함대의 귀환은 허용합니다. 식량 고갈 시에도 내 행성으로의 `deploy` 기지 이동은 허용합니다(금속·중수소 보급 제한은 유지). 이동 중 유지비는 계속 발생하고 도착 후 목적지로 이전됩니다.

기본 승무원: 소형 화물선·경전투기 1명, 대형 화물선·중전투기·수확선 2명, 순양함 4명, 폭격기 6명, 전함·순양전함 8명, 구축함 10명, 죽음의 별 50명. 식민선·정찰선·태양광 위성은 무인으로 유지합니다. 식민선의 이주민은 별도입니다. 기본 함종 유지비는 필요 승무원당 시간당 금속 0.1·중수소 0.05입니다.

기존 편성은 첫 상태 정산에서 실제 행성 인구만큼 한 번 배치하며 이전 시간에 유지비를 소급 부과하지 않습니다. 인구가 부족한 기존 함대는 편성 저장으로 충원한 후 출격할 수 있습니다. 미배정 함선은 승무원 배치와 함대 유지비 대상이 아닙니다.

정찰 기록은 `ownerRead`, 전투 기록은 참여자별 `attackerRead`/`defenderRead`로 읽음 상태를 구분합니다. 상세 화면을 열면 정찰은 `PATCH /api/game/scout-reports/{id}/read`, 전투는 `PATCH /api/game/reports/{id}/read`로 읽음 처리하며, 목록 조회만으로는 변경하지 않습니다. 상세 화면의 이전·다음 기록 이동은 현재 목록 순서로 페이지 경계를 넘어갑니다.

개선 요청 목록 `GET /api/game/improvement-requests`는 `status=all|pending|reviewed|implemented|partial|rejected`로 전체·검토 대기·확인 완료·반영·부분 반영·거부를 필터링합니다. `before` 커서는 동일한 필터와 함께 사용합니다.

태양광 인공위성은 행성 `fleet.solarSatellite` 보유 수량 × `max(0, floor((maxTemp + 160) / 6))`만큼 발전합니다. 전력에는 서버 속도 배율을 적용하지 않습니다. `energyState.sources`에 발전원별 실제 기여량과 위성 `count`, `perUnit`이 포함됩니다.

식량 재고가 0이고 식량 수지가 음수이면, `populationSettings.growthHours / serverSpeed`시간마다 주민 인구가 1 감소합니다. 비축 식량이 남아 있는 동안은 감소하지 않고, 공급 회복 시 감소 진행률을 초기화합니다. 건강에 따른 성장 가속은 감소 간격에 적용하지 않습니다. 감소는 0명까지이며 함대 승무원은 이 주민 감소 계산에 포함하지 않습니다. 오프라인 정산과 주기적 조회는 동일한 결과를 냅니다.

AI는 모든 보유 행성의 건설·연구·함대 작업 후보를 함께 비교하고 출발/작업 행성을 직접 지정합니다. UI의 선택 행성을 전환할 필요가 없습니다. 각 lease는 한 행동을 수행하고, 성공하면 곧바로 다음 판단 대상으로 등록해 유용한 작업이 없어질 때까지 계속합니다. 여러 계정은 공통 큐에서 순차적으로 차례를 받습니다. 대기 또는 오류이면 `max(120, intervalSeconds)`초 후 다시 확인합니다(신규 기본 180초). 매 행동 전 최신 상태와 행성 ID·비용·레벨·함대 revision을 다시 확인하며, 네트워크 오류가 난 명령은 재전송하지 않습니다. 판단 API의 후보 한도는 512개입니다.

선택한 작업이 모델 판단 중 완료되거나 최신 상태에서 실행 불가능해지면 `result.recheck=true`로 완료하여, 휴식 없이 다른 작업을 재판단합니다. 단순 자원 증감은 명령 무효화 조건이 아니며, 최신 자원으로 비용을 충족하면 실행합니다. AI 프로필의 `history`는 완료된 최근 50건을 최신순으로 반환합니다(실행·재판단·휴식·오류와 판단 이유, 시간). 사용자 설정은 표시 중 15초마다 상태·기록만 갱신하며 입력 폼을 유지합니다.

사용자 AI 대리도 `PATCH /api/account/delegation`의 `proposeImprovements`(기본 true)로 개선 제안을 활성화/중지할 수 있습니다. AI 작업 토큰으로 등록한 요청은 일반 사용자 계정에서도 `authorType=ai`로 저장하며, 일반 봇과 동일하게 6시간 등록 간격과 최근 30일 중복 검사를 적용합니다. 수동으로 등록한 사용자의 제안은 기존 사용자 제안으로 처리합니다. 제안 등록 실패는 게임 행동을 취소하지 않으며 실행 기록에 별도로 표시합니다.


### 포기 행성의 해적 거점

행성 포기 응답의 `abandonedPlanet`에는 `pirateLevel`과 `piratePlanetId`가 추가됩니다. 건물 레벨 제곱의 합을 개발 점수로 삼고 `min(10,max(1,ceil(sqrt(score)/10)))`으로 고정 레벨을 결정합니다. 사용자 전체 연구·함선·비축 자원은 레벨 계산에 영향을 주지 않습니다. 동일 레벨은 동일한 표준 시설, 연구 0, 초기 주둔 함선·방어시설을 가집니다. 레벨은 자동 상승하지 않습니다.

레벨 L의 초기 병력은 경전투기 4L, 중전투기 2L, 순양함 max(0,L−2), 전함 max(0,L−5), 로켓포 4L, 경레이저 2L, 중레이저 max(0,L−3)입니다. 최대 병력은 각 초기 수량의 2배입니다. 시작 자원은 0이고, 금속/수정/중수소를 각각 300/200/100 × L² / 게임시간당 생산합니다. 저장 한도는 자원별 10000 × L²입니다. 게임시간 300초마다 부족한 병력 1기의 건조를 시도하며 실제 카탈로그 자원을 차감합니다. 자원이 부족하면 생산을 기다립니다. 서버 배율을 적용하며 오프라인 시간도 정찰·전투 등 상태 조회 시 정산합니다. 별도 AI 모델 호출은 없습니다.

정찰한 현재 해적 행성은 성계도 `planet.isPirate=true`, `planet.pirateLevel`로 구분합니다. 정찰 기록에도 관측 당시 `pirateLevel`을 반환합니다. 미정찰 행성에는 레벨과 해적 이름을 공개하지 않습니다. `transport` 출격은 409 `PIRATE_TRANSPORT_FORBIDDEN`, 개척은 기존 409 `TARGET_CHANGED`로 차단합니다. 약탈은 기존 규칙과 적재 한도로 실제 잔여 자원만 가져오며 추가 보상 자원은 지급하지 않습니다.

공격으로 모든 주둔 함선과 방어시설을 제거하고 승리하면 NPC를 제거해 좌표를 개척 가능하게 돌립니다. 전투 결과의 `pirateLevel`, `pirateCleared`로 이를 확인합니다. 해적 NPC는 로그인할 수 없으며 관리자 유저 목록과 사용자 수 집계에서 제외됩니다.

### 함대 임무와 행성 소유 관계

| 목표 | 새 출격에서 지원하는 임무 | 도착 후 처리 |
|---|---|---|
| 다른 내 행성 | `deploy` (이동) | 함선·승무원·적재 자원을 배치하고 편성의 기지를 변경합니다. 자동 귀환하지 않으며 이후 유지비는 목적지에서 부담합니다. |
| 다른 내 행성 | `transport` (수송) | 자원만 전달한 뒤 함선·승무원은 출발지로 귀환합니다. |
| 다른 사용자·해적 행성 | `attack` (공격) | 전투·약탈 후 생존 함대가 귀환합니다. |
| 빈 행성 | 성계도의 식민선 보내기 | 함대 편성 없이 식민선 1척으로 개척합니다. 빈 궤도의 잔해 수거는 수확선 함대로 가능합니다. |

이동은 기존 `/api/game/fleets`의 편성·버전·요청 ID·목표 행성 ID 계약을 그대로 사용합니다. 이동 중 취소는 recall API를 사용하며, 출발 행성으로 함선과 적재 자원을 복구합니다. 도착 시 목표 행성 ID 또는 소유 상태가 달라지면 배치하지 않고 귀환합니다. 출발지 자체는 목표로 지정할 수 없습니다. 다른 사용자의 행성으로 새 수송·이동 요청을 보내면 각각 409 `TRANSPORT_TARGET_NOT_OWNED`, `DEPLOY_TARGET_NOT_OWNED`를 반환합니다. 해적 수송의 기존 `PIRATE_TRANSPORT_FORBIDDEN` 코드는 유지합니다. 이미 출발한 수송은 기존 전달·귀환 처리로 완료합니다.

함대 출격은 선택한 UI 행성과 무관하게 `originPlanetId`로 지정한 내 기지에서 실행합니다. 편성의 기지 ID가 출발 행성과 일치해야 하며, 해당 기지의 인구·함선·자원·보급을 검증합니다. `foodStorage` 식량 창고는 단계마다 식량 저장량 10,000을 추가합니다. 저장고는 생산량을 늘리지 않으며 식량 순생산 적자는 수경농장으로 해소해야 합니다.

함대 승무원은 `10 + floor(총 함선 수 / 100)`명입니다. 빈 편성 또는 무인 함선만 있는 편성은 0명입니다. `stats.crew`는 유인/무인 구분에만 사용하고 척당 인구를 합산하지 않습니다. 기존 편성은 승무원 버전 2로 한 번 전환하며 초과 배치 인원을 보급 기지 인구로 반환합니다. 부족 시 실제 주민만 충원하고, 나머지는 편성 저장으로 충원해야 출격할 수 있습니다. 전투 손실은 유인 함선 생존 비율에 따라 승무원에 적용하며 식량 비용은 실제 배치 승무원 수를 따릅니다. 금속·중수소 비용은 함선 수 기준을 유지합니다.
