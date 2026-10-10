# osu! Skill Lab — Ranked Edition v0.3

Ranked osu!standard 비트맵과 리플레이를 로컬에서 분석하는 개인용 프로토타입입니다.

## 실행
Windows에서 `실행.bat`을 더블클릭하세요. Python 3.10+가 필요합니다.

## 현재 구현
- 여러 `.osu` 파일을 로컬 DB에 누적 (브라우저 localStorage)
- Ranked/Approved/Qualified/Loved 등 온라인 상태를 붙일 수 있는 확장 스키마
- 공식 SR/플레이·패스 카운트와 체감 난이도를 분리 저장
- Clear / FC / Accuracy / Reading / Stamina 체감 난이도 및 표본 수 구조
- 검색 및 자체 Skill 지표별 로컬 순위
- Aim / Stream / Speed / Stamina / Tech / Reading / Flow 휴리스틱
- Chart X-Ray 시간별 strain 그래프
- 스트림/버스트 후보 자동 탐지
- BPM, 길이, 오브젝트, spacing, gap 통계
- `.osr` 입력 통계 및 비트맵 MD5 매칭
- DB 통계, 패턴 통계, 간단한 훈련 추천

## 주의
- osu! 공식 제품이 아닙니다.
- 현재 앱은 `.osu`가 실제 Ranked인지 아직 온라인으로 검증하지 않으며 UI에 `LOCAL · 미검증`으로 표시합니다.
- Skill Lab 지수와 패턴 분류는 자체 휴리스틱이며 공식 Star Rating/pp가 아닙니다.
- 전 세계 순위/백분위, 공식 API 동기화, 정확한 판정/UR 재구성은 아직 미구현입니다.

## Version
v0.3 Ranked Edition
