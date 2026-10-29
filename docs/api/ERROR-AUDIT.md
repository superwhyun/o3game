# API 오류 처리 계약과 검증

기준: 2026-10-09, 명세 버전 `2026-10-09.5`. 이전 점검에서 발견한 오류 처리 결함을 수정했습니다. HTTP 67개 작업은 공통 오류 형식을 사용하고, 등록된 Socket.IO 이벤트에는 오류 패킷과 ack를 제공합니다.

## 오류 응답 계약

```json
{"error":"표시용 메시지","code":"INVALID_REQUEST","requestId":"서버 생성 UUID","details":{"field":"amount"}}
```

`error`/`code`/`requestId`는 필수이며 `details`는 선택 사항입니다. 모든 응답의 X-Request-Id는 서버가 생성합니다. 요청자가 보낸 추적 ID를 신뢰하지 않습니다. HEAD 응답은 HTTP 규칙에 따라 본문이 없으며 헤더로 추적합니다. 입력·업무 오류에만 공개 가능한 세부 정보를 제공합니다. 5xx의 예외 원문이나 숫자 DB 코드를 반환하지 않습니다. 서버 오류 로그는 requestId·공개 코드·오류 종류로 연결합니다.

## 이전 결함에 대한 적용 결과

| 항목 | 현재 구현 |
| --- | --- |
| 코드 없는 인증·조회·관리·개선요청 오류 | 공통 response/error middleware가 문자열 code와 requestId 보장 |
| 잘못된 JSON / 큰 본문 / 지원하지 않는 본문 타입 | 각각 400 INVALID_JSON / 413 PAYLOAD_TOO_LARGE / 415 UNSUPPORTED_MEDIA_TYPE |
| 내부 예외 원문 노출 | 500 INTERNAL_ERROR 또는 안전한 503 메시지로 변환 |
| 상태 조회 장애를 401로 오분류 | 토큰 검증과 상태 조회 분리. 실제 서버 장애는 500/503 |
| DB 장애를 입력 오류 400으로 오분류 | 라우트가 공통 오류 처리기에 예외 전달. 네트워크/선택 오류는 503 |
| 잘못된 대상 ID가 500 | 공통 ObjectId 검증으로 400 INVALID_ID |
| HTML 404 / 텍스트 인증 429 | JSON ROUTE_NOT_FOUND / RATE_LIMITED. 지원하지 않는 메서드는 405와 Allow |
| 정지 계정 접근 | 로그인·HTTP·Socket 인증 차단. 현재 소켓도 이벤트마다 토큰/계정 재검사, 관리자 정지 시 연결 해제 |
| 로그인 객체/NoSQL 입력 | username/email/password 문자열·길이·형식 검사. $ 키/프로토타입 키와 과도한 중첩 차단 |
| 관리자 수량 문자열/음수 | amount는 양의 안전 정수. 합산 범위 검사, 잘못된 요청은 DB 변경 없음 |
| 관리 설정의 문자열 숫자 | GameConfig 모델 필드에 맞춘 엄격 타입 검사. 카탈로그 비용/선행조건/성능의 숫자도 검사 |
| 관리자 검색 문자열을 정규식으로 실행 | 사용자 입력을 리터럴 검색 문자열로 escape |
| 최초 관리자 생성 경쟁 | 트랜잭션 내 고유 bootstrap 잠금. 중복 생성 차단 |
| 마지막 최고 관리자 제거 경쟁 | 사용자 설정 트랜잭션에 governance 잠금. 마지막 유효 최고 관리자 정지/권한 제거 차단 |
| 최고 관리자 삭제 | 직접 삭제는 차단. 다른 최고 관리자를 남기고 먼저 권한을 변경해야 함 |
| 관리자 수정 응답의 비밀번호 해시 | 응답에서 password 제거 |
| Socket 입력·제한·예외 누락 | 등록 이벤트 좌표/토큰 검증, 사용자/IP 제한, 안전한 apiError 및 ack |
| HTTP와 다른 Socket 성계 조회 | 같은 본인 정찰 공개 규칙과 positions 응답 사용 |
| 점검 모드가 방송만 수행 | 점검 중 게임/대기열 변경 명령은 503 MAINTENANCE_MODE |
| 준비 상태 확인 없음 | /ready: DB ping 및 트랜잭션 준비 검사. /health는 실행 여부 유지 |

## 공통 코드

| 상태 | 코드 | 의미 |
| --- | --- | --- |
| 400 | INVALID_REQUEST, INVALID_ID, INVALID_JSON, VALIDATION_FAILED | 입력 형식·범위/대상 ID/파싱/모델 검증 실패 |
| 401 | AUTH_REQUIRED, AUTH_INVALID_TOKEN, AUTH_TOKEN_EXPIRED, AUTH_INVALID_CREDENTIALS | 인증 필요/토큰 오류/만료/로그인 실패 |
| 403 | FORBIDDEN, ACCOUNT_BANNED | 권한 부족/계정 정지 |
| 404 | NOT_FOUND, ROUTE_NOT_FOUND | 대상/경로 없음 |
| 405 | METHOD_NOT_ALLOWED | 지원하지 않는 메서드. Allow 제공 |
| 409 | STATE_CONFLICT, RESOURCE_CONFLICT, ACCOUNT_EXISTS, ADMIN_ALREADY_EXISTS, LAST_SUPERADMIN | 버전·동시 변경·고유값·계정·관리자 보호 충돌 |
| 413 | PAYLOAD_TOO_LARGE | 본문 크기 초과 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 본문 미디어 타입/인코딩 미지원 |
| 429 | RATE_LIMITED | 호출 제한. HTTP는 Retry-After 제공 |
| 500 | INTERNAL_ERROR | 예상하지 못한 내부 실패 |
| 503 | SERVICE_UNAVAILABLE, TRANSACTIONS_REQUIRED, MAINTENANCE_MODE | 서비스/DB 장애·트랜잭션 미지원·점검 |

