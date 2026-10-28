# CGC 공통 기반: 지갑 연결·Metanomic 클라이언트·주문·보상 outbox

## 목표와 범위

Metanomic(공통 코인 CGC 정산 서비스)과 연동하는 이 게임의 공통 기반을 만든다. 이 문서는 지갑 연결, 서버 API 클라이언트, CGC 보상 지급 outbox, CGC 결제 주문(함대 문장·시간 가속)을 다룬다. 자원 교환은 `cgc-resource-exchange.md`, 우주괴수 이벤트는 `space-monster-events.md`가 이 기반 위에서 구현된다.

완료 조건: 이용자가 PC에서 Ronin 지갑을 계정에 한 번 연결하고, CGC로 상품을 구매해 정확히 한 번 지급받는다. 서버가 중간에 중단돼도 재시작 후 중복 지급이나 미지급 없이 완료된다. 모바일은 지갑 UI 없이 기존 아이디/비밀번호로 플레이하고, 이미 연결된 계정의 보상 수령은 동작한다.

## 확정된 결정

| 항목 | 결정 |
|:--|:--|
| 현금 결제 | 없음. CGC는 다른 게임에서 벌고 이 게임에서도 번다 |
| 계정 모델 | 기존 아이디/비밀번호 계정에 지갑을 연결한다. 지갑 1개 ↔ 계정 1개. 이용자 해제 불가. 멀티 계정은 범위 밖 |
| 지갑 | Ronin Wallet(확장 프로그램)만 지원. 모바일은 게임 플레이 전용, WalletConnect는 범위 밖 |
| 정산 속도 | Metanomic 운영자 화면의 게임별 확인 블록 수. 1이면 블록 포함 즉시 반영. 값은 운영자가 정한다 |
| 재구성 | 감수한다. 감지·복구 로직을 만들지 않고 경보 로그만 남긴다 |
| 1차 상품 | 함대 문장, 시간(가속) |
| 교환 안전장치 | 없음(`cgc-resource-exchange.md` 참고) |

## 미정 항목

- **가속의 허용 대상과 한도.** "천천히 이동"이라는 답을 가속 한도에 대한 것으로 확정하지 못했다. 이 설계는 한도를 `GameConfig`에서 어드민이 조정하게 만들고, 기본값은 건설·연구만 허용하며 일 한도는 없음이다. 값을 정하면 코드 변경 없이 반영된다.

## 외부 전제(코드 밖 작업)

아래는 이 저장소에서 구현할 수 없고 운영자가 Metanomic에서 수행한다.

1. 운영자 신청과 승인, 게임 등록과 승인(게임 ID 발급).
2. 게임 API 키 발급(범위: `rewards`, `payments`, `events`, `budget`).
3. 게임 예산 확보(관리자 배분 또는 운영자 예치). 신규 게임 예산은 0이다.
4. 게임 정산 속도 설정(`PUT /v1/games/{gameId}/settlement`, 포털 화면 포함).

서버 환경 변수:

```dotenv
METANOMIC_ENABLED=1
METANOMIC_API_URL=http://localhost:3300/v1
METANOMIC_GAME_ID=game-xxxxxxxx
METANOMIC_GAME_KEY=<게임 API 키>
METANOMIC_ASSET_ID=common-game-credit
```

`METANOMIC_ENABLED`가 꺼져 있으면 지갑·상점·교환·괴수 보상 API는 `503 CGC_DISABLED`를 반환하고 나머지 게임은 영향받지 않는다. API 키는 서버 환경 변수에만 두며 클라이언트 번들·응답·로그에 넣지 않는다.

## 설계와 주요 결정

### 금액 표현

CGC는 소수점 6자리다. 서버 내부는 정수 마이크로 단위(`BigInt` 또는 문자열)로 계산하고 Metanomic 호출 직전에만 `"4.000000"` 형식 문자열로 바꾼다. 부동소수점을 쓰지 않는다. 카탈로그와 어드민 설정의 가격·환율도 정수 마이크로 단위로 저장한다.

### 지갑 연결 (SIWE)

