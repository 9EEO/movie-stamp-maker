const PNG = 'image/png';

/** 이 브라우저가 PNG 파일 공유(Web Share API)를 지원하는지 */
export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(0)], 'test.png', { type: PNG });
    return navigator.canShare?.({ files: [probe] }) ?? false;
  } catch {
    return false;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `stamps-20261121-1430-1.png` (기기 시간 기준) */
export function sheetFileName(date: Date, sheetNo: number): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `stamps-${day}-${time}-${sheetNo}.png`;
}

/** 공유 시트를 연다. 사용자가 닫으면 'cancelled'. */
export async function shareSheet(blob: Blob, name: string): Promise<'shared' | 'cancelled'> {
  const file = new File([blob], name, { type: PNG });
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}

/** `<a download>`로 내려받는다. */
export function saveSheet(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 일부 안드로이드 Chrome은 클릭 직후 URL을 해제하면 다운로드가 실패한다
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
