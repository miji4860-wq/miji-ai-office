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
- `OFFICE_KEY` (웹앱이 `X-Office-Key` 헤더로 보내는 간단한 게이트)
