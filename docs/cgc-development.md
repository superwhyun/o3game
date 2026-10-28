# CGC 과금·괴수 이벤트 개발 가이드

게임 내 결제는 Metanomic(공통 코인 CGC)을 쓴다. 현금 결제는 없다. CGC는 시간 가속과 함대 문장 구매에만 쓰고, 괴수 처치 보상으로 받을 수 있다.

## 구성

| 영역 | 위치 |
|---|---|
| Metanomic API 클라이언트 | `server/services/MetanomicClient.js` |
| 지갑 연결(SIWE) | `server/services/WalletService.js`, `routes/wallet.js`, `ogame-3d/src/services/WalletProvider.js` |
| 상점·주문 | `server/services/ShopService.js`, `routes/shop.js`, `server/data/shop/` |
| 보상 지급(outbox) | `server/services/CgcRewardService.js`, `CgcPoller.js` |
| 괴수 이벤트 | `server/services/MonsterService.js`, `utils/monsterRules.js`, `routes/adminMonsters.js` |
| 전투 잔해 | `server/services/DebrisService.js` |
| 화면 | `MarketView.js`, `MonsterBoard.js`, `AdminEvents.js`, `src/three/monsters/MonsterModel.js` |

## 운영 설정

- 환경 변수로 Metanomic 연동을 켠다. 값이 없으면 CGC 기능은 꺼진 상태로 동작한다. 변수 이름은 `MetanomicClient.js` 상단을 따른다.
- 상품 가격은 관리 본부 → Events & Shop에서 정한다. 가격이 비어 있는 상품은 판매하지 않는다.
- 괴수 이벤트의 CGC 풀은 괴수/이벤트마다 정한다. 게임 예산이 부족하면 지급은 `BLOCKED`로 대기하고 예산이 채워지면 이어서 지급한다.
- 체인 반영 깊이(정산 속도)는 Metanomic 쪽 운영자 설정이다.

## 테스트

```bash
cd server && npm test
```

서버 테스트는 인메모리 MongoDB 레플리카셋과 가짜 Metanomic을 쓴다. 실제 결제 서비스나 DB에 접속하지 않는다.

브라우저 시나리오(지갑 연결, 구매, 문장, 가속, 괴수 전투와 지급, 잔해 수거):

```bash
cd server && node scripts/e2eStack.js
```

```bash
cd ogame-3d && VITE_SERVER_URL=http://localhost:3999 npx vite --host 127.0.0.1 --port 5179
```

```bash
cd ogame-3d && PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test -c playwright.cgc.config.js
```

- 페이지는 `localhost:5179`로 열어야 서버 CORS와 맞는다(`127.0.0.1`로 열면 요청이 실패한다).
- 시나리오는 이전 실행의 상태를 남기므로 다시 돌릴 때는 e2e 스택을 새로 띄운다.
- 소프트웨어 WebGL 환경에서는 3D 썸네일이 느리게 나타난다. 공용 썸네일 큐에서 건물·연구 썸네일 뒤에 줄을 서기 때문이다.

## 알려진 한계

- 가짜 Metanomic으로만 검증했다. 실제 Ronin 지갑과 Saigon 네트워크 연동은 운영 환경에서 확인해야 한다.
- 괴수 유닛의 속사는 대상과 무관하게 모든 사격에 적용된다(기존 엔진 동작). 상한 6으로 제한한다.
