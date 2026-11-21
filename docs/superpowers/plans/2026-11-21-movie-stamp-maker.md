# 영화 포스터 우표 메이커 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영화 포스터를 검색·조정해 코닥 미니 3 레트로용 3×3인치 시트(우표 3개) PNG를 만들고, 만든 우표를 컬렉션으로 관리하는 설치형 웹앱(PWA)을 만든다.

**Architecture:** 서버 없는 정적 PWA. mm 단위 레이아웃·크롭·보정 계산은 순수 함수(`src/core`)로 분리해 단위 테스트하고, 캔버스 그리기는 그 결과(아핀 변환)를 적용만 한다. 데이터는 IndexedDB(`src/data`), TMDB는 사용자 키로 브라우저에서 직접 호출(`src/tmdb`), UI는 Preact 컴포넌트(`src/ui`).

**Tech Stack:** Vite 5, TypeScript, Preact, `idb`, Vitest + jsdom + `fake-indexeddb` + `@testing-library/preact`, `vite-plugin-pwa`, GitHub Pages.

**Spec:** `docs/2026-11-21-movie-stamp-design.md` (실행자는 이 계획과 함께 반드시 읽을 것)

## Global Constraints

- Node.js 18 이상 (개발은 맥북에서 진행)
- 주 사용 환경: **안드로이드 Chrome**. PC 브라우저는 보조, iOS는 비지원(동작하면 좋음)
- UI 문구는 전부 한국어
- 출력 이미지: **900 × 900px**, 인화지 **76.2mm**, `PX_PER_MM = 900 / 76.2`
- 우표 칼선: **31.7 × 38.1mm**, 번짐(bleed): 칼선 바깥 사방 **1mm**, 가이드 선 없음
- 시트당 3칸: 칸1·칸2 세로(위), 칸3 가로(아래, 가운데 정렬). 칸3은 포스터를 **시계 방향 90°** 회전해 그린다
- 로그인·서버 없음. 데이터는 기기 IndexedDB에만. TMDB 키는 기기에만 저장
- 레이아웃 수치는 `src/core/layout.ts` 한 곳에만 정의

## Review Focus

1. **안드로이드 뒤로가기:** 조정 화면·상세·설정 같은 오버레이가 열린 상태에서 뒤로가기를 누르면 오버레이만 닫혀야 한다(앱을 나가면 안 됨). → Task 9
2. **해상도가 낮은 원본:** 작은 업로드 이미지나 과하게 확대한 크롭은 출력이 흐려진다. 조정 화면과 대기열에 "해상도 낮음" 경고를 표시한다. → Task 2(`isLowRes`), Task 10
3. **TMDB 키 없음·틀림·오프라인:** 검색 영역에 원인별 안내와 설정 바로가기를 띄우고, "내 사진 올리기"는 계속 동작해야 한다. → Task 7, Task 9
4. **포스터 없는 검색 결과**(`poster_path: null`): "포스터 없음"으로 보여주고 추가 버튼은 비활성화한다. → Task 7, Task 9
5. **잘못된 백업 파일**(다른 JSON, 깨진 파일, 미래 버전): 가져오기를 거부하고 기존 데이터는 그대로 둔다. → Task 6

---

## 파일 구조

```
index.html
vite.config.ts            # Vite + Preact + PWA + vitest 설정, base 경로
src/main.tsx
src/core/layout.ts        # 인화지·칸 상수, mm↔px, 칸 변환
src/core/affine.ts        # 2D 아핀 변환 타입·합성·적용
src/core/crop.ts          # Crop 타입, 배치 계산, 범위 제한, 저해상도 판정
src/core/calibration.ts   # 보정값 → 아핀 변환
src/core/sheet.ts         # 대기열 → 시트 나누기, 시트 그리기, 테스트 시트 그리기
src/data/db.ts            # IndexedDB 스키마와 저장소 함수
src/data/backup.ts        # 백업 내보내기/가져오기
src/tmdb/client.ts        # TMDB 검색·포스터 목록·이미지 URL
src/platform/image.ts     # URL/Blob → 디코딩된 이미지
src/platform/output.ts    # 공유 / 저장(다운로드)
src/ui/App.tsx            # 화면 셸, 오버레이 스택(뒤로가기 연동)
src/ui/Home.tsx           # 검색 + 출력 대기 + 만든 우표
src/ui/Search.tsx
src/ui/CropEditor.tsx
src/ui/QueueSheets.tsx
src/ui/MadeGallery.tsx    # 갤러리 + 상세
src/ui/Settings.tsx       # 키, 보정, 백업
src/ui/StampThumb.tsx     # 톱니 마스크 썸네일
src/ui/Toast.tsx
src/ui/styles.css
tests/...                 # src 구조를 그대로 따름
```

