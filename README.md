# O3Game 실행

Docker Compose와 Node.js 22 이상이 설치된 환경에서 실행합니다.

```bash
./start.sh
```

MongoDB, Redis, 백엔드, 프론트엔드, AI 워커를 백그라운드로 실행하고 준비 상태를 확인합니다. 최초 실행 시 `server/.env`에 개발용 인증 키를 생성하고 MongoDB 복제 세트를 초기화합니다. 기존 키와 DB는 재사용합니다. AI 모델은 게임 관리자 화면에서 별도로 설정합니다.

- 게임: http://localhost:5173
- 백엔드 상태: http://localhost:3999/ready

포트는 `SERVER_PORT=4999 CLIENT_PORT=5180 ./start.sh`처럼 변경할 수 있습니다. 다른 PC에서는 `localhost` 대신 서버 IP를 사용하세요.

로그 확인:

```bash
docker logs -f ogame-server
docker logs -f ogame-client
docker logs -f ogame-ai-player
```

전체 중지 (DB 데이터 유지):

```bash
docker stop ogame-ai-player ogame-client ogame-server ogame-redis ogame-mongo
```
