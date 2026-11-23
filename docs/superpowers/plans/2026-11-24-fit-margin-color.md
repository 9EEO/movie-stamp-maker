# 전체 보이기 여백 색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전체 보이기 우표의 여백을 우표마다 정한 색으로 칠하고, 조정 화면에서 추천 색·스포이드·직접 고르기로 그 색을 정한다.

**Architecture:** `Crop`에 선택 항목 `bg`를 더하고, 여백을 칠하는 세 곳(시트, 조정 미리보기, 썸네일)이 `crop.bg ?? '#ffffff'`를 쓴다. 추천 색과 스포이드는 원본을 작게 줄인 픽셀 배열에서 순수 함수(`src/core/palette.ts`)로 계산한다. 픽셀을 읽는 부분은 CropEditor에 주입할 수 있게 해서 테스트에서 가짜 픽셀을 넣는다.

**Tech Stack:** Vite 5, TypeScript, Preact, Vitest + jsdom + @testing-library/preact (기존 그대로, 새 의존성 없음)

**Spec:** `docs/superpowers/specs/2026-11-24-fit-margin-color-design.md`

## Global Constraints

- 색 값 형식은 `#rrggbb`(소문자 hex 6자리). 값이 없으면 흰색 `#ffffff`.
- 기존 우표·기존 백업(`bg` 없음)은 출력 모습이 바뀌지 않는다.
- 이미 전체 보이기로 저장된 우표를 열어도 `bg`를 자동으로 넣지 않는다. 자동으로 넣는 것은 `bg`가 없을 때 전체 보이기 버튼을 누른 순간뿐이다.
- 안드로이드 Chrome이 주 환경. EyeDropper API는 쓰지 않는다.
- 화면 문구는 한국어, 기존 말투(…해요)를 따른다.

## Review Focus

1. 픽셀을 못 읽는 경우(`samplePixels`가 `null`) — 여백 줄에 [흰색]과 [🎨 직접]만 보이고, 전체 보이기로 바꿔도 `bg`는 비어 있다(흰색). 오류가 나지 않는다. → Task 3 테스트
2. 거의 한 가지 색인 포스터 — 추천 색이 3개보다 적게 나오면 그만큼만 칩을 보인다. → Task 1 테스트
3. 스포이드로 포스터 바깥(여백)을 탭 — 아무 색도 넣지 않고 스포이드 상태를 유지한다. → Task 3 테스트
4. 모드를 오갈 때 — 꽉 채우기로 갔다가 돌아와도 고른 `bg`가 남는다. → Task 3 테스트
5. 백업 — `bg`가 형식에 맞지 않으면 가져오기 전체를 거부하고, `bg`가 없는 예전 백업은 그대로 받는다. → Task 2 테스트

---

### Task 1: 색 계산 (palette)과 탭 위치 → 이미지 좌표

**Files:**
- Create: `src/core/palette.ts`
- Modify: `src/core/crop.ts` (`Crop`에 `bg?: string`, `imagePointAt` 추가)
- Test: `tests/core/palette.test.ts`, `tests/core/crop.test.ts`

