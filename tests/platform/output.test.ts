import { canShareFiles, saveSheet, shareSheet, sheetFileName } from '../../src/platform/output';

function setNavigator(name: 'share' | 'canShare', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  setNavigator('share', undefined);
  setNavigator('canShare', undefined);
  vi.restoreAllMocks();
});

const png = () => new Blob(['png'], { type: 'image/png' });

test('sheetFileName uses local date, time and sheet number', () => {
  expect(sheetFileName(new Date(2026, 10, 21, 14, 30), 1)).toBe('stamps-20261121-1430-1.png');
  expect(sheetFileName(new Date(2026, 0, 5, 9, 7), 12)).toBe('stamps-20260105-0907-12.png');
});

test('canShareFiles is false without navigator.canShare', () => {
  expect(canShareFiles()).toBe(false);
});

test('canShareFiles asks canShare with a png file', () => {
  const canShare = vi.fn(() => true);
  setNavigator('canShare', canShare);
  expect(canShareFiles()).toBe(true);
  const arg = canShare.mock.calls[0] as unknown as [ShareData];
  expect(arg[0].files?.[0].type).toBe('image/png');
});

test('canShareFiles is false when canShare throws', () => {
  setNavigator('canShare', () => {
    throw new TypeError('nope');
  });
  expect(canShareFiles()).toBe(false);
});

test('shareSheet shares a named png file', async () => {
  const share = vi.fn(async () => {});
  setNavigator('share', share);
  expect(await shareSheet(png(), 'stamps-1.png')).toBe('shared');
  const [data] = share.mock.calls[0] as unknown as [ShareData];
  expect(data.files?.[0].name).toBe('stamps-1.png');
  expect(data.files?.[0].type).toBe('image/png');
});

test('shareSheet returns cancelled when the user aborts', async () => {
  setNavigator('share', async () => {
    throw new DOMException('Share canceled', 'AbortError');
  });
  expect(await shareSheet(png(), 'a.png')).toBe('cancelled');
});

test('shareSheet rethrows other errors', async () => {
  setNavigator('share', async () => {
    throw new DOMException('Not allowed', 'NotAllowedError');
  });
  await expect(shareSheet(png(), 'a.png')).rejects.toMatchObject({ name: 'NotAllowedError' });
});

test('saveSheet downloads through an anchor with the file name', () => {
  const createObjectURL = vi.fn(() => 'blob:fake');
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this);
  });
  saveSheet(png(), 'stamps-20261121-1430-1.png');
  expect(clicked).toHaveLength(1);
  expect(clicked[0].download).toBe('stamps-20261121-1430-1.png');
  expect(clicked[0].href).toBe('blob:fake');
});