- `User.wallet = { address, linkedAt }`. `address`는 체크섬을 제거한 소문자 `0x` 형식이다. `coordinateKey`와 같은 방식의 부분 유니크 인덱스(`wallet.address`)로 한 지갑이 한 계정에만 연결되게 한다. 입력 주소의 `ronin:` 접두사는 경계에서 `0x`로 변환한다.
- 새 컬렉션 `WalletChallenge`: `nonce`, `userId`, `address`, `message`, `issuedAt`, `expiresAt`(5분, TTL 인덱스), `used`.
- `POST /api/wallet/challenge { address }` → EIP-4361 메시지를 만들어 저장하고 `{ challengeId, message, expiresAt }`을 반환한다. 메시지에는 게임 origin, 체인 ID(Metanomic 활성 배포의 값), 주소, nonce, 발급·만료 시각, 요청 ID를 넣는다. 요청 본문의 다른 계정 정보는 쓰지 않고 인증된 세션의 사용자로만 만든다.
- `POST /api/wallet/link { challengeId, signature }` → 저장된 원문으로 `personal_sign` 서명을 검증하고(EOA만, 계약 지갑 미지원) challenge를 원자적으로 소비(`used: false → true`)한 뒤 지갑을 연결한다. 이미 연결된 계정이면 `409 WALLET_ALREADY_SET`, 다른 계정이 쓰는 주소면 `409 WALLET_IN_USE`(인덱스 충돌에서 판정)를 반환한다.
- 연결 후 변경·해제 API는 제공하지 않는다. 잘못 연결한 경우를 위해 `superadmin` 전용 `DELETE /api/admin/users/:userId/wallet`(감사 로그 포함)만 둔다.
- 요청 제한: challenge 발급은 사용자·IP별 속도 제한을 둔다.
- 검증 라이브러리는 서버에서 `viem`(`verifyMessage`, `getAddress`)을 사용한다. Metanomic과 같은 서명 규격이다.
- 클라이언트: 지갑 제공자 선택(EIP-6963, `window.ronin`, `window.ethereum`)은 Metanomic의 `web/wallet.ts` 구조를 참고해 최소한으로 이식한다. 제공자가 없으면(모바일 포함) 연결 UI 대신 "PC에서 지갑을 연결하세요" 안내만 표시한다. 계정 변경·네트워크 변경 감지 시 서명 전에 다시 확인한다.

### MetanomicClient

`server/services/MetanomicClient.js`. Node 22 `fetch`, `Authorization: Bearer <키>`, 변경 요청은 `Idempotency-Key` 필수, 타임아웃 10초.

- 메서드: `createPayment`, `getPayment`, `relayAuthorization`, `claimDelivery`, `fulfill`, `refund`, `listPayments`, `pollEvents`, `getOperation`, `reward`, `getReward`, `budget`.
- 오류는 `{ status, code }`로 정규화한다. 분기는 `code`로 한다(`BUDGET_EXCEEDED`, `IDEMPOTENCY_CONFLICT`, `INVALID_PAYMENT_STATE` 등).
- 타임아웃·503·통신 실패는 "결과 불명"이다. 새 주문 ID나 새 보상 참조를 만들지 않고 저장된 본문과 키로 재시도한다.
- 모든 호출 본문은 네트워크 호출 전에 DB에 저장한다(재시도에 그대로 사용).

### 보상 outbox (교환·괴수 보상 공용)

새 컬렉션 `CgcReward`: `rewardRef`(고유), `kind`(`exchange`|`monster`), `refId`, `userId`, `wallet`(스냅샷), `amountMicro`, `status`(`PENDING` → `SUBMITTED` → `COMPLETED` / `FAILED`), `rewardId`, `operationId`, `attempts`, `lastError`, 타임스탬프.

- 업무 트랜잭션이 `CgcReward`를 `PENDING`으로 함께 기록한다(교환이면 자원 차감과 같은 트랜잭션).
- 폴러가 `PENDING`을 가져와 `POST /games/{id}/rewards`를 호출한다. `Idempotency-Key`와 `rewardRef`는 같은 값이다. 응답이 유실되면 `GET /rewards?rewardRef=`로 복구한다.
- `SUBMITTED`는 `GET /operations/{id}`가 `FINALIZED`면 `COMPLETED`, `FAILED`면 `FAILED`로 바꾼다.
- 확정 실패(`BUDGET_EXCEEDED` 포함)는 `kind`별 콜백을 호출한다. 교환은 자원을 환원하고, 괴수 보상은 `FAILED`로 남겨 어드민이 재시도한다. 일시 오류는 지수 백오프로 재시도한다.

