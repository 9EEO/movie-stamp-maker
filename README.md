# 영화 우표 메이커

영화 포스터를 검색해 위치를 맞추고, 코닥 미니 3 레트로(3×3인치 인화지)에 우표 3개짜리 시트로 출력하는 웹앱입니다. 출력한 우표는 펀칭기(31.7 × 38.1mm)로 찍어 냅니다. 서버 없이 브라우저 안에서만 동작하고, 데이터는 기기(IndexedDB)에만 저장됩니다.

- 설계: [docs/2026-11-21-movie-stamp-design.md](docs/2026-11-21-movie-stamp-design.md)
- 구현 계획: [docs/superpowers/plans/2026-11-21-movie-stamp-maker.md](docs/superpowers/plans/2026-11-21-movie-stamp-maker.md)

## 실행

Node.js 18 이상이 필요합니다.

```bash
npm install
npm run dev -- --host   # 같은 네트워크의 폰에서 http://<맥 IP>:5173 으로 접속
npm test                # 단위 테스트 (vitest)
npm run build           # dist/ 에 정적 파일 생성
```

TMDB API 키는 앱의 설정(⚙)에서 넣습니다. [TMDB 설정 → API](https://www.themoviedb.org/settings/api)의 'API 읽기 액세스 토큰'(v4) 또는 API 키(v3) 둘 다 됩니다.

> 홈 화면 추가(PWA 설치)와 오프라인 동작은 HTTPS나 localhost에서만 됩니다. `http://<IP>:5173`로 접속하면 앱은 동작하지만 설치는 안 됩니다.

## 배포 (GitHub Pages)

1. GitHub에 저장소를 만들고 `main` 브랜치를 push합니다.
2. 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꿉니다.
3. `main`에 push할 때마다 [deploy.yml](.github/workflows/deploy.yml)이 테스트 → 빌드(`BASE_PATH=/<저장소 이름>/`) → 배포합니다. 주소는 `https://<아이디>.github.io/<저장소 이름>/` 입니다.

아이콘을 바꾸려면 `node scripts/make-icons.mjs`를 고친 뒤 다시 실행합니다.

## 코닥 앱으로 출력하기

1. 앱에서 시트의 [공유]를 눌러 코닥 앱을 고르거나, [저장]한 PNG를 코닥 앱에서 불러옵니다.
2. 코닥 앱에서 **테두리 없음**으로 출력하고, 자르기·위치 편집은 건드리지 않습니다.
3. 처음에는 설정의 **테스트 시트**를 한 장 출력해 눈금자와 칼선을 재고, 어긋난 만큼 배율·오프셋을 입력합니다.

## 실제 출력 확인 기록

실측 결과를 여기에 남깁니다(계획 Task 14 Step 2).

| 항목 | 결과 |
|---|---|
| 안드로이드 공유 목록에 코닥 앱이 뜨는가 | (미확인) |
| 코닥 앱이 자르기 화면을 띄우는가 | (미확인) |
| 테스트 시트 50mm 눈금자 실측 | (미확인) |
| 입력한 보정값 (배율 / 가로 / 세로) | (미확인) |
| 펀칭 결과 (흰 가장자리 여부) | (미확인) |
