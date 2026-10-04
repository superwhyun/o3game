# Cosmic Empire Architecture

이 문서는 Cosmic Empire(OGame 3D) 프로젝트의 시스템 아키텍처와 구현 상세를 설명합니다. 이 시스템은 실시간 전략 시뮬레이션 게임으로, 프론트엔드의 3D 렌더링과 백엔드의 정교한 경제/큐 관리 시스템으로 구성되어 있습니다.

## 1. 개요 (High-Level Overview)

시스템은 현대적인 **Client-Server 모델**을 따르며, 다음과 같은 주요 기술 스택을 사용합니다:
- **Frontend**: Vite + Vanilla JavaScript + Three.js + Socket.io-client
- **Backend**: Node.js + Express + Socket.io + MongoDB (Mongoose)
- **Communication**: REST API (인증, 관리) + Socket.io (실시간 동기화)

---

## 2. 프로젝트 디렉토리 구조

```text
OOgame/
├── ogame-3d/               # 프론트엔드 (Vite 기반 웹 앱)
│   ├── src/
│   │   ├── core/           # 핵심 게임 로직 (현 상태 관리, 3D 씬)
│   │   ├── services/       # 서버 통신 서비스 (API, Socket, Admin)
│   │   ├── ui/             # UI 매니저 및 컴포넌트 관리
│   │   ├── data/           # 게임 내 정적 데이터 (건물/연구 정보 등)
│   │   └── utils/          # 유틸리티 클래스 (Event Emitter 등)
│   └── index.html          # 메인 HTML 및 최상위 레이아웃
│
├── server/                 # 백엔드 (Node.js API 및 소켓 서버)
│   ├── models/             # MongoDB 스키마 (User, Queue, Fleet 등)
│   ├── routes/             # REST API 엔드포인트
│   ├── services/           # 비즈니스 로직 (게임 상태 계산, 전투 시스템)
│   ├── socket/             # 실시간 이벤트 핸들러
│   ├── utils/              # 공통 계산 로직 (생산량, 행성 경제 계산)
│   └── index.js            # 서버 진입점 및 미들웨어 설정
│
└── docker-compose.yml      # 로컬 개발 및 배포 환경 설정
```

---

## 3. 핵심 구현 상세

### 3.1 프론트엔드 (ogame-3d)
- **상태 관리 (`GameState.js`)**: 게임의 전역 상태(자원, 건물 레벨, 함대 등)를 관리합니다. 서버로부터의 스냅샷 동기화와 클라이언트 측의 실시간 자원 증가(Ticker)를 동시에 수행합니다.
- **3D 렌더링 (`SpaceScene.js`)**: Three.js를 사용하여 행성 및 우주 환경을 렌더링하며, 사용자의 선택에 따라 타겟 행성을 시각적으로 전환합니다.
- **UI 시스템 (`UIManager.js`)**: 고전 우주 전략 게임풍(남색·황동색, 세리프) 사령부 콘솔 UI를 담당합니다. 엔티티 목록은 `EntityBrowser`가 서버 카탈로그로부터 렌더링합니다.

### 3.2 백엔드 (server)
- **지연된 상태 정산 (Lazy Settlement)**: 서버는 매 초마다 모든 사용자의 상태를 업데이트하지 않습니다. 대신 사용자가 로그인하거나, 특정 행동을 하거나, 소켓 요청이 올 때 현재 시점까지의 자원 생산 및 큐 완료를 계산(`settleUserState`)하여 효율성을 높입니다.
- **게임 큐 시스템 (`BuildingQueue.js`)**: 건물 건설, 연구, 함선 건조를 각각 독립된 큐로 관리합니다. 각 타입별로 동시에 하나의 작업만 진행될 수 있으며, 다음 작업은 자동으로 `pending`에서 `building` 상태로 전환됩니다.
- **데이터 영속성**: 모든 게임 데이터는 MongoDB에 저장됩니다. 클라이언트측 `localStorage`는 부정행위 방지를 위해 초기화 시에만 사용되거나 무시됩니다.

### 3.3 통신 및 동기화
- **Auth (JWT)**: 사용자 인증을 통해 세션을 관리합니다.
- **Server Push (Socket.io)**: 건설 완료, 함대 도착, 관리자 안내 등 실시간성이 필요한 이벤트는 서버에서 클라이언트로 직접 푸시합니다.
- **Game Snapshot**: 서버에서 계산된 최신 상태를 `Snapshot` 형태(전체 데이터 셋)로 전송하여 클라이언트와 서버 간의 데이터 일치성(Sync)을 보장합니다.

