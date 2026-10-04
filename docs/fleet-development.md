# 함대 편성과 전투 화면 개발·검증

## 실행 조건

함대 편성, 출격, 전투 정산, 귀환과 건조 정산은 MongoDB 트랜잭션을 사용한다.
저장된 함대의 생성·수정·출격에는 MongoDB replica set 또는 mongos 연결이 필요하다. standalone에서도 서버와 기존 로그인·정산·건조·관리 기능은 실행한다. 새 함대 변경 요청만 503으로 거부하며, 트랜잭션 없이 함대를 차감하지 않는다.
기존 사용자의 함선은 그대로 유지되며 편성 목록은 빈 목록으로 시작한다. 편성이 없는 기존 임무도 끝까지 처리한다.

## 기존 Docker 개발 DB의 replica set 구성

이 머신의 Compose 프로젝트 이름은 `gorgonian`이며 기존 DB 볼륨은 `gorgonian_mongo_data`다. 다른 프로젝트 이름으로 실행하면 별도 빈 볼륨을 만들 수 있으므로 기존 프로젝트 이름을 유지한다. 기본 Compose도 replica set 설정을 포함한다. 실제 데이터가 있다면 먼저 `mongodump`로 백업하고 백업 파일이 생성됐는지 확인한다.
`docker compose down -v` 또는 DB 초기화 명령을 사용하지 않는다.

```sh
docker compose --env-file server/.env -p gorgonian up -d --no-deps mongodb
docker compose --env-file server/.env -p gorgonian exec mongodb mongosh --eval 'rs.initiate({_id:"oogame",members:[{_id:0,host:"mongodb:27017"}]})'
docker compose --env-file server/.env -p gorgonian exec mongodb mongosh --eval 'db.hello().isWritablePrimary'
docker compose --env-file server/.env -p gorgonian up -d server client
```

이미 replica set이 구성됐으면 재초기화하지 않는다. 로컬 Node에서 Docker DB에 직접 연결할 때는
`mongodb://localhost:27017/cosmic_empire?replicaSet=oogame&directConnection=true`처럼 실제 호스트에서 접근 가능한 URI를 쓴다.
SSH 터널/외부 관리 DB라면 그 DB 운영 구성에 맞춰 replica set 연결을 준비한다.

2026-10-05 기존 실행 DB를 replica set `oogame`으로 전환했다. `gorgonian_mongo_data` 볼륨을 유지했고, 백업을 별도 DB에 복원해 6개 컬렉션의 모든 문서가 일치함을 확인했다. 전환 직후에도 문서 해시가 일치했다. 백업은 Git에서 제외된 `artifacts/db-backups/`에 보관한다. 실제 서버에서 임시 검사 계정으로 로그인·함대 생성·편성 저장·재조회까지 확인한 뒤 임시 계정을 삭제했다.

## 격리 검증 환경

사용 중인 27017/3000/5173 포트와 충돌하지 않도록 테스트 포트와 DB를 분리한다.

```sh
docker run -d --name oogame-fleet-test-mongo -p 127.0.0.1:27029:27029 mongo:7 mongod --replSet oogame-test --port 27029 --bind_ip_all
docker exec oogame-fleet-test-mongo mongosh --port 27029 --eval 'rs.initiate({_id:"oogame-test",members:[{_id:0,host:"localhost:27029"}]})'
```

서버 단위·DB 통합 검사:

```sh
cd server
FLEET_TEST_MONGODB_URI='mongodb://127.0.0.1:27029/cosmic_fleet_test?directConnection=true&replicaSet=oogame-test' \
MONGODB_TEST_URI='mongodb://127.0.0.1:27029/cosmic_coordinate_test?directConnection=true&replicaSet=oogame-test' npm test
```

통합 검사는 해당 `_test` DB를 삭제한다. 실제 사용 DB URI를 전달하지 않는다.

브라우저 검증은 별도 터미널 두 개에서 서버와 Vite를 실행한다:

```sh
cd server
MONGODB_URI='mongodb://127.0.0.1:27029/cosmic_fleet_ui_test?replicaSet=oogame-test&directConnection=true' \
NODE_ENV=test JWT_SECRET='isolated-fleet-preview-secret-not-for-production-2026' CLIENT_URL='http://localhost:5179' PORT=3999 node index.js
```

```sh
cd ogame-3d
VITE_SERVER_URL='http://localhost:3999' npm run dev -- --host 127.0.0.1 --port 5179
```

별도 터미널에서:

```sh
cd ogame-3d
FLEET_UI_MONGODB_URI='mongodb://127.0.0.1:27029/cosmic_fleet_ui_test?replicaSet=oogame-test&directConnection=true' npm run test:fleets
npm run build
```

E2E는 설치된 Chrome을 사용한다. 첫 준비 단계에서 `cosmic_fleet_ui_test`만 재생성하고 임시 계정으로 진행한다.
테스트용 JWT는 `/tmp/oogame-fleet-preview.json`에만 기록하며 결과 이미지에 포함하지 않는다.
귀환 대기를 단축하기 위해 이 DB의 임무 시간만 조절한다. 실제 게임의 이동 시간 공식은 변경하지 않는다.
이미지는 `artifacts/fleet-ui/`에 저장한다. 터치 검사는 Chrome의 실제 터치 입력 에뮬레이션이며 물리 기기 Safari 검증은 별도다.

확인을 마쳤으면 3999/5179에서 띄운 테스트 프로세스만 종료하고 테스트 컨테이너만 제거한다:

```sh
docker rm -f oogame-fleet-test-mongo
```

이 컨테이너는 실제 게임 DB 볼륨을 마운트하지 않는다. 실행 중인 `ogame-mongo`를 삭제하지 않는다.

## 현재 로컬 미리보기

구현 결과를 확인하는 동안 `http://localhost:5179`의 격리 미리보기를 유지한다.
테스트 로그인은 `fleet_ui_test`이며 실제 사용자 계정이 아니다. 비밀번호는 seed 때마다 무작위 생성하며 권한 600의 `/tmp/oogame-fleet-preview.json`에만 저장한다.
두 함대가 편성된 상태로 시작한다. 이 미리보기의 계정·함선·임무는 원래 게임 DB와 무관하다.
단위/DB 통합 검사의 임시 DB는 종료 시 삭제하지만, 이 UI 미리보기 DB는 검토용으로 유지한다.
미리보기를 종료할 때는 위 정리 절차로 테스트 서버와 전용 컨테이너만 제거한다.

## 코드 경계

- `FleetFormationService`: 편성 CRUD, 함선 예약량 검증.
- `FleetService`: 요청 ID로 출격 중복 방지, 8웨이브 입력, 도착·전투·귀환 정산.
- `transactions`: 중첩 서비스의 공통 세션, 성공 커밋 이후 알림, HTTP 응답의 커밋 이후 전송.
- `formationRules`: 예약 수량·방어 손실 후 조정. 사용자 저장에서 동일 규칙을 적용한다.
- `GameStateService`: 편성·미배정량·임무·버전을 포함한 스냅샷.
- `FleetFormationView`: 이미지 카드 편집, 초안 보호.
- `FleetRoster`/`StrikeMap`: 저장된 대기 함대 선택·드래그·출격 확인.
- `UIManager`: 군사 화면 라우팅, 스냅샷 동기화, 미확정 요청 복구와 임무 카드.

군사 메뉴 단축키는 조병창 4, 함대 6, 전투 7이다. 함대의 시각적 카드 위치에는 진형 효과가 없다.
대기 중 배정한 함선도 방어에 참여하며, 생존 함선만 귀환 후 같은 함대로 복구된다. 자동 보충은 하지 않는다.