## 게임 업무 코드

| 상태 | 코드 | 의미 |
| --- | --- | --- |
| 400 | INVALID_USER, INVALID_PLANET, INVALID_ENTITY, INVALID_ACTION, INVALID_COUNT | 대기열의 사용자/행성/엔티티/동작/수량 오류 |
| 400 | REQUIREMENTS_NOT_MET, LAB_BUSY, BUILDING_BUSY | 선행조건·연구소 또는 건물 작업 충돌 |
| 400 | INSUFFICIENT_AREA, TERRAFORMING_MAX_LEVEL | 면적 부족 또는 최대 가용률/연구 단계 |
| 400 | INVALID_COST, INSUFFICIENT_RESOURCES | 비용 설정 문제/자원 부족 |
| 400 | QUEUE_NOT_ACTIVE, DEPENDENT_QUEUE | 완료된 작업 취소 또는 뒤 예약부터 취소 필요 |
| 400 | INVALID_NAME, INVALID_COMPOSITION, INVALID_MISSION, INVALID_CARGO | 이름·편성·임무·적재 입력 오류 |
| 400 | INVALID_COLONISTS, INSUFFICIENT_POPULATION | 개척 탑승 인구 입력/보유 인구 부족 |
| 409 | INSUFFICIENT_SHIPS, TARGET_CHANGED, RECALL_TOO_LATE | 편성 가능 함선 부족·대상 변경·복귀 취소 시점 경과 |
| 400 | INVALID_SCOUT_ORDER | 정찰 명령 오류. 성능 설정 장애는 공통 SERVICE_UNAVAILABLE(503)로 정규화 |
| 409 | REQUEST_CONFLICT, ORIGIN_CHANGED, INSUFFICIENT_PROBES, TARGET_CONFLICT | 정찰 요청 중복 내용 불일치·출발지 변경·미배정 정찰선 부족·점령 정보 충돌 |

요청별 반환 코드 집합은 OpenAPI의 x-error-codes를 참고하세요. 내부 REQUEST_FAILED/LAUNCH_FAILED/SCOUT_FAILED 및 숫자 DB 코드에 의존하는 공개 계약은 사용하지 않습니다.

## 변경 명령의 재시도

출격·정찰의 requestId와 편성 expectedRevision은 기존 계약을 유지합니다. 출격 후 상태 조회만 실패하면 201과 snapshotPending=true를 반환합니다. 새 ID로 중복 출격하면 안 됩니다. 이미 취소한 함대에 같은 복귀 요청을 반복할 수 있습니다.

일반 명령에는 범용 Idempotency-Key를 아직 제공하지 않습니다. 응답이 유실되면 먼저 최신 상태·대기열을 확인하세요. 429/5xx는 제한적으로 백오프하되 변경 명령을 무조건 재전송하지 마세요. 토큰 refresh/revoke 및 /api/v1 경로 정책은 오류 처리 구현과 별도 기능이며 현재 지원하지 않습니다.

## 검증 및 운영 범위

- 공통 오류 단위 테스트: 내부 메시지/DB 코드 비공개, 상태 매핑과 공개 업무 상세 유지.
- 별도 DB의 실제 서버 테스트: 토큰 누락·오류·만료, 권한/정지, 잘못된 JSON·ID·타입·수량·NoSQL 형태, 없는 대상/경로, 413/415, 로그인 실패, 점검 차단, 준비 상태, 서버 장애 주입 시 안전한 코드.
- 실제 Socket.IO 연결: 만료 토큰 실패 후 재인증, 잘못된 좌표, 호출 제한, 정지 계정 및 ack 오류 계약.
- 회귀 검증: 기존 건설·연구·정찰·함대·전투 기록·자원 교환·개선요청·다중 사용자 동작과 화면 빌드.
- OpenAPI 구조 검증 및 실제 등록 라우트/메서드 registry 비교.

호출 제한은 현재 단일 서버 프로세스의 메모리에 저장합니다. 여러 서버 인스턴스로 확장할 때는 공유 저장소로 바꿔야 합니다. 이번 검증은 API 오류 계약과 기존 기능 회귀 확인이며, 인터넷 공격을 전부 재현한 침투 테스트나 운영 부하 시험은 아닙니다. 외부 네트워크에 실제로 공개하는 작업은 이번 변경에 포함하지 않았습니다.

## AI API 추가 검증

모델 등록·관리, AI 플레이어 관리, API 전용 worker 제어가 추가되어 총 67개 HTTP 작업입니다. AI 오류와 운영 계약은 [AI-PLAYERS.md](AI-PLAYERS.md)에 기록했습니다. 제공자 인증 실패·429·503·JSON null/잘못된 응답·1MB 제한·타임아웃을 모의 HTTP 모델로 검증했습니다. 외부 모델 선택 → 게임 API 건설 등록, 동일 임대 중복 방지, 일반 사용자 권한 차단, 중지 후 토큰/완료 차단, 계정 삭제 후 AI 설정 정리를 통합 검사합니다. 실제 OpenRouter/Vercel 계정 인증은 관리자가 키를 등록한 뒤 연결 테스트로 확인합니다.