---

## 4. 다음에 이어서 개발할 개발자를 위한 가이드

### 4.1 새로운 건물/기술/함선 추가하기
엔티티 정의의 단일 출처(SSOT)는 `server/data/catalog/` 입니다. **파일 하나에 객체 하나를 추가하면 끝**입니다.

| 종류 | 파일 |
|:--|:--|
| 건물 | `server/data/catalog/buildings.js` |
| 연구 | `server/data/catalog/research.js` |
| 함선 | `server/data/catalog/ships.js` |
| 방어시설 | `server/data/catalog/defense.js` |

```js
// server/data/catalog/ships.js 의 배열 끝에 추가
{
  id: 'escortCarrier',            // camelCase, 타입 내 유일
  name: '호위 항모',
  icon: '🛩️',
  category: 'military',           // 'civil' | 'military' — 조병창 탭이 자동 생성됨
  description: '경전투기 편대를 운용하는 중형 모함',
  cost: { metal: 38000, crystal: 22000, deuterium: 6000 },
  buildTime: 1500,                // 초
  requires: { buildings: { shipyard: 6 }, research: { impulseDrive: 5 } },
  stats: { hull: 52000, shield: 150, attack: 300, speed: 9000, cargo: 1200, fuel: 400, rapidFire: { lightFighter: 3 } },
  model: { hull: 'lance', faction: 'alliance', scale: 1.9, engines: 4 }  // 3D 모델 (생략 시 자동 선택)
}
```

자동으로 처리되는 것:
- **검증**: 서버 부팅 시 `schema.js`의 `validateCatalog`가 id 중복, 존재하지 않는 요구조건/속사 대상, 잘못된 비용을 즉시 에러로 알립니다.
- **DB 스키마**: `User` 행성 스키마의 레벨/수량 필드가 카탈로그에서 생성됩니다.
- **클라이언트**: `GET /api/game/catalog`로 받아 건설·연구·조병창 목록, 탭(category), 비용·시간·선행조건·해금 정보를 렌더링합니다. 클라이언트 코드 수정이 필요 없습니다.
- **공식 일치**: 클라이언트 `ogame-3d/src/data/catalog.js`의 비용/시간 공식은 서버 `utils/gameCalculations.js`와 동일하며 `server/test/clientCatalogParity.test.js`가 이를 보장합니다.

건물의 생산/저장/건설속도 효과는 `effects`(`production`, `energyProduction`, `energyConsumption`, `storage`, `constructionModifiers`)로 선언합니다. 새로운 *종류*의 효과가 필요할 때만 `server/utils/planetEconomy.js`와 `ogame-3d/src/ui/views/entityDetails.js`를 함께 수정합니다.

### 4.2 항목 3D 모델
- 모델은 `ogame-3d/src/three/ships/`에서 카탈로그의 `model` 사양으로 절차적으로 생성됩니다 (외부 에셋 없음).
  - `hull`: `wedge`(동맹식 전함) · `lance`(제국식 유선형) · `fighter` · `freighter` · `colony` · `probe` · `satellite` · `fortress`(요새)
  - `faction`: `alliance` · `empire` · `civil` (도색), `scale`, `engines`, 그리고 선체별 옵션(`flagship`, `sponsons: 'heavy'`, `wings: 'swept'`, `pods`, `arms`)
- 새 선체 형태가 필요하면 `hulls.js`에 빌더 함수 하나를 추가하고 `HULLS`에 등록합니다.
- 개발 서버에서 `/ship-lab.html`을 열면 사양 JSON을 편집하며 실시간으로 모델을 확인할 수 있습니다.

- 건물 12종과 연구 15종도 카탈로그 model을 사용한다. `src/three/entities/EntityModels.js`에서 시설 디오라마/실험 장치를 생성하며 건물은 완료 레벨 1~9/10~19/20~29/30+에 따라 구조가 발전한다. 공통 ModelViewer/ModelThumbnails가 조병창과 renderer를 공유한다.
- `EntityBrowser`는 실제 상태와 다음 외형 미리보기를 구별하고 모바일에서도 명령 버튼을 상세 하단에 유지한다. 실패 시 정지 모형/설명으로 복구한다. 확장·검증은 `docs/entity-models.md`, 개발용 전시는 `/entity-lab.html`을 참고한다.

