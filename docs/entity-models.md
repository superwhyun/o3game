# 건설·연구 3D 전시

건설·연구·조병창은 같은 목록/상세 전시를 사용한다. 목록은 정지 썸네일,
상세는 회전·확대 가능한 3D 모델이다. 건설/연구 버튼은 모델과 설명을 스크롤해도 상세 하단에 유지된다.
모바일은 페이지 스크롤을 기본으로 하고 `직접 조작`을 켜면 모형을 드래그할 수 있다.
회전/확대/초기화 버튼은 키보드와 터치로도 사용할 수 있다.

## 건물 성장

| 완료 레벨 | 외형 |
|---|---|
| 0 | 기초 시설의 미건설 설계 모습, 가동 효과 없음 |
| 1~9 | 기초 시설 |
| 10~19 | 확장 시설 |
| 20~29 | 산업 단지 |
| 30 이상 | 통합 허브 |

현재 건물 12종은 각 구간마다 설비와 구조가 확장된다. 레벨 구간은
`src/three/entities/visualRules.js`에서 계산하며 비용·생산량·요구조건 계산에는 관여하지 않는다.
`다음 외형`은 다음 구간의 설계 미리보기다. 실제 다음 건설 레벨/비용이나 서버 명령을 바꾸지 않는다.
공사 중에는 기존 완료 외형을 유지하고 서버의 완료 snapshot에서 외형을 바꾼다.
30레벨 이후에는 실제 숫자만 증가하고 최종 외형을 유지한다.

## 연구 대상

15개 연구는 해당 기술의 실험 장치를 표시한다. 연구소 건물은 건설 화면의 연구소에만 표시한다.
예를 들어 레이저는 광학 시험대, 보호막은 발생기와 방어막, 장갑은 장갑 단면과 충격 시험 장치다.
`연구 대상` 설명에서 무엇을 관찰하는지와 구성요소를 확인할 수 있다.
연구는 고유 장치 1종씩이며 레벨별 성장 모델은 현재 범위에 없다.
장치는 개념 모형으로 표시하며 게임에 없는 효과를 추가하지 않는다.

## 코드와 항목 추가

- 서버 카탈로그 `server/data/catalog/buildings.js`, `research.js`에 `model: {kind, archetype, styleVersion}`를 선언한다.
- `schema.js`가 시각 설정을 검증하고 기존 `display.model` 저장/카탈로그 API/파일 동기화 경로로 전달한다.
- 기존 DB에 model이 없으면 seed의 모델을 합친다. 이름·비용 등 기존 override를 보존한다. DB 초기화는 필요 없다.
- `ogame-3d/src/three/entities/EntityModels.js`의 BUILDERS/EXPERIMENTS에 제작 함수를 추가한다. 건물 함수는 tier(0~3)를 받는다.
- 연구의 설명은 `visualRules.js`의 RESEARCH_EXHIBITS에 추가한다. 게임 수치나 해금은 기존 카탈로그/계산을 사용한다.
- `Kit`은 건축/실험 부품을 조립하고 정적인 geometry를 재질별로 합쳐 draw calls를 줄인다. 모델은 radius/update 및 geometry/material 정리 계약을 갖는다.
- `ModelViewer`는 상세 전시 간 하나의 renderer를 이동해 재사용한다. `ModelThumbnails`는 하나의 renderer와 직렬 idle 큐를 공유한다. 함선 모형 제작 함수와 기존 ShipViewer/ShipThumbnails 호출은 유지한다.
- 같은 성장 구간의 자원 tick/레벨 증가에는 geometry를 재생성하지 않는다. 모델 키는 타입·항목·스펙·구간·미건설 상태를 포함한다.
- 썸네일 캐시는 LRU 방식 최대 96개/추정 문자열 48MiB이며 실패 항목은 재시도 가능하다. 이 값은 이미지 디코딩 메모리를 포함한 전체 기기 RAM 측정값은 아니다.
- 숨긴 화면/브라우저 탭은 RAF를 정지하고 실제 페이지 종료 시 renderer/환경 자원을 정리한다. reduced motion에서는 자동 회전과 장치 움직임을 끈다.
- WebGL 불가 또는 context 손실에는 정지 이미지/아이콘/설명으로 복구하며 건설·연구 명령을 유지한다. context 복구 시 3D로 돌아온다.

로그인한 개발 서버의 `/entity-lab.html`에서 48개 건물 외형과 15개 연구 모형을 한 번에 검토한다.
모형을 선택하면 상단 상세 전시에서 회전할 수 있다. 개발용 페이지이며 기본 production entry에 포함하지 않는다.

## 검증 (2026-10-05)

- 서버 전체 69개, 실패/skip 0. 시각 스펙·DB merge·전체 모델 bounds/구간별 구조/geometry 상한과 기존 게임 통합을 포함한다.
- 건설·연구 Chrome E2E 4개: 실제 큐 완료 9→10 전환/취소, 연구 완료, 63개 모델 이미지, 390px 모바일·키보드·하단 버튼 가림 방지, GL 손실/복구·GL 미지원 명령 처리, 반복 화면 전환을 검사한다.
- 모델 전체 contact sheet와 대표 데스크톱/모바일 결과를 직접 확인했다. 이미지 출력은 Git에 포함하지 않는 `artifacts/entity-ui/`다.
- 대표 중력자 장치 10초 측정 p95 프레임 간격 16.8ms, 6 draw calls/3152 triangles. 50회 화면 전환 전후 geometry 6개/texture 2개 유지. Chrome 로컬 측정으로 물리 저성능 기기 수치는 아니다.
- 현재 실행 서버/실제 DB에서 임시 계정으로 카탈로그 27개 시각 스펙, localhost:5174의 건설·연구 렌더링과 미리보기 무변경, JS 오류 없음 확인. 검사 계정을 정리하고 기존 계정 수를 유지했다. 기존 사용자 레벨·자원을 변경하지 않았다.
- 물리 모바일 Safari/원격 배포는 미실행. 빌드는 통과하며 기존 500kB 번들 경고는 남아 있다.

환경과 전체 회귀 실행은 [fleet-development.md](fleet-development.md)를 따른다.
선택적으로 브라우저 3D 검사만 실행하려면:

```sh
FLEET_UI_MONGODB_URI='mongodb://127.0.0.1:27029/cosmic_fleet_ui_test?replicaSet=oogame-test&directConnection=true' \
npm --prefix ogame-3d run test:fleets -- entity-ui.spec.js
```

검사는 지정된 격리 UI DB를 재생성한다. 실제 게임 DB URI를 전달하지 않는다.