### 폴러와 단일 실행 보장

한 프로세스에서 약 1초 주기로 한 번에 하나의 순회만 실행한다. 다중 인스턴스에 대비해 `Lease { name, holder, expiresAt }` 문서를 `findOneAndUpdate`로 획득한 인스턴스만 순회한다. 순회 내용은 다음과 같다.

1. 이벤트 커서(`GET /games/{id}/events`)를 처리 후에만 저장한다. 이벤트는 중복 전달을 전제로 하고 과거 상태로 주문을 되돌리지 않는다.
2. `CgcReward` outbox 처리.
3. 주문 상태 진행(아래).
4. 시작 시와 주기적으로 `GET /games/{id}/payments?status=PAID,DELIVERY_CLAIMED&cursor=0`을 끝까지 조회해 누락 복구.

### 상품 카탈로그

`server/data/shop/`에 상품 정의를 두고(엔티티 카탈로그와 같은 SSOT 방식) 부팅 시 검증한다.

```js
{ id: 'emblem.crescent', kind: 'emblem', name: '초승달 문장', priceMicro: '4000000' }
{ id: 'speedup.1h', kind: 'speedup', name: '가속 1시간', priceMicro: '1000000', grants: { speedupSeconds: 3600 } }
```

가격 변경은 배포로 한다. 주문에는 가격을 스냅샷으로 저장한다. 어드민이 활성/비활성을 바꿀 수 있게 `GameConfig.shop.disabled: [skuIds]`를 둔다.

**지급은 즉시 효과가 아니라 권리 지급이다.** 구매는 계정에 권리를 더할 뿐이고, 가속 효과 적용은 별도 게임 내 행동이다. 이렇게 하면 결제 확정 시점의 대상 상태(큐 완료 등) 경쟁과 지급 시작 이후 환불 불가 문제가 사라진다.

- `User.entitlements = { emblems: [skuId], speedupSeconds: Number }`.
- 이미 가진 문장을 다시 사려는 주문은 생성 시 `409 ALREADY_OWNED`로 거절하고, `PAID` 이후 중복이 확인되면 지급 시작 전에 환불한다.

### 주문 흐름

새 컬렉션 `CgcOrder`: `orderId`(고유), `userId`, `payerWallet`, `sku`, `quantity`, `priceMicro`(스냅샷), `paymentRequest`(Metanomic 호출 본문), `paymentId`(부분 유니크), `status`(`CREATED` → `PAID` → `CLAIMED` → `DELIVERED` → `COMPLETED`, 종료: `EXPIRED`·`REFUNDED`·`FAILED`), `deliveryRef`, 타임스탬프.

1. `POST /api/shop/orders { sku, quantity, requestId }`: 지갑 연결, 상품 활성, 수량, 보유 여부를 검증한다. 사용자당 `CREATED` 주문은 최대 3개다. 주문을 `paymentRequest`와 함께 저장한 뒤 `createPayment`를 호출한다(`Idempotency-Key: purchase:{orderId}`). 반환된 `paymentId`를 저장한다.
2. `GET /api/shop/orders/:id`: 본인 주문만 조회한다. `CREATED`면 Metanomic에서 최신 서명 요청(`authorization`, `permit`)을 받아 클라이언트에 전달한다. 응답에 API 키나 불필요한 내부 정보를 넣지 않는다.
3. 클라이언트가 `eth_signTypedData_v4`로 두 서명을 받는다. 반환된 도메인·금액·nonce를 화면에서 재조합하지 않고 그대로 서명한다.
4. `POST /api/shop/orders/:id/authorizations { signature, permitSignature, permitDeadline }`: 주문 소유자이고 지갑이 주문의 `payerWallet`과 같은지 확인한 뒤 `relayAuthorization`을 호출한다. `permitDeadline`은 결제 객체의 `expiresAt` 그대로다. 같은 서명 본문의 재시도는 같은 키를 쓰고, permit 충돌로 확정 실패하면 같은 `paymentId`를 재조회해 새 서명과 새 요청 키로 다시 제출한다.
5. 폴러: `PAID`가 되면 로컬 사전 검증(중복 보유 등)을 하고 통과하면 `claimDelivery`(키 `claim:{paymentId}`), 실패하면 `refund`(키 `refund:{paymentId}`)를 호출한다. `DELIVERY_CLAIMED`가 확정되면 Mongo 트랜잭션 하나로 `entitlements` 변경과 `CgcOrder.status = DELIVERED`를 기록한다(`paymentId`가 유일한 지급 기록, 이미 지급됐으면 추가하지 않는다). 커밋 후 `fulfill`(키 `fulfill:{paymentId}`, `deliveryRef: delivery:{paymentId}`)을 호출하고 `COMPLETED`로 표시한다.
6. UI는 "접수됨 → 처리 중 → 완료"를 구분한다. 화면 대기 시간이 지나도 실패로 바꾸지 않고 서버 작업에서 추적한다.

