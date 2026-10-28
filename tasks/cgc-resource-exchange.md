# 자원 → CGC 교환

## 목표와 범위

이용자가 보유 자원(금속·수정·중수소)을 어드민이 정한 고정 교환비로 CGC로 바꿔 지갑으로 받는다. 지갑 연결, `MetanomicClient`, 보상 outbox는 `cgc-wallet-and-orders.md`의 01~03 단위를 사용한다.

완료 조건: 연결된 지갑의 이용자가 교환을 요청하면 자원이 한 번만 차감되고 CGC가 한 번만 지급된다. 지급이 확정 실패하면 자원이 한 번만 환원된다. 서버 중단·응답 유실에서도 둘 중 하나로 수렴한다.

## 확정된 결정

- 교환 비율은 자원별 고정값이며 어드민이 설정한다.
- "일정량 이상" 같은 보유량 하한, 이용자·전체 한도, 최소 교환량 같은 안전장치는 두지 않는다.
- 교환은 서명이 필요 없다. 지갑 연결만 필요하므로 모바일에서도 사용할 수 있다.

## 알려진 위험(수용됨)

한도가 없으므로 이용자 한 명이 보유 자원 전량을 교환해 게임 예산을 소진할 수 있다. 예산이 부족하면 교환은 `BUDGET_EXCEEDED`로 실패하고 자원은 환원된다. 같은 예산을 괴수 이벤트 보상과 공유하므로 예산 소진은 이벤트 정산도 막을 수 있다(`space-monster-events.md` 참고). 운영 중에는 어드민 화면의 예산 잔량과 최근 교환량을 보고 환율을 조정한다. 약탈 경제와의 상호작용(자원을 CGC로 빼서 약탈 대상이 줄어듦)도 감수한다.

## 설계와 주요 결정

### 설정

`GameConfig.cgcExchange`:

```js
{
  enabled: false,
  // 교환 단위(배치)당 지급할 마이크로 CGC. 배치 크기는 자원별로 어드민이 정한다.
  rates: {
    metal:     { batchSize: 1000, microPerBatch: '10000' },
    crystal:   { batchSize: 1000, microPerBatch: '25000' },
    deuterium: { batchSize: 1000, microPerBatch: '60000' }
  },
  updatedAt, updatedBy
}
```

- 값은 정수 문자열이며 `microPerBatch ≥ 1`, `batchSize ≥ 1`이다. 변경은 이후 교환부터 적용하고 교환 기록에 사용한 환율을 스냅샷으로 남긴다.
- 변경은 `superadmin`만 가능하며 감사 로그에 남긴다. 기존 `features.resourceExchange` 플래그(현재 미사용)와 이름이 겹치지 않도록 새 키 `cgcExchange.enabled`를 쓴다.

### 교환 흐름

새 컬렉션 `CgcExchange`: `exchangeId`(고유), `userId`, `planetId`, `resource`, `batches`, `resourceAmount`, `rate` 스냅샷, `amountMicro`, `wallet` 스냅샷, `requestId`(`{userId, requestId}` 고유), `status`(`PENDING` → `COMPLETED` / `REFUNDED`), `rewardRef = exchange:{exchangeId}`, 타임스탬프.

1. `POST /api/game/exchange { planetId, resource, batches, requestId }`
2. Mongo 트랜잭션 하나에서 다음을 수행한다.
   - 지갑 연결, `enabled`, 환율, 행성 소유, 보유 자원 ≥ `batches × batchSize`를 검증한다.
   - 행성 자원을 차감하고(낙관적 동시성으로 이중 사용 방지) `CgcExchange`(`PENDING`)와 `CgcReward`(`PENDING`, `rewardRef = exchange:{exchangeId}`)를 함께 기록한다.
   - 같은 `requestId`는 기존 결과를 반환한다.
