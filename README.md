# osu! Skill Lab — Ranked Edition v0.5

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
v0.5 Ranked Edition

## 공식 osu! API 연결 (v0.5)
1. osu! 계정 설정에서 OAuth 애플리케이션을 등록하세요: https://osu.ppy.sh/home/account/edit
2. Windows PowerShell에서 아래 환경변수를 등록하세요 (값은 본인 발급값 사용).
   `[Environment]::SetEnvironmentVariable("OSU_CLIENT_ID", "발급된_ID", "User")`
   `[Environment]::SetEnvironmentVariable("OSU_CLIENT_SECRET", "발급된_SECRET", "User")`
3. 터미널을 새로 열고 `실행.bat`으로 앱을 실행하세요.
4. RANKED 탭에서 공식 Ranked 검색을 이용하거나, .osu 파일을 추가하여 MD5로 검증하세요.

- 비밀키를 저장소, 브라우저 localStorage, README에 붙여넣지 마세요.
- 서버는 127.0.0.1에서만 실행하며 OAuth 토큰은 메모리에 캐시합니다.
- 공식 검색 결과는 메타데이터만 표시합니다. 채보 자체 분석은 로컬 .osu 파일이 필요합니다.
- 현재 공식 전체 Ranked DB 크기/세계 백분위는 제공하지 않습니다.
- 공식 SR은 기본 난이도 기준이며, Skill Lab 휴리스틱과 별도입니다.

## 📱 Mobile / PWA Edition
v0.5부터 정적 웹 호스팅에서도 `.osu` 파일을 브라우저에서 직접 분석할 수 있습니다.

- Python 없이 모바일 브라우저에서 .osu 채보 분석
- 홈 화면 설치용 PWA manifest
- Service Worker 기반 앱 셸 오프라인 캐시
- 작은 화면/Fold 계열 반응형 UI
- 브라우저 계산 결과는 `MOBILE · 미검증`으로 표시
- 공식 osu! API 검색과 .osr 고급 분석은 로컬 PC 서버 모드에서 사용

### GitHub Pages
이 저장소가 Private인 경우 계정/플랜 설정에 따라 Pages 사용 가능 여부가 달라질 수 있습니다.
Pages를 사용할 경우 배포 소스는 main 브랜치의 루트(/)로 설정합니다.

### v0.5.1 Mobile Statistics
- PC와 모바일에서 동일한 분석 DB 통계 UI 사용
- Skill 평균 / BPM 구간 / 패턴 / 검증 상태 통계
- JSON DB 내보내기/가져오기로 기기간 기록 이동
- 브라우저 localStorage는 기기별 저장이므로 자동 동기화는 아직 지원하지 않음

### v0.6 Ranked Metadata Index (PC → Mobile)
1. 공식 osu! OAuth 애플리케이션을 만들고 `OSU_CLIENT_ID` / `OSU_CLIENT_SECRET`을 **PC 환경변수**로 설정합니다. 비밀키를 GitHub Pages에 넣지 마세요.
2. 저장소 파일을 PC에 내려받은 뒤 PowerShell에서 `python collect_ranked.py --pages 5`를 실행합니다. 최대 20페이지/실행, 요청 간 최소 1초 간격. `--query`로 검색어를 제한할 수 있습니다.
3. 생성된 `data/ranked-index.json`을 폰으로 전송합니다.
4. 모바일 사이트 **STATS → Ranked 색인 가져오기**에서 파일을 선택합니다. 공식 SR 상위 목록과 평균 통계를 확인할 수 있습니다.
5. 같은 명령을 다시 실행하면 `next_cursor`부터 이어서 수집하고 beatmap_id로 중복 제거합니다. 완료된 경우 다시 첫 페이지에서 시작합니다.

**한계:** API 자격증명 없이는 수집을 실행할 수 없습니다. 현재 공개 GitHub Pages 자체는 osu! API 자격증명을 보관하거나 자동 수집하지 않습니다. 색인은 공식 **메타데이터만** 담고 있으며 개별 `.osu` 채보 파일, Chart X-Ray 분석, 전 세계 Ranked 전체 통계, 개인 성적/백분위가 자동 생성되는 것은 아닙니다. 분석된 로컬 맵 DB와 공식 메타데이터 색인은 별도로 관리됩니다. API 이용 약관과 호출 제한을 준수하세요.