지급 시작 이후에는 자동 환불이 없다. 지급 전에 가능한 모든 검증을 `PAID` 시점에 끝낸다.

### 함대 문장

- 문장 시각 정의는 클라이언트 `src/data/emblems.js`에 SVG/도형 사양으로 둔다(외부 에셋 없음, 절차적 생성). 무료 기본 문장 몇 개와 상점 문장을 같은 방식으로 정의하고, 서버 카탈로그의 상품 ID와 일치하는지 테스트로 보장한다.
- `formationSchema.emblem: String`을 추가한다. `FleetFormationService`의 저장 계약에 포함해 `ownedEmblems`에 없는 문장은 거절한다.
- 표시 위치: 함대 편성 카드, 전투 하단의 임무 카드, 전투 보고서의 내 함대. 타인에게 공개되는 항로 투영(`/galaxy/traffic`)에는 포함하지 않는다.

### 시간 가속

- `POST /api/game/queue/:id/speedup { seconds, requestId }`: 소유자의 `building`/`research`(허용 대상은 `GameConfig.speedupSettings.allowedTypes`) 큐 항목 중 진행 중인 항목에 대해 `min(seconds, 잔여 시간, 보유 가속 초)`만큼 사용한다.
- 같은 사용자·같은 타입 체인의 뒤쪽 `pending` 항목은 `startTime`이 앞 항목의 `endTime`에 연결돼 있으므로 같은 만큼 앞당긴다. 모든 변경은 한 트랜잭션이다. `requestId`로 중복 요청을 막는다.
- 일 한도는 `GameConfig.speedupSettings.dailyCapSeconds`(`null`이면 무제한)로 어드민이 조정한다. 사용 내역은 `SpeedupUsage`에 기록한다.
- 가속 직후 `settleUserState`로 완료 처리와 알림을 한다.

## Phase 1: 연동 기반

### 01. metanomic-client

- 상태: pending
- 선행 단위: 없음
- 범위/결과물: `MetanomicClient`, 환경 변수 검증, `CGC_DISABLED` 처리, 금액 유틸(마이크로 정수 ↔ 6자리 문자열).
- 완료 조건: 문서의 모든 호출을 감쌈; 오류 정규화; 타임아웃은 결과 불명으로 분류.
- 검증: 문서화된 동작을 구현한 가짜 Metanomic HTTP 서버로 계약 테스트(멱등 키, 오류 코드, 타임아웃 재시도). 로컬 Metanomic(`npm run dev` 기반)에 대한 수동 스크립트 `server/scripts/checkMetanomicLive.js`는 보고만 하고 데이터를 지우지 않는다.

### 02. wallet-link

- 상태: pending
- 선행 단위: 01
- 범위/결과물: `User.wallet`과 인덱스, `WalletChallenge`, 연결 API, 어드민 해제, 클라이언트 지갑 제공자 선택과 서명, 연결 상태 UI(PC), 모바일 안내.
- 완료 조건: 한 지갑은 한 계정에만 연결; challenge는 5분·1회; 만료·재사용·타 계정 주소·`ronin:` 입력 처리; 연결 후 변경 불가.
- 검증: 서버 통합(동시 연결 경쟁 포함)과 모의 지갑을 쓴 브라우저 테스트. 실제 Ronin 확장 프로그램 확인은 수동 절차로 분리해 기록한다. 이전 Metanomic 검증에서도 Ronin 서명 오류 사례(`WALLET_IS_LOCKED`)가 있었으므로 원문 오류를 노출한다.