3. 보상 outbox가 Metanomic 지급을 처리한다(`cgc-wallet-and-orders.md` 참고). `COMPLETED`가 되면 교환도 `COMPLETED`.
4. 보상이 확정 실패하면 콜백이 트랜잭션 하나로 자원을 환원하고 `REFUNDED`로 바꾼다. 환원은 `exchangeId` 기준으로 한 번만 일어난다(상태 전이를 조건부 업데이트로 보장).
5. 요청 직전에 `GET /games/{id}/budget`으로 `available`을 확인해 명백히 부족하면 `409 BUDGET_INSUFFICIENT`로 즉시 거절한다(자원 차감 전). 이 사전 확인은 최적화이며, 경쟁에서 지면 4번 경로가 처리한다.

차감 후 `PENDING` 구간의 자원은 이미 행성에서 빠져 있으므로 약탈 대상에서 제외된다.

### 계산

`amountMicro = BigInt(batches) × BigInt(microPerBatch)`. 한 번에 교환할 배치 수의 상한은 서버 안전 한계(예: 10^9 배치까지)로 정수 오버플로만 막는다. 이 값은 경제 한도가 아니다.

### 화면

- 자원 화면에 교환 패널을 둔다: 자원 선택, 배치 수, 환율 표시, 받을 CGC, 지갑 상태(연결되지 않으면 안내).
- 교환 내역(상태 포함)을 표시한다. CGC 잔액은 게임 API 키로 조회할 수 없으므로 Metanomic 포털 링크를 안내한다.
- 어드민 탭에 환율·활성 스위치, 예산 잔량(`budget`), 최근 교환 요약을 표시한다.

### 정합성 점검

어드민용 점검 스크립트 `server/scripts/checkCgcExchange.js`: 상태별 건수, `PENDING`이 오래 남은 건, `REFUNDED`와 환원된 자원의 일치, `CgcReward`와 `CgcExchange`의 상태 불일치를 보고만 한다.

## Phase 1: 교환

### 01. exchange-model-service

- 상태: pending
- 선행 단위: `cgc-wallet-and-orders.md`의 03 reward-outbox
- 범위/결과물: `GameConfig.cgcExchange`, `CgcExchange`, 교환 서비스(트랜잭션), 환원 콜백, 사전 예산 확인.
- 완료 조건: 자원 차감·교환 기록·보상 기록이 원자적; 같은 `requestId` 재요청은 같은 결과; 확정 실패 시 정확히 한 번 환원; 동시 교환에서 음수 자원 없음.
- 검증: 서버 통합(동시 요청, 중복 `requestId`, 보상 실패 주입 후 환원, 서버 재시작 중 `PENDING` 복구). 가짜 Metanomic 서버 사용.

### 02. admin-config-ui

- 상태: pending
- 선행 단위: 01
- 범위/결과물: 어드민 환율·스위치 편집 API와 UI, 감사 로그, 예산·최근 교환 요약.
- 완료 조건: 변경은 이후 교환부터 적용; 잘못된 값 거절; 권한(`superadmin`) 확인.
- 검증: 어드민 API 테스트, 브라우저 화면.

### 03. exchange-ui

- 상태: pending
- 선행 단위: 01
- 범위/결과물: 교환 패널, 내역, 오류·진행 상태, 모바일 레이아웃.
- 완료 조건: 지갑 미연결·비활성·예산 부족 상태가 구분되어 표시; 진행 중 상태가 새로고침 후에도 유지.
- 검증: 브라우저 테스트(데스크톱, 390px).

### 04. integration

- 상태: pending
- 선행 단위: 02, 03
- 범위/결과물: 로컬 Metanomic 대상 end-to-end, 회귀.
- 완료 조건: 교환 → 지갑 잔액 증가 확인; 예산 소진 시 환원; 기존 건설·함대 테스트 통과.
- 검증: 전체 서버·브라우저 테스트와 로컬 Metanomic 통합. 격리 환경과 실제 Saigon 확인 범위를 구분해 기록한다.