**Interfaces:**
- Produces:
  - `interface Pixels { data: Uint8ClampedArray; width: number; height: number }` (RGBA, `ImageData`와 같은 모양)
  - `marginSides(imgW: number, imgH: number): 'left-right' | 'top-bottom'` — 이미지 가로세로비가 우표(`STAMP_W_MM / STAMP_H_MM`)보다 작으면(세로로 길면) `'left-right'`
  - `edgeColor(px: Pixels, sides: 'left-right' | 'top-bottom'): string`
  - `dominantColors(px: Pixels, count: number, avoid: string[]): string[]`
  - `colorAt(px: Pixels, u: number, v: number): string` — u, v는 0~1
  - `Crop.bg?: string`
  - `imagePointAt(imgW: number, imgH: number, crop: Crop, xMm: number, yMm: number): { u: number; v: number } | null` — `placeImage` 사각형 기준 정규화 좌표, 사각형 밖이면 `null`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/core/palette.test.ts`에 픽셀 배열을 만드는 도우미(`solid(w, h, rgb)`, 영역별로 칠하는 `paint(px, x0, y0, x1, y1, rgb)`)를 두고:

```ts
test('marginSides: tall poster gets left-right margins', () => {
  expect(marginSides(780, 1170)).toBe('left-right');
  expect(marginSides(1170, 780)).toBe('top-bottom');
});
test('edgeColor averages the outer columns on both sides', () => {
  // 100x100, 왼쪽 3열 #ff0000, 오른쪽 3열 #0000ff, 가운데 #00ff00
  expect(edgeColor(px, 'left-right')).toBe('#800080'); // (255+0)/2 → 128 반올림
});
test('edgeColor top-bottom uses the outer rows', () => { /* 위 3행 #000000, 아래 3행 #ffffff → '#808080' */ });
test('dominantColors returns most used colors first, skipping near and avoided ones', () => {
  // 60% #102030, 30% #e0c040, 10% #f0c040(앞 색과 거리 16, 다른 칸)
  expect(dominantColors(px, 3, [])).toEqual(['#102030', '#e0c040']);
  expect(dominantColors(px, 3, ['#112131'])).toEqual(['#e0c040']);
});
test('dominantColors on a single-color image returns one color', () => {
  expect(dominantColors(solid(10, 10, [5, 5, 5]), 3, [])).toEqual(['#050505']);
});
test('colorAt reads the pixel under a normalized point', () => {
  expect(colorAt(px, 0.99, 0.5)).toBe('#0000ff');
});
```

`tests/core/crop.test.ts`에:

```ts
test('imagePointAt maps a stamp point to image coords and rejects points outside', () => {
  const crop: Crop = { mode: 'fit', cx: 0.5, cy: 0.5, zoom: 1 };
  expect(imagePointAt(780, 1170, crop, STAMP_W_MM / 2, STAMP_H_MM / 2)).toEqual({ u: 0.5, v: 0.5 });
  expect(imagePointAt(780, 1170, crop, 0.5, STAMP_H_MM / 2)).toBeNull(); // 좌우 여백
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx vitest run tests/core/palette.test.ts tests/core/crop.test.ts`
Expected: FAIL — `palette` 모듈 없음, `imagePointAt` 없음

- [ ] **Step 3: 구현**

- `edgeColor`: 바깥쪽 `max(1, round(0.03 × 폭 또는 높이))` 줄을 양쪽에서 모아 RGB 평균, 반올림.
- `dominantColors`: 채널마다 위 4비트로 묶어 4096칸에 개수와 RGB 합을 모은다. 개수 순으로 정렬하고, 각 칸의 평균색을 낸다. 이미 고른 색이나 `avoid`의 색과 RGB 유클리드 거리 48 미만이면 건너뛰며 `count`개까지 고른다. 알파 128 미만 픽셀은 무시한다.
- `colorAt`: `x = min(width-1, floor(u × width))`, y도 같은 방식.
- hex 변환 도우미(`toHex(r,g,b)`, `parseHex(hex)`)는 같은 파일에 두고 export한다.
- `imagePointAt`: `placeImage` 결과 `r`에서 `u = (xMm - r.xMm) / r.wMm`, v도 같은 방식. 둘 중 하나라도 [0, 1] 밖이면 `null`.

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npx vitest run tests/core/palette.test.ts tests/core/crop.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/core/palette.ts src/core/crop.ts tests/core/palette.test.ts tests/core/crop.test.ts
git commit -m "feat: margin color suggestions and image point lookup"
```

### Task 2: 여백을 `bg`로 칠하기 (시트, 썸네일, 백업)

**Files:**
- Modify: `src/core/sheet.ts` (`paintSheet`의 슬롯 여백 `fillStyle`)
- Modify: `src/ui/StampThumb.tsx` (`stamp-face`에 배경색 style)
- Modify: `src/data/backup.ts` (`isStamp`의 crop 검사)
- Modify: `tests/helpers/fakeCtx.ts` (`fillRect` 기록에 그때의 `fillStyle`을 `style`로 남김: `Call`에 `style?: string`)
- Test: `tests/core/sheet.test.ts`, `tests/ui/stampThumb.test.tsx`, `tests/data/backup.test.ts`

**Interfaces:**
- Consumes: `Crop.bg` (Task 1)
- Produces: 없음 (기존 함수 동작만 바뀜)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// sheet.test.ts
test('paintSheet fills a slot bleed with crop.bg, white when absent', () => {
  // entries: [{crop: {...fit, bg: '#123456'}}, {crop: DEFAULT_CROP}]
  // 슬롯 transform 아래의 fillRect 두 번: style '#123456', '#ffffff'
});
// stampThumb.test.tsx
test('stamp face uses crop.bg as its background', () => {
  // <StampThumb src="x" crop={{...fit, bg: '#123456'}} alt="a" />
  // container.querySelector('.stamp-face').style.backgroundColor === 'rgb(18, 52, 86)'
});
// backup.test.ts
test('import keeps a valid crop.bg and rejects a malformed one', async () => {
  // bg '#a1b2c3' → 가져온 우표의 crop.bg 그대로
  // bg 'red' → BackupError, 데이터 변화 없음
});
```

(`bg` 없는 예전 백업은 기존 round-trip 테스트가 이미 다룬다.)

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx vitest run tests/core/sheet.test.ts tests/ui/stampThumb.test.tsx tests/data/backup.test.ts`
Expected: FAIL — 슬롯 여백이 `#fff`, 썸네일 배경 없음, `'red'`가 거부되지 않음

- [ ] **Step 3: 구현**

- `paintSheet`: 여백 `fillStyle = entry.crop.bg ?? '#ffffff'`. 주석도 맞게 고친다.
- `StampThumb`: `crop?.bg`가 있으면 `.stamp-face`에 `style={{ background: crop.bg }}`.
- `isStamp`: `isOptional(crop.bg, (b) => isStr(b) && /^#[0-9a-f]{6}$/i.test(b))`.

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npx vitest run tests/core/sheet.test.ts tests/ui/stampThumb.test.tsx tests/data/backup.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/core/sheet.ts src/ui/StampThumb.tsx src/data/backup.ts tests/helpers/fakeCtx.ts tests/core/sheet.test.ts tests/ui/stampThumb.test.tsx tests/data/backup.test.ts
git commit -m "feat: paint fit-mode margins with the stamp's color"
```

### Task 3: 조정 화면의 여백 줄

**Files:**
- Modify: `src/platform/image.ts` (`samplePixels` 추가)
- Modify: `src/ui/CropEditor.tsx`
- Modify: `src/ui/styles.css` (여백 줄과 칩)
- Test: `tests/ui/cropEditor.test.tsx`

**Interfaces:**
- Consumes: `Pixels`, `marginSides`, `edgeColor`, `dominantColors`, `colorAt` (Task 1), `imagePointAt`, `Crop.bg` (Task 1)
- Produces:
  - `samplePixels(img: ImageLike, maxEdge: number): Pixels | null` (`src/platform/image.ts`) — 긴 변이 `maxEdge`가 되게 캔버스에 줄여 그리고 `getImageData`. 실패(컨텍스트 없음, 보안 오류)하면 `null`.
  - CropEditor props에 `samplePixels?: (img: ImageLike) => Pixels | null` (기본: `(img) => samplePixels(img, 160)`)

- [ ] **Step 1: 실패하는 테스트 작성**

`setup`에 `pixels` 옵션을 더해 `samplePixels`로 넘긴다(기본: 왼쪽 3%·오른쪽 3% `#336699`, 나머지는 위 절반 `#202020`·아래 절반 `#c08040`인 100×150 배열). 여백 줄은 `role="group"`, `aria-label="여백 색"`. 칩 이름: `흰색`, `가장자리 색`, `포스터 색 1`…, `스포이드`, `직접 고르기`(`input[type=color]`의 aria-label).

```ts
test('margin row appears only in fit mode', async () => {
  // 처음(fill): queryByRole('group', {name: '여백 색'}) === null
  // '전체 보이기' 클릭 → group 보임
});
test('switching to fit for the first time picks the edge color', async () => {
  // '전체 보이기' 클릭 → '가장자리 색' aria-pressed=true → 완료 → crop.bg === '#336699'
});
test('an existing fit stamp without bg stays white', async () => {
  // crop: {mode:'fit', ...} 로 setup → 완료 → crop.bg undefined, '흰색' aria-pressed=true
});
test('poster color chips set bg and white clears it', async () => {
  // '포스터 색 1' 클릭 → 완료 → bg === '#202020' 또는 '#c08040' 중 많은 쪽
  // 다시 열어 '흰색' 클릭 → 완료 → bg === '#ffffff'
});
test('bg survives switching to fill and back', async () => {
  // fit → '포스터 색 1' → '꽉 채우기' → '전체 보이기' → 완료 → bg는 포스터 색 1
});
test('custom color input sets bg', async () => {
  // fireEvent.input(getByLabelText('직접 고르기'), {target: {value: '#abcdef'}}) → 완료 → '#abcdef'
});
test('eyedropper picks the color under a tap and ignores taps on the margin', async () => {
  // 스테이지 getBoundingClientRect를 {left:0, top:0, width:400, height:600}로 고정(vi.spyOn)
  // '스포이드' 클릭 → '포스터를 눌러 색을 고르세요' 보임
  // 여백 쪽(칼선 왼쪽 끝 근처) pointerDown → 문구 그대로, bg 그대로
  // 포스터 아래쪽 가운데 pointerDown → 문구 사라짐 → 완료 → bg === '#c08040'
  // 스포이드 중 pointerDown/Move는 위치를 바꾸지 않는다(cx, cy 그대로)
});
test('without readable pixels only white and custom are offered', async () => {
  // samplePixels: () => null → 전체 보이기 → '가장자리 색'·'포스터 색 1'·'스포이드' 없음, '흰색'·'직접 고르기' 있음 → 완료 → bg undefined
});
```

탭 좌표는 테스트 안에서 `frameLayout`과 같은 계산(폭 400·높이 600 기준)으로 구하거나, `frameLayout`을 export해서 쓴다.

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npx vitest run tests/ui/cropEditor.test.tsx`
Expected: FAIL — 여백 줄 없음

- [ ] **Step 3: 구현**

- 이미지를 불러오면 `samplePixels(img)`로 한 번 읽어 `pixels`에 둔다. `pixels`가 있으면 추천 색을 계산한다: `edge = edgeColor(pixels, marginSides(img.width, img.height))`, `palette = dominantColors(pixels, 3, ['#ffffff', edge])`.
- `setMode(mode)`: 위치만 초기화하고 `bg`는 유지한다. `mode === 'fit'`이고 `bg`가 없고 `edge`가 있으면 `bg = edge`.
- `draw`의 여백 `fillStyle`은 `crop.bg ?? '#ffffff'`.
- 여백 줄(`crop.mode === 'fit'`일 때만): 색 동그라미 버튼들(`aria-pressed`는 `crop.bg ?? '#ffffff'`와 같은지), 스포이드 토글, `<input type="color" aria-label="직접 고르기">`(값은 현재 색, `onInput`으로 반영).
- 스포이드 상태 `picking`: 켜져 있으면 스테이지 `onPointerDown`에서 위치 이동을 시작하지 않고, 스테이지 좌표를 `frameLayout`으로 mm로 바꾼 뒤 `imagePointAt` → `colorAt(pixels, u, v)`. `null`이면 그대로 두고, 색을 넣었으면 `picking`을 끈다. 스포이드 중에는 스테이지 위에 `<p class="crop-status">포스터를 눌러 색을 고르세요</p>`.
- 스타일: 칩은 지름 32px 원, 고른 칩은 강조 테두리(`var(--accent)`). 줄은 가로 스크롤 가능하게.

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npx vitest run tests/ui/cropEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: 전체 테스트와 빌드**

Run: `npm test && npm run build`
Expected: 모든 테스트 통과, 빌드 성공

- [ ] **Step 6: 커밋**

```bash
git add src/platform/image.ts src/ui/CropEditor.tsx src/ui/styles.css tests/ui/cropEditor.test.tsx
git commit -m "feat: choose fit-mode margin color in the crop editor"
```