### 4.3 UI 구조
- `ogame-3d/src/ui/views/EntityBrowser.js`: 건설·연구·조병창 공통의 목록+상세 컴포넌트 (카탈로그 기반)
- `ogame-3d/src/ui/views/OrbitChart.js`: 성계 궤도도(공전 애니메이션·좌표 조회). 성계도(`GalaxyView`)와 함대 작전 지도(`StrikeMap`)가 공유
- 군사 메뉴는 조병창·함대·전투로 분리한다. `FleetFormationView.js`는 서버에 저장되는 이름 있는 함대 편성(이미지 카드·수량·초안 보호), `FleetRoster.js` + `StrikeMap.js` + `dragArrow.js`는 대기 함대의 드래그/클릭 출격을 담당한다. 이동 시간 공식은 `src/data/fleetMath.js`(서버와 parity 테스트).
- 전투 하단의 임무 카드는 출격 성공 스냅샷으로 생성된다. 출격/귀환 중 함대는 대기 목록에서 제외되고 귀환 완료 시 생존 수량으로 같은 편성을 복구한다.
- `UIManager`는 사용자별 소켓 알림과 화면 활성화/8초 보조 동기화로 최신 상태를 받는다. 구버전 스냅샷을 거부하며 응답이 유실된 출격은 sessionStorage의 동일 requestId로 복구한다.
- 스타일: `style.css`(토큰·레이아웃), `src/ui/views.css`(게임 화면), `src/ui/galaxy.css`(궤도도), `src/ui/strike.css`(작전 지도), `src/ui/fleet-command.css`(함대 편성·전투 카드), `src/ui/admin.css`(관리 본부)

### 4.4 전투 시스템 확장
- `FleetFormationService`가 사용자 내 `fleetFormations`를 저장한다. `planets[].fleet`는 주둔 총량이며 대기 편성의 수량은 예약으로 계산한다. 사용자 저장에서 방어 손실 후 예약량을 정합화한다.
- `FleetService`가 출격·전투·귀환을 트랜잭션으로 적용한다. 사용자 수량/버전, 이동, 보고서를 함께 저장하고 `{userId, requestId}` 및 보고서 이동 ID 고유 인덱스로 중복 적용을 방지한다.
- MongoDB replica set이 실행 조건이다. `transactions.js`의 AsyncLocalStorage로 정산·건조·관리자 자원 변경도 같은 트랜잭션에 참여한다. 실행/격리 검증 절차는 `docs/fleet-development.md` 및 `docker-compose.fleets.yml`을 참고한다.
- 전투 입력은 기존 8웨이브를 유지하되 각 웨이브가 함종별 수량 맵을 받는다. 카탈로그 순서대로 배치해 8종 초과 조합도 누락하지 않고 기존 단일 함종 덱을 변환한다. 임무별 난수 seed로 트랜잭션 재시도 결과를 고정한다.
- `server/services/CombatService.js`에서 전투 공식을 수정할 수 있습니다. 현재는 기본적인 라운드 기반 시뮬레이션이 구현되어 있습니다.

### 4.5 정찰
- `ScoutService`는 미배정 정탐 드론 1척 출격·도착 관측·탐지/요격·귀환을 처리한다. `FleetService`의 공통 tick은 `spy`를 이 서비스로 분기한다. 출격 수량과 보고/귀환은 동일 트랜잭션 경계를 사용한다.
- `ScoutReport`는 허용된 정보만 저장하며 본인 보고서와 상대 탐지 알림은 다른 DTO로 조회한다. 출발 첩보 기술을 고정하고 도착 당시 좌표의 점령자와 병력을 관측한다.
- `ScoutController`는 클릭별 요청 ID와 잠정 수량/응답 유실 복구를 관리한다. `ScoutReportsView`는 성계도 오른쪽 최신 관측과 전투 화면 정찰 이력에 공유된다. 상세 계약·검증은 `docs/scouting.md`를 참고한다.

### 4.6 관리자 기능
- `adminService.js`와 `UIManager.js`의 Admin 탭 로직을 통해 전체 서버 속도 조절, 자원 지급, 사용자 관리 기능을 확장할 수 있습니다.

---

## 5. 주요 설정 파일
- `.env`: API URL, MongoDB URI, 포트 설정 등을 포함합니다.
- `docker-compose.yml`: 개발 환경에서 MongoDB와 Node 서버를 한 번에 실행하기 위해 사용됩니다.