### 03. reward-outbox

- 상태: pending
- 선행 단위: 01
- 범위/결과물: `CgcReward`, `Lease`, 폴러, 이벤트 커서, 재시작 복구.
- 완료 조건: 같은 `rewardRef`는 한 번만 지급; 응답 유실·서버 재시작·동시 인스턴스에서 중복/누락 없음; 확정 실패 콜백.
- 검증: 가짜 서버로 실패 주입(타임아웃, 5xx, `BUDGET_EXCEEDED`, 응답 유실 후 조회). 두 폴러 동시 실행에서 한 쪽만 처리하는지.

## Phase 2: 상점

### 04. shop-catalog-entitlements

- 상태: pending
- 선행 단위: 02
- 범위/결과물: 상품 카탈로그 검증, `GET /api/shop/catalog`, `User.entitlements`, `GameConfig.shop`·`speedupSettings`, 어드민 편집.
- 완료 조건: 카탈로그 오류는 부팅에서 실패; 가격은 마이크로 정수 문자열.
- 검증: 카탈로그 단위 테스트, 클라이언트 문장 정의와 상품 ID 일치 테스트.

### 05. orders-delivery

- 상태: pending
- 선행 단위: 03, 04
- 범위/결과물: `CgcOrder`, 주문 API, 서명 중계, 주문 상태 진행(폴러), 환불 경로.
- 완료 조건: 서명 없이 또는 금액·게임을 바꿔 결제할 수 없음; 지급 시작 확정 전에 권리 없음; 확정 후 정확히 하나; 지급 직후·완료 통지 전에 서버를 중단해도 권리는 하나이고 주문은 `COMPLETED`; `PAID` 후 중복 보유는 환불.
- 검증: 로컬 Metanomic 통합 시나리오(보상 지급 → 구매 → 지급 → 예산 증가 확인)와 가짜 서버 실패 주입. 중단 시점별(요청 직후, 지급 직후) 재시작 테스트.

### 06. signing-ui

- 상태: pending
- 선행 단위: 02, 05
- 범위/결과물: 상점 화면, 구매 확인 모달(상품·가격·수량·지갑), 두 서명 요청, 진행 상태 표시, 오류·재시도.
- 완료 조건: 서명 전 지갑 계정·네트워크 재확인; 서명 중단·거절 후 같은 주문으로 재개; 모바일에서는 구매 UI를 숨기고 안내.
- 검증: 모의 지갑 브라우저 테스트, 390px/데스크톱 화면 확인.

### 07. fleet-emblems

- 상태: pending
- 선행 단위: 05
- 범위/결과물: 문장 정의·렌더러, 편성 저장 계약, 표시 위치 적용, 보유/선택 UI.
- 완료 조건: 미보유 문장 거절; 기존 편성 저장·출격 흐름 유지.
- 검증: `FleetFormation` 통합 테스트, 브라우저 화면.

### 08. time-speedup

- 상태: pending
- 선행 단위: 05
- 범위/결과물: 가속 API, 큐 시각 재계산, 사용 기록, 큐 UI의 가속 버튼, 어드민 한도 설정.
- 완료 조건: 동시 요청에서 보유량 음수 없음; 뒤쪽 예약 항목 시각 연동; 허용되지 않은 타입 거절.
- 검증: `ConstructionService` 통합 테스트(진행·예약 혼합, 완료 경계, 동시 사용, 중복 `requestId`).

## Phase 3: 통합 검증

### 09. integration

- 상태: pending
- 선행 단위: 06, 07, 08
- 범위/결과물: 전체 회귀, 장애 복구 시나리오, 운영 문서.
- 완료 조건: 기존 건설·함대·정찰·식민화 테스트 통과; 구매→지급→사용 경로 확인; Metanomic 불가 시 게임 플레이에 영향 없음.
- 검증: 전체 서버·브라우저 테스트, 로컬 Metanomic 대상 end-to-end. 격리 환경 결과와 실제 Saigon 확인 범위를 따로 기록한다.