---

### Task 1: 프로젝트 뼈대 + 레이아웃 상수

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `.gitignore`(`node_modules`, `dist`, `.superpowers`)
- Create: `src/core/affine.ts`, `src/core/layout.ts`
- Test: `tests/core/layout.test.ts`

**Interfaces:**
- Produces:
  - `type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number]` (캔버스 `setTransform`과 같은 의미: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`)
  - `IDENTITY: Affine`, `compose(outer: Affine, inner: Affine): Affine` (inner를 먼저 적용), `apply(m: Affine, x: number, y: number): [number, number]`, `scale(s: number): Affine`, `translate(x: number, y: number): Affine`
  - `PAPER_MM = 76.2`, `SHEET_PX = 900`, `PX_PER_MM = 900 / 76.2`, `STAMP_W_MM = 31.7`, `STAMP_H_MM = 38.1`, `BLEED_MM = 1`
  - `interface Slot { index: 0 | 1 | 2; xMm: number; yMm: number; wMm: number; hMm: number; rotated: boolean }` (칼선 기준, 종이 좌표)
  - `SLOTS: readonly Slot[]`
  - `slotTransform(slot: Slot): Affine`: **세로 우표 좌표계**(원점 = 세로 칼선 왼쪽 위, mm)를 종이 mm 좌표로 옮긴다. `rotated`이면 시계 방향 90°
  - `PX_TRANSFORM: Affine = scale(PX_PER_MM)`

- [ ] **Step 1: Vite + Preact + TS 프로젝트 생성, 의존성 설치, `git init`**

Run: `npm create vite@latest . -- --template preact-ts` 후 `npm i idb` / `npm i -D vitest jsdom fake-indexeddb @testing-library/preact vite-plugin-pwa`. vitest `environment: 'jsdom'`.
Expected: `npm run dev`로 기본 페이지가 뜬다.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/core/layout.test.ts
test('SLOTS match design coordinates', () => {
  expect(SLOTS[0]).toMatchObject({ xMm: expect.closeTo(4.267, 3), yMm: expect.closeTo(2.133, 3), wMm: 31.7, hMm: 38.1, rotated: false });
  expect(SLOTS[1]).toMatchObject({ xMm: expect.closeTo(40.233, 3), yMm: expect.closeTo(2.133, 3), rotated: false });
  expect(SLOTS[2]).toMatchObject({ xMm: expect.closeTo(19.05, 3), yMm: expect.closeTo(42.367, 3), wMm: 38.1, hMm: 31.7, rotated: true });
});
test('bleed rects never overlap and stay on paper', () => {
  // 각 칸을 사방 BLEED_MM 확장한 사각형끼리 겹치지 않고, 모두 [0, 76.2] 안
});
test('slotTransform maps portrait corners', () => {
  expect(apply(slotTransform(SLOTS[0]), 0, 0)).toEqual([closeTo(4.267), closeTo(2.133)]);
  // 칸3 (시계 방향 90°): 세로 왼쪽 위 → 가로 칸 오른쪽 위, 세로 오른쪽 위 → 가로 칸 오른쪽 아래
  expect(apply(slotTransform(SLOTS[2]), 0, 0)).toEqual([closeTo(57.15), closeTo(42.367)]);
  expect(apply(slotTransform(SLOTS[2]), 31.7, 0)).toEqual([closeTo(57.15), closeTo(74.067)]);
  expect(apply(slotTransform(SLOTS[2]), 0, 38.1)).toEqual([closeTo(19.05), closeTo(42.367)]);
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인** — Run: `npx vitest run tests/core/layout.test.ts` → FAIL (모듈 없음)

- [ ] **Step 4: `affine.ts`, `layout.ts` 구현**

좌표는 반올림하지 말고 식으로 정의한다. 가로 틈 `(PAPER_MM - 2*STAMP_W_MM) / 3`, 세로 틈 `(PAPER_MM - STAMP_H_MM - STAMP_W_MM) / 3`, 칸3 x는 `(PAPER_MM - STAMP_H_MM) / 2`.

- [ ] **Step 5: 테스트 통과 확인** — Run: `npx vitest run` → PASS

- [ ] **Step 6: 커밋** — `git add -A && git commit -m "feat: scaffold project and sheet layout constants"`

---

### Task 2: 크롭 계산

**Files:**
- Create: `src/core/crop.ts`
- Test: `tests/core/crop.test.ts`

**Interfaces:**
- Consumes: `STAMP_W_MM`, `STAMP_H_MM`, `BLEED_MM`, `PX_PER_MM` (Task 1)
- Produces:
  - `interface Crop { mode: 'fill' | 'fit'; cx: number; cy: number; zoom: number }`: `cx`·`cy`는 우표 중심에 오는 원본 이미지 위의 점(0~1 정규화), `zoom ≥ 1`은 기본 배율 대비 배수
  - `DEFAULT_CROP: Crop = { mode: 'fill', cx: 0.5, cy: 0.5, zoom: 1 }`
  - `interface RectMm { xMm: number; yMm: number; wMm: number; hMm: number }`
  - `placeImage(imgW: number, imgH: number, crop: Crop): RectMm`: 세로 우표 좌표계에서 이미지 전체가 그려질 사각형
  - `clampCrop(imgW: number, imgH: number, crop: Crop): Crop`
  - `isLowRes(imgW: number, imgH: number, crop: Crop): boolean`
  - `BLEED_RECT: RectMm = { xMm: -1, yMm: -1, wMm: 33.7, hMm: 40.1 }` (세로 우표 좌표계)

기본 배율(원본 1px당 mm): `fill`은 `max(33.7/imgW, 40.1/imgH)`(번짐 사각형을 덮는 최소 배율), `fit`은 `min(31.7/imgW, 38.1/imgH)`(칼선 안에 다 들어가는 배율). 실제 배율 = 기본 배율 × `zoom`. 배치: `w = imgW·s`, `x = 31.7/2 − cx·w`(y도 같은 방식).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('fill default on 1000x1500 poster covers bleed', () => {
  const r = placeImage(1000, 1500, DEFAULT_CROP);
  expect(r).toEqual({ xMm: closeTo(-1), yMm: closeTo(-6.225), wMm: closeTo(33.7), hMm: closeTo(50.55) });
});
test('fit shows whole poster inside cut line', () => {
  expect(placeImage(1000, 1500, { ...DEFAULT_CROP, mode: 'fit' }))
    .toEqual({ xMm: closeTo(3.15), yMm: closeTo(0), wMm: closeTo(25.4), hMm: closeTo(38.1) });
});
test('clampCrop in fill mode keeps bleed covered', () => {
  const c = clampCrop(1000, 1500, { mode: 'fill', cx: 0, cy: 0, zoom: 0.5 });
  expect(c.zoom).toBe(1);
  const r = placeImage(1000, 1500, c);
  expect(r.xMm).toBeLessThanOrEqual(-1); expect(r.yMm).toBeLessThanOrEqual(-1);
  expect(r.xMm + r.wMm).toBeGreaterThanOrEqual(32.7); expect(r.yMm + r.hMm).toBeGreaterThanOrEqual(39.1);
});
test('clampCrop handles very wide upload (4000x1000) in fill mode', () => { /* 위와 같은 덮음 조건 */ });
test('isLowRes', () => {
  expect(isLowRes(780, 1170, DEFAULT_CROP)).toBe(false);     // TMDB w780
  expect(isLowRes(185, 278, DEFAULT_CROP)).toBe(true);       // 썸네일 크기
  expect(isLowRes(780, 1170, { ...DEFAULT_CROP, zoom: 4 })).toBe(true);
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/core/crop.test.ts` → FAIL

- [ ] **Step 3: 구현.** `clampCrop`의 규칙: `zoom`은 [1, 8], `fill`이면 덮음 조건을 만족하도록 `cx`·`cy`를 제한, `fit`이면 `cx`·`cy`를 [0, 1]로 제한. `isLowRes`는 원본 픽셀 밀도 `1 / s`가 `PX_PER_MM × 0.75`(≈ 8.86px/mm)보다 작으면 true.

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: 커밋** — `feat: crop placement, clamping and low-res check`

---

### Task 3: 보정 변환

**Files:**
- Create: `src/core/calibration.ts`
- Test: `tests/core/calibration.test.ts`

**Interfaces:**
- Consumes: `Affine`, `compose`, `PAPER_MM` (Task 1)
- Produces:
  - `interface Calibration { scalePct: number; offsetXMm: number; offsetYMm: number }`, `DEFAULT_CALIBRATION = { scalePct: 100, offsetXMm: 0, offsetYMm: 0 }`
  - `calibrationAffine(cal: Calibration): Affine`: 종이 mm → 보정된 종이 mm. 인화지 중심(38.1, 38.1) 기준으로 확대/축소한 뒤 오프셋을 더한다

- [ ] **Step 1: 실패하는 테스트**

```ts
test('scale is centered on paper', () => {
  const m = calibrationAffine({ scalePct: 102, offsetXMm: 0, offsetYMm: 0 });
  expect(apply(m, 38.1, 38.1)).toEqual([closeTo(38.1), closeTo(38.1)]);
  expect(apply(m, 0, 0)).toEqual([closeTo(-0.762), closeTo(-0.762)]);
});
test('offset is added after scale', () => {
  expect(apply(calibrationAffine({ scalePct: 100, offsetXMm: 0.5, offsetYMm: -0.3 }), 10, 10)).toEqual([closeTo(10.5), closeTo(9.7)]);
});
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat: print calibration transform`

---

### Task 4: 시트 나누기와 그리기, 테스트 시트

**Files:**
- Create: `src/core/sheet.ts`
- Test: `tests/core/sheet.test.ts`

**Interfaces:**
- Consumes: `SLOTS`, `slotTransform`, `PX_TRANSFORM`, `SHEET_PX` (Task 1), `Crop`, `placeImage`, `BLEED_RECT` (Task 2), `Calibration`, `calibrationAffine` (Task 3)
- Produces:
  - `chunkIntoSheets<T>(items: T[]): T[][]`: 3개씩 나누고, 마지막 시트는 3개 미만 허용
  - `interface SheetEntry { image: CanvasImageSource & { width: number; height: number }; crop: Crop }`
  - `slotMatrix(slot: Slot, cal: Calibration): Affine = compose(PX_TRANSFORM, compose(calibrationAffine(cal), slotTransform(slot)))`
  - `paintSheet(ctx: CanvasRenderingContext2D, entries: (SheetEntry | null)[], cal: Calibration): void`: 흰 배경 900×900을 칠한다. 각 칸마다 `save` → `setTransform(...slotMatrix)` → `BLEED_RECT`로 clip → 흰색 채우기(`fit` 대비) → `placeImage` 위치에 `drawImage` → `restore`. `null` 칸은 비워 둔다
  - `paintTestSheet(ctx: CanvasRenderingContext2D, cal: Calibration): void`: 각 칸 칼선 외곽선 + 중심 십자, 가로·세로 50mm 눈금자(1mm·5mm·10mm 눈금), 종이 가장자리에서 2mm 안쪽 선. 보정값을 적용한다
  - `renderToBlob(paint: (ctx: CanvasRenderingContext2D) => void): Promise<Blob>`: 900×900 캔버스에 그린 뒤 PNG Blob을 반환

- [ ] **Step 1: 실패하는 테스트.** 호출을 기록하는 가짜 ctx(`tests/helpers/fakeCtx.ts`)를 만들어 쓴다.

```ts
test('chunkIntoSheets', () => {
  expect(chunkIntoSheets([1, 2, 3, 4, 5])).toEqual([[1, 2, 3], [4, 5]]);
  expect(chunkIntoSheets([])).toEqual([]);
});
test('paintSheet draws each filled slot with its slot matrix and bleed clip', () => {
  const ctx = fakeCtx();
  paintSheet(ctx, [entry(1000, 1500), null, entry(1000, 1500)], DEFAULT_CALIBRATION);
  expect(ctx.calls.filter(c => c.name === 'drawImage')).toHaveLength(2);
  expect(ctx.transformsAtDraw[1]).toEqual(slotMatrix(SLOTS[2], DEFAULT_CALIBRATION));
  expect(ctx.clipRects[0]).toEqual([-1, -1, 33.7, 40.1]);
});
test('slot 3 bleed lands inside the paper in px', () => {
  // slotMatrix(SLOTS[2])로 BLEED_RECT의 네 모서리를 옮긴 결과가 모두 0~900 안
});
test('paintTestSheet strokes three cut outlines', () => { /* strokeRect 또는 rect가 칸마다 1회 */ });
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현.** `renderToBlob`는 `document.createElement('canvas')` + `toBlob('image/png')`를 쓴다(jsdom에서는 테스트하지 않음).
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat: sheet painting and calibration test sheet`

---

### Task 5: IndexedDB 저장소

**Files:**
- Create: `src/data/db.ts`
- Test: `tests/data/db.test.ts` (`import 'fake-indexeddb/auto'`)

**Interfaces:**
- Consumes: `Crop` (Task 2), `Calibration` (Task 3)
- Produces:
  - `interface Stamp { id: string; source: 'tmdb' | 'upload'; tmdbId?: number; title: string; year?: number; posterPath?: string; blobId?: string; crop: Crop; status: 'queued' | 'made'; queueOrder: number; createdAt: number; madeAt?: number }`
  - `interface Settings { tmdbKey?: string; calibration: Calibration; calibrated: boolean; preferredOutput?: 'share' | 'save'; installPrompted: boolean }`
  - DB 이름 `movie-stamps`, 버전 1. 저장소: `stamps`(keyPath `id`, 인덱스 `tmdbId`, `status`), `blobs`(key = id, 값 = Blob), `settings`(key = `'settings'`)
  - `addStamp(input: Omit<Stamp, 'id' | 'status' | 'queueOrder' | 'createdAt'>): Promise<Stamp>`: 대기열 맨 뒤에 추가, id는 `crypto.randomUUID()`
  - `updateStamp(id: string, patch: Partial<Stamp>): Promise<void>`, `deleteStamp(id: string): Promise<void>` (연결된 blob도 삭제)
  - `listQueue(): Promise<Stamp[]>` (queueOrder 오름차순), `listMade(): Promise<Stamp[]>` (madeAt 내림차순)
  - `reorderQueue(ids: string[]): Promise<void>` (0부터 다시 번호 매김)
  - `markMade(ids: string[], at: number): Promise<{ id: string; queueOrder: number }[]>`: 되돌리기용으로 이전 순서를 반환
  - `returnToQueue(id: string, queueOrder?: number): Promise<void>`: 순서를 주지 않으면 맨 뒤로
  - `findByTmdbId(tmdbId: number): Promise<Stamp[]>`
  - `putBlob(blob: Blob): Promise<string>`, `getBlob(id: string): Promise<Blob | undefined>`
  - `getSettings(): Promise<Settings>` (없으면 기본값), `saveSettings(patch: Partial<Settings>): Promise<void>`

- [ ] **Step 1: 실패하는 테스트** — 추가 시 queueOrder가 0, 1, 2로 매겨짐 / `reorderQueue` 결과 / `markMade` 후 `listQueue`에서 빠지고 `listMade`에 들어감 / `returnToQueue(id, 이전순서)`로 원래 자리 복원 / `deleteStamp`가 blob까지 지움 / `findByTmdbId`가 queued와 made를 모두 찾음 / `getSettings` 기본값 `{ calibration: DEFAULT_CALIBRATION, calibrated: false, installPrompted: false }`
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: `idb`로 구현.** 테스트 사이에는 DB를 지워 격리한다.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat: IndexedDB stamp/blob/settings store`

---

### Task 6: 백업 내보내기/가져오기

**Files:**
- Create: `src/data/backup.ts`
- Test: `tests/data/backup.test.ts`

**Interfaces:**
- Consumes: Task 5의 저장소 함수 전부
- Produces:
  - `exportBackup(): Promise<Blob>`: JSON `{ app: 'movie-stamp-maker', version: 1, exportedAt, stamps: Stamp[], blobs: Record<id, dataURL>, calibration }`. **TMDB 키는 포함하지 않는다**(내 판단: 파일이 공유될 수 있음)
  - `importBackup(file: Blob): Promise<{ added: number; skipped: number }>`: 합치기. 같은 `id`가 이미 있거나 (`tmdbId`, `createdAt`)가 같은 우표는 건너뛴다. 대기열로 들어오는 항목은 기존 대기열 뒤에 붙는다
  - `class BackupError extends Error`: 파일을 거부할 때 던진다

- [ ] **Step 1: 실패하는 테스트**

```ts
test('round trip restores stamps and uploaded blobs', ...);
test('import merges and skips duplicates', ...);  // 결과 { added: n, skipped: m }
test('rejects non-JSON, wrong app, future version without touching data', async () => {
  for (const bad of ['not json', '{"foo":1}', JSON.stringify({ app: 'movie-stamp-maker', version: 99 })]) {
    await expect(importBackup(new Blob([bad]))).rejects.toBeInstanceOf(BackupError);
  }
  expect(await listQueue()).toEqual(before);
});
test('export never contains tmdbKey', ...);
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현.** 모든 항목을 먼저 검증하고, 그다음 한 트랜잭션으로 쓴다.
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat: backup export/import`

---

### Task 7: TMDB 클라이언트 + 이미지 로딩

**Files:**
- Create: `src/tmdb/client.ts`, `src/platform/image.ts`
- Test: `tests/tmdb/client.test.ts`

**Interfaces:**
- Produces:
  - `interface MovieResult { tmdbId: number; title: string; year?: number; posterPath: string | null }`
  - `createTmdb(key: string, fetchFn: typeof fetch = fetch): { searchMovies(query: string): Promise<MovieResult[]>; listPosters(tmdbId: number): Promise<string[]> }`
    - 키가 `eyJ`로 시작하면 v4 토큰으로 보고 `Authorization: Bearer <key>` 헤더를 붙인다. 아니면 v3 키로 보고 `api_key` 쿼리를 붙인다
    - `searchMovies`: `GET https://api.themoviedb.org/3/search/movie?query=…&language=ko-KR&include_adult=false`. `year`는 `release_date` 앞 4자리
    - `listPosters`: `GET /3/movie/{id}/images?include_image_language=ko,en,null`의 `posters[].file_path`를 그대로 반환
  - `class TmdbError extends Error { kind: 'no-key' | 'auth' | 'network' | 'http' }`: 401이면 `auth`, fetch 자체가 실패하면 `network`
  - `posterUrl(path: string, size: 'w185' | 'w780' | 'original'): string` → `https://image.tmdb.org/t/p/{size}{path}`
  - `loadImage(src: string | Blob): Promise<HTMLImageElement>` (`src/platform/image.ts`): 문자열이면 `fetch` → Blob으로 받고, 둘 다 objectURL로 디코딩한다(캔버스 오염 방지). 출력용 포스터는 `w780`

- [ ] **Step 1: 실패하는 테스트** (가짜 fetch 사용) — v3·v4 키별로 헤더와 쿼리 / 한국어 결과 매핑과 연도 추출 / `poster_path: null`이면 `posterPath: null` / 401이면 `TmdbError('auth')` / fetch가 reject되면 `TmdbError('network')` / 빈 키면 `TmdbError('no-key')` / `listPosters` 매핑
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 실제 확인(수동).** dev 서버에서 실제 키로 검색하고 `loadImage(posterUrl(p, 'w780'))`를 캔버스에 그린 뒤 `toBlob`이 오류 없이 되는지 확인한다. 막히면 `image.tmdb.org`의 CORS 응답을 확인하고 결과를 커밋 메시지에 남긴다.
- [ ] **Step 6: 커밋** — `feat: TMDB client and image loading`

---

### Task 8: 출력(공유/저장)

**Files:**
- Create: `src/platform/output.ts`
- Test: `tests/platform/output.test.ts`

**Interfaces:**
- Produces:
  - `canShareFiles(): boolean`: `navigator.canShare?.({ files: [testPngFile] })`
  - `sheetFileName(date: Date, sheetNo: number): string` → `stamps-20261121-1430-1.png` 형식
  - `shareSheet(blob: Blob, name: string): Promise<'shared' | 'cancelled'>`: 사용자가 취소하면(`AbortError`) `'cancelled'`
  - `saveSheet(blob: Blob, name: string): void`: `<a download>`로 다운로드

- [ ] **Step 1: 실패하는 테스트** — 파일명 형식 / `navigator.share` mock이 `AbortError`로 reject되면 `'cancelled'` / `canShare`가 없으면 `false`
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat: share/save sheet output`

---

### Task 9: 앱 셸, 홈, 검색·추가

**Files:**
- Create: `src/ui/App.tsx`, `src/ui/Home.tsx`, `src/ui/Search.tsx`, `src/ui/StampThumb.tsx`, `src/ui/Toast.tsx`, `src/ui/styles.css`; Modify: `src/main.tsx`
- Test: `tests/ui/app.test.tsx`, `tests/ui/search.test.tsx`

**Interfaces:**
- Consumes: Task 5(db), Task 7(`createTmdb`, `TmdbError`, `posterUrl`)
- Produces:
  - `type Overlay = { kind: 'crop'; stampId: string } | { kind: 'detail'; stampId: string } | { kind: 'settings' }`
  - `useOverlays(): { stack: Overlay[]; open(o: Overlay): void; close(): void }`: `open`할 때 `history.pushState`, `popstate`가 오면 맨 위 오버레이를 닫는다(Review Focus 1)
  - `showToast(msg: string, action?: { label: string; run: () => void }): void`

화면: 위쪽 바(제목 "내 우표 컬렉션" + 설정 ⚙), 검색창, "출력 대기" 영역(Task 11), "만든 우표" 영역(Task 12)을 한 화면에서 세로로 스크롤한다. 폭이 넓은 PC에서는 최대 폭 480px로 가운데 정렬한다(내 판단: 폰 화면 그대로).

검색: 입력 후 300ms 디바운스. 결과 행은 썸네일(`w185`), 제목, 연도로 구성한다. 대기열이나 만든 우표에 같은 `tmdbId`가 있으면 "이미 있음" 배지를 붙인다. 행을 탭하면 `addStamp`를 하고 조정 화면을 연다. 검색창 옆의 [📷 내 사진] 버튼은 파일을 고르고 제목을 입력받은 뒤 `putBlob` → `addStamp({ source: 'upload' })` → 조정 화면 순서로 진행한다.

- [ ] **Step 1: 실패하는 테스트**
  - 조정 오버레이를 연 상태에서 `popstate`를 보내면 오버레이가 닫히고 홈이 보인다
  - 키가 없으면 검색 영역에 "TMDB 키를 설정하면 영화를 검색할 수 있어요"와 [설정 열기] 버튼이 보이고, [📷 내 사진]은 활성 상태다
  - `TmdbError('auth')` → "TMDB 키가 올바르지 않아요", `'network'` → "인터넷 연결을 확인해 주세요"
  - `posterPath: null`인 결과는 "포스터 없음"으로 보이고 추가할 수 없다
  - 이미 있는 `tmdbId`면 "이미 있음" 배지가 보이고, 그래도 추가할 수 있다
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현.** `StampThumb`는 CSS `mask`(radial-gradient 반복)로 톱니 가장자리를 만든다.
- [ ] **Step 4: 통과 확인** → PASS. `npm run dev`로 폰 폭(375px)에서 수동 확인한다.
- [ ] **Step 5: 커밋** — `feat: app shell, home and movie search`

---

### Task 10: 조정 화면 (크게)

**Files:**
- Create: `src/ui/CropEditor.tsx`
- Test: `tests/ui/cropEditor.test.tsx`

**Interfaces:**
- Consumes: `Crop`, `placeImage`, `clampCrop`, `isLowRes`, `BLEED_RECT` (Task 2), `updateStamp` (Task 5), `createTmdb().listPosters`, `posterUrl`, `loadImage` (Task 7)
- Produces: `<CropEditor stampId={string} onDone={() => void} />`

화면: 전체 화면에 칼선 비율(31.7:38.1) 틀을 화면 폭의 약 80%로 놓는다. 틀 바깥은 반투명 검정, 번짐 영역(1mm)은 점선. 포스터는 `placeImage` 결과를 화면 배율로 바꿔 틀 뒤에 그린다. 포인터 이벤트로 드래그해 `cx`·`cy`를 바꾸고, 두 손가락 핀치(PC는 휠과 슬라이더)로 `zoom`을 바꾼다. 매번 `clampCrop`을 적용한다. [꽉 채우기 | 전체 보이기] 토글을 누르면 `mode`가 바뀌고 `zoom = 1`, 가운데로 초기화된다. TMDB 우표는 아래쪽에 다른 포스터 썸네일을 가로 스크롤로 보여주고, 하나를 고르면 `posterPath`를 바꾸고 크롭을 `DEFAULT_CROP`으로 되돌린다. `isLowRes`이면 "해상도가 낮아 흐리게 나올 수 있어요" 경고를 띄운다. [완료]를 누르면 `updateStamp(crop, posterPath)` 후 닫는다.

- [ ] **Step 1: 실패하는 테스트**
  - 드래그 이벤트 후 저장된 crop이 `clampCrop`을 만족한다
  - 모드를 전환하면 `{ mode: 'fit', cx: .5, cy: .5, zoom: 1 }`이 된다
  - 작은 이미지(185×278)에서 저해상도 경고가 보인다
  - 다른 포스터를 고르면 `posterPath`가 바뀌고 crop이 초기화된다
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS. 실제 폰 Chrome에서 드래그와 핀치를 수동 확인한다(dev 서버 `--host`).
- [ ] **Step 5: 커밋** — `feat: full-screen crop editor`

---

### Task 11: 출력 대기열과 시트 저장/공유

**Files:**
- Create: `src/ui/QueueSheets.tsx`
- Test: `tests/ui/queueSheets.test.tsx`

**Interfaces:**
- Consumes: `chunkIntoSheets`, `paintSheet`, `renderToBlob` (Task 4), `listQueue`, `reorderQueue`, `markMade`, `returnToQueue`, `deleteStamp`, `getSettings`, `saveSettings` (Task 5), `loadImage`, `posterUrl` (Task 7), `canShareFiles`, `shareSheet`, `saveSheet`, `sheetFileName` (Task 8), `showToast`, `useOverlays` (Task 9)

화면: "출력 대기 N장 → 시트 M장" 문구 아래로 시트 카드를 나열한다. 각 카드에는 실제 mm 비율의 시트 미리보기(`paintSheet`를 작은 캔버스에 그림)와 [공유] [저장] 버튼이 있다. 미리보기의 칸을 탭하면 조정 화면이 열리고, 길게 눌러 드래그하면 순서가 바뀐다(`reorderQueue`). 칸마다 삭제 메뉴가 있고, `isLowRes` 칸에는 ⚠ 표시를 한다.

[공유]·[저장] 동작:
1. `settings.calibrated === false`이면 처음 한 번만 "테스트 시트를 먼저 출력해 보세요" 대화상자를 띄운다([보정하러 가기] / [그냥 진행]). 둘 중 무엇을 눌러도 다시 묻지 않도록 `calibrated`를 바꾸지는 않고 세션 동안만 기억한다.
2. 출력용 이미지는 `w780`으로 `paintSheet`해 Blob을 만들고 공유하거나 저장한다. `canShareFiles()`가 false면 [공유] 버튼을 숨긴다.
3. 공유가 `'cancelled'`면 아무것도 바꾸지 않는다. 그 외에는 `markMade`를 하고, 토스트 "만든 우표로 옮겼어요 [되돌리기]"를 띄운다. 되돌리기를 누르면 `returnToQueue(id, 이전순서)`.
4. `preferredOutput`이 있으면 그 버튼을 주 버튼으로 강조한다. 없으면 첫 출력 뒤 "어느 방법으로 출력하셨나요?"를 한 번 물어 저장한다.

- [ ] **Step 1: 실패하는 테스트**
  - 대기 5개면 시트 카드 2개(3+2)
  - 공유가 취소되면 대기열이 그대로다
  - 저장 → 대기열에서 빠짐 → [되돌리기] → 같은 순서로 복원
  - `canShareFiles() === false`이면 [공유] 버튼이 없다
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat: print queue sheets with share/save and undo`

---

### Task 12: 만든 우표 갤러리와 상세

**Files:**
- Create: `src/ui/MadeGallery.tsx`
- Test: `tests/ui/madeGallery.test.tsx`

**Interfaces:**
- Consumes: `listMade`, `returnToQueue`, `addStamp`, `deleteStamp` (Task 5), `StampThumb`, `useOverlays` (Task 9)

화면: "만든 우표 (N)" 제목과 제목 검색창, 4열 톱니 썸네일 그리드(최신순). 썸네일을 탭하면 상세 오버레이가 열린다. 상세에는 큰 우표 미리보기, 제목·연도·만든 날짜, 버튼 [다시 만들기](같은 정보로 새 우표를 대기열에 추가), [대기열로 되돌리기], [삭제](확인 후)가 있다.

- [ ] **Step 1: 실패하는 테스트** — 제목 검색 필터 / [다시 만들기]하면 대기열이 +1이고 원본은 그대로 / 삭제는 확인 후에만
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat: made stamps gallery and detail`

---

### Task 13: 설정 (키, 보정, 백업)과 첫 실행 안내

**Files:**
- Create: `src/ui/Settings.tsx`
- Test: `tests/ui/settings.test.tsx`

**Interfaces:**
- Consumes: `getSettings`, `saveSettings` (Task 5), `exportBackup`, `importBackup`, `BackupError` (Task 6), `paintTestSheet`, `renderToBlob` (Task 4), `shareSheet`, `saveSheet` (Task 8)

섹션:
1. **TMDB 키:** 입력과 [저장]. 저장할 때 `searchMovies('test')`로 검증하고 결과를 표시한다. 발급 안내 링크는 `https://www.themoviedb.org/settings/api`.
2. **출력 보정:** [테스트 시트 받기](공유/저장). 배율(%, 0.1 단위)과 가로·세로 오프셋(mm, 0.1 단위)을 입력한다. 안내 문구는 "코닥 앱에서 테두리 없음으로 출력하고, 자르기 편집은 건드리지 마세요". 처음 저장하면 `calibrated = true`.
3. **백업:** [내보내기](`movie-stamps-backup-YYYYMMDD.json`), [가져오기](결과 "N개 추가, M개 건너뜀" / `BackupError`면 "백업 파일을 읽을 수 없어요").

첫 실행(`App` mount): `navigator.storage?.persist?.()`를 호출한다. `installPrompted`가 false이고 `beforeinstallprompt`가 잡히면 "홈 화면에 추가하면 앱처럼 쓸 수 있고 데이터도 안전해요" 배너를 한 번 띄우고, 그 뒤 `installPrompted = true`로 저장한다.

- [ ] **Step 1: 실패하는 테스트** — 보정값을 저장하면 `calibrated: true`가 되고 값이 유지된다 / 잘못된 백업이면 오류 문구가 뜨고 데이터는 그대로다 / 키 검증 실패(`auth`) 문구
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `feat: settings for TMDB key, calibration and backup`

---

### Task 14: PWA와 배포

**Files:**
- Modify: `vite.config.ts` (`VitePWA({ registerType: 'autoUpdate', manifest: { name: '영화 우표 메이커', short_name: '영화우표', display: 'standalone', start_url: '.', icons: [192, 512] } })`, `base: '/<repo-name>/'`)
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `.github/workflows/deploy.yml` (main에 push하면 `npm ci && npm test && npm run build` 후 Pages에 배포)
- Create: `README.md` (실행·배포 방법, 코닥 출력 순서 3줄)

- [ ] **Step 1: `npm run build && npx vite preview --host`** → 폰 Chrome에서 "홈 화면에 추가"가 뜨는지, 오프라인에서도 앱 화면이 열리는지 확인
- [ ] **Step 2: 실제 출력 확인(사용자와 함께)** — 테스트 시트를 공유해 코닥 앱으로 출력하고 펀칭기를 대어 본다. 보정값을 입력하고 실제 우표 시트를 1장 출력해 펀칭한다. 결과(코닥 앱이 공유 목록에 떴는지, 자르기 화면이 떴는지, 보정값)를 README에 기록한다
- [ ] **Step 3: 커밋 후 GitHub 저장소에 push, Pages 활성화** (저장소 생성과 push는 사용자 확인 후)
