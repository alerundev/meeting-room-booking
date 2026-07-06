# Meeting Room Booking + MCP Server

사내 회의실 예약 웹 서비스 + Porter AI 연동용 MCP 서버

## 기존 기능

- 회의실 목록 조회
- 예약 생성 / 조회 / 취소
- Web UI (public/)

## MCP 서버 (Porter AI 연동)

Cloudtype에 배포 후 Porter AI에서 MCP 서버로 연결할 수 있습니다.

### MCP 엔드포인트

| 엔드포인트 | 설명 |
|---|---|
| `GET /mcp/sse` | SSE 연결 (MCP 클라이언트 연결) |
| `POST /mcp/messages` | 메시지 처리 |

### MCP Tools

| Tool | 설명 |
|---|---|
| `list_rooms` | 회의실 목록 조회 |
| `list_reservations` | 예약 목록 조회 (선택적으로 날짜 필터) |
| `create_reservation` | 회의실 예약 생성 |
| `cancel_reservation` | 예약 취소 |

### 인증

Porter AI 연결 시 **Bearer Token** 방식으로 인증합니다.

Header: `Authorization: Bearer <MCP_TOKEN>`

Cloudtype 배포 시 환경변수 `MCP_TOKEN`을 설정하면 해당 토큰으로 인증됩니다.
토큰을 설정하지 않으면 인증 없이 허용됩니다.

## 배포 (Cloudtype)

### 환경변수

| 변수 | 설명 | 예시 |
|---|---|---|
| `MCP_TOKEN` | MCP 접속용 Bearer 토큰 | `my-secret-token` |
| `DB_HOST` | DB 호스트 | (Cloudtype DB 자동 주입) |
| `DB_PORT` | DB 포트 | `5432` |
| `DB_NAME` | DB 이름 | `roombooking` |
| `DB_USER` | DB 유저 | `root` |
| `DB_PASSWORD` | DB 비밀번호 | (Cloudtype DB 자동 주입) |

### Node 설정

- **템플릿**: Blank (Node.js)
- **Node 버전**: 18+
- **빌드 명령어**: `npm install`
- **시작 명령어**: `npm start`

### Porter AI 연결

1. Cloudtype에서 배포 완료 후 도메인 확인 (예: `https://my-app.cloudtype.app`)
2. Porter AI MCP 설정에서 **SSE** 타입 선택
3. URL: `https://<your-domain>/mcp/sse`
4. Access Token: 설정한 `MCP_TOKEN` 값 입력

## 로컬 개발

```bash
npm install
npm start
```

MCP 서버 로컬 테스트:
```bash
curl -N -H "Authorization: Bearer test-token" http://localhost:3000/mcp/sse
```
