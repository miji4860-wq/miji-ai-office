# 미지 님 비서실 웹앱 (miji-ai-office)

- 프론트: https://miji4860-wq.github.io/miji-ai-office/ (GitHub Pages, `index.html`)
- 노션 중계 서버: https://miji-ai-office-api.vercel.app/api/hub (Vercel, `api/hub.js`)
- 노션 공용 허브: 👑 미지 님 비서실 공용 허브 (42588732-2916-814c-82dd-cce3cc72ffb0)

## 연동 구조
- `GET /api/hub` → 비서 5명 상태표, 공용 요청 보드, 최신 회의 안건·각자 의견을 JSON으로 반환
- `POST /api/hub` → `{action:'instruction'|'agenda'|'memo', text}` 를 노션 허브에 블록으로 기록
- 웹앱 지휘실에서 보낸 지시는 요청 보드에, `안건:`으로 시작하면 회의 안건으로 올라갑니다.
- 회의실 탭은 60초마다 허브를 다시 읽어 안건·의견을 보여줍니다.
- `🔄 실시간 자동` 모드: 가동 중 → 책상, 대기/휴식 → 산책, 회의 중 → 회의실 좌석.

## Vercel 환경변수
- `NOTION_TOKEN` (노션 Personal Access Token, Miji AI Office)
- `HUB_PAGE_ID=42588732-2916-814c-82dd-cce3cc72ffb0`
- `OFFICE_KEY` (접속 비밀번호. 모든 요청의 `X-Office-Key` 헤더와 일치해야 하며, 없거나 틀리면 401)

## 접속 잠금
- `index.html`에는 비밀번호가 들어 있지 않습니다. 앱은 이 기기의 `localStorage['mijiOffice.key.v3']`에 저장된 키로만 동작합니다.
- 저장된 키가 없으면 잠금 화면만 보이고, 입력값이 `/api/hub`에서 200을 받을 때만 저장·해제됩니다. 401이면 오류 메시지를 보여 줍니다.
- 헤더의 🔒 버튼으로 다시 잠글 수 있습니다(저장된 키 삭제).
- 응답은 `Cache-Control: private, no-store` + `Vary: X-Office-Key` 로 캐시하지 않습니다. 인증이 헤더에 달려 있어 공유 캐시에 남으면 키 없이도 읽힐 수 있기 때문입니다.
