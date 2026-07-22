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
- **UI 시스템 (`UIManager.js`)**: "Holographic" 테마의 UI를 담당합니다. 템플릿 리터럴을 사용해 동적으로 HTML을 생성하며, CSS 변수를 활용해 생동감 있는 애니메이션을 제공합니다.

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

### 4.1 새로운 건물/기술 추가하기
1. `server/data/entityCatalogDefaults.js`에 새로운 엔티티 정의를 추가합니다.
2. `ogame-3d/src/data/gameData.js`에 프론트엔드용 아이콘 및 설명을 추가합니다.
3. `server/utils/planetEconomy.js`에서 해당 건물이 생산량이나 창고 용량에 영향을 준다면 로직을 업데이트합니다.

### 3.2 전투 시스템 확장
- `server/services/CombatService.js`에서 전투 공식을 수정할 수 있습니다. 현재는 기본적인 라운드 기반 시뮬레이션이 구현되어 있습니다.

### 3.3 관리자 기능
- `adminService.js`와 `UIManager.js`의 Admin 탭 로직을 통해 전체 서버 속도 조절, 자원 지급, 사용자 관리 기능을 확장할 수 있습니다.

---

## 5. 주요 설정 파일
- `.env`: API URL, MongoDB URI, 포트 설정 등을 포함합니다.
- `docker-compose.yml`: 개발 환경에서 MongoDB와 Node 서버를 한 번에 실행하기 위해 사용됩니다.
