import { useRef, useState } from 'preact/hooks';
import { type Calibration, DEFAULT_CALIBRATION } from '../core/calibration';
import { paintTestSheet, renderToBlob } from '../core/sheet';
import { BackupError, exportBackup, importBackup } from '../data/backup';
import { saveSettings } from '../data/db';
import { canShareFiles, saveSheet, shareSheet } from '../platform/output';
import { type Tmdb, TmdbError, createTmdb } from '../tmdb/client';
import { useApp } from './context';
import { OverlayFrame } from './OverlayFrame';

export interface SettingsDeps {
  makeTmdb(key: string): Tmdb;
  renderTestSheet(cal: Calibration): Promise<Blob>;
  canShareFiles(): boolean;
  shareFile(blob: Blob, name: string): Promise<'shared' | 'cancelled'>;
  saveFile(blob: Blob, name: string): void;
}

export const defaultSettingsDeps: SettingsDeps = {
  makeTmdb: (key) => createTmdb(key),
  renderTestSheet: (cal) => renderToBlob((ctx) => paintTestSheet(ctx, cal)),
  canShareFiles,
  shareFile: shareSheet,
  saveFile: saveSheet,
};

const TMDB_API_PAGE = 'https://www.themoviedb.org/settings/api';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}${pad(d.getMinutes())}`;

type Message = { text: string; tone: 'ok' | 'error' } | null;

function Note({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p class={`note ${message.tone}`} role="status">
      {message.text}
    </p>
  );
}

function KeySection({ deps }: { deps: SettingsDeps }) {
  const { settings, reloadSettings } = useApp();
  const [key, setKey] = useState(settings?.tmdbKey ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const save = async (e: Event) => {
    e.preventDefault();
    const trimmed = key.trim();
    setBusy(true);
    setMessage(null);
    try {
      if (!trimmed) {
        await saveSettings({ tmdbKey: undefined });
        setMessage({ text: '키를 지웠어요', tone: 'ok' });
        return;
      }
      try {
        await deps.makeTmdb(trimmed).searchMovies('test');
        await saveSettings({ tmdbKey: trimmed });
        setMessage({ text: '키가 확인됐어요', tone: 'ok' });
      } catch (err) {
        const kind = err instanceof TmdbError ? err.kind : 'http';
        if (kind === 'auth') {
          setMessage({ text: 'TMDB 키가 올바르지 않아요', tone: 'error' });
        } else {
          // 오프라인이거나 TMDB가 잠시 안 될 때는 일단 저장해 둔다
          await saveSettings({ tmdbKey: trimmed });
          setMessage({ text: '인터넷 연결을 확인하지 못했어요. 키는 저장해 두었어요', tone: 'error' });
        }
      }
    } finally {
      await reloadSettings();
      setBusy(false);
    }
  };

  return (
    <section class="settings-section" aria-label="TMDB 키">
      <h3>TMDB 키</h3>
      <p class="muted">
        영화 검색에 필요해요. <a href={TMDB_API_PAGE} target="_blank" rel="noopener noreferrer">TMDB 설정 → API</a>에서
        'API 읽기 액세스 토큰'(또는 API 키)을 복사해 붙여 넣으세요. 키는 이 기기에만 저장돼요.
      </p>
      <form class="field-row" onSubmit={save}>
        <label class="field grow">
          <span>TMDB API 키</span>
          <input
            value={key}
            autocomplete="off"
            spellcheck={false}
            autocapitalize="off"
            onInput={(e) => setKey(e.currentTarget.value)}
          />
        </label>
        <button class="btn primary" type="submit" disabled={busy}>
          키 저장
        </button>
      </form>
      <Note message={message} />
    </section>
  );
}

function CalibrationSection({ deps }: { deps: SettingsDeps }) {
  const { settings, reloadSettings } = useApp();
  const cal = settings?.calibration ?? DEFAULT_CALIBRATION;
  const [form, setForm] = useState({
    scalePct: String(cal.scalePct),
    offsetXMm: String(cal.offsetXMm),
    offsetYMm: String(cal.offsetYMm),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const shareOk = deps.canShareFiles();

  const parse = (): Calibration | string => {
    const scalePct = Number(form.scalePct);
    const offsetXMm = Number(form.offsetXMm);
    const offsetYMm = Number(form.offsetYMm);
    if (![scalePct, offsetXMm, offsetYMm].every(Number.isFinite)) return '숫자를 입력해 주세요';
    if (scalePct < 50 || scalePct > 150) return '배율은 50~150% 사이로 입력해 주세요';
    if (Math.abs(offsetXMm) > 10 || Math.abs(offsetYMm) > 10) return '오프셋은 -10~10mm 사이로 입력해 주세요';
    return { scalePct, offsetXMm, offsetYMm };
  };

  const save = async (e: Event) => {
    e.preventDefault();
    const parsed = parse();
    if (typeof parsed === 'string') {
      setMessage({ text: parsed, tone: 'error' });
      return;
    }
    await saveSettings({ calibration: parsed, calibrated: true });
    await reloadSettings();
    setMessage({ text: '보정값을 저장했어요', tone: 'ok' });
  };

  const testSheet = async (how: 'share' | 'save') => {
    const parsed = parse();
    if (typeof parsed === 'string') {
      setMessage({ text: parsed, tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      const blob = await deps.renderTestSheet(parsed);
      const now = new Date();
      const name = `test-sheet-${ymd(now)}-${hm(now)}.png`;
      if (how === 'share') await deps.shareFile(blob, name);
      else deps.saveFile(blob, name);
    } catch {
      setMessage({ text: '테스트 시트를 만들지 못했어요', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string) => (
    <label class="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        value={form[key]}
        onInput={(e) => setForm({ ...form, [key]: e.currentTarget.value })}
      />
    </label>
  );

  return (
    <section class="settings-section" aria-label="출력 보정">
      <h3>출력 보정</h3>
      <ol class="muted steps">
        <li>테스트 시트를 받아 코닥 앱에서 출력해요.</li>
        <li>코닥 앱에서 테두리 없음으로 출력하고, 자르기 편집은 건드리지 마세요.</li>
        <li>50mm 눈금자를 자로 재고, 펀칭기를 칼선에 대어 어긋난 만큼 아래에 입력해요.</li>
      </ol>
      <p class="muted small">
        예: 눈금자가 49mm로 나오면 배율 102%. 칼선이 오른쪽으로 0.5mm 밀려 있으면 가로 오프셋 -0.5.
      </p>
      <div class="row">
        {shareOk && (
          <button class="btn" disabled={busy} aria-label="테스트 시트 공유" onClick={() => testSheet('share')}>
            테스트 시트 공유
          </button>
        )}
        <button class="btn" disabled={busy} aria-label="테스트 시트 저장" onClick={() => testSheet('save')}>
          테스트 시트 저장
        </button>
      </div>
      <form class="calibration-form" onSubmit={save}>
        {field('scalePct', '배율 (%)')}
        {field('offsetXMm', '가로 오프셋 (mm)')}
        {field('offsetYMm', '세로 오프셋 (mm)')}
        <button class="btn primary" type="submit">
          보정값 저장
        </button>
      </form>
      <Note message={message} />
    </section>
  );
}

function OutputSection() {
  const { settings, reloadSettings } = useApp();
  const current = settings?.preferredOutput ?? 'none';
  const choose = async (v: 'share' | 'save' | 'none') => {
    await saveSettings({ preferredOutput: v === 'none' ? undefined : v });
    await reloadSettings();
  };
  return (
    <section class="settings-section" aria-label="출력 방법">
      <h3>주로 쓰는 출력 방법</h3>
      <div class="segmented" role="group" aria-label="주로 쓰는 출력 방법">
        {(
          [
            ['share', '공유'],
            ['save', '저장'],
            ['none', '정하지 않음'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} aria-pressed={current === v} onClick={() => choose(v)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function BackupSection({ deps }: { deps: SettingsDeps }) {
  const { refresh, reloadSettings } = useApp();
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy(true);
    try {
      deps.saveFile(await exportBackup(), `movie-stamps-backup-${ymd(new Date())}.json`);
      setMessage({ text: '백업 파일을 만들었어요', tone: 'ok' });
    } catch {
      setMessage({ text: '백업 파일을 만들지 못했어요', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const { added, skipped } = await importBackup(file);
      refresh();
      await reloadSettings();
      setMessage({ text: `${added}개 추가, ${skipped}개 건너뜀`, tone: 'ok' });
    } catch (e) {
      setMessage({
        text: e instanceof BackupError ? '백업 파일을 읽을 수 없어요' : '가져오는 중 문제가 생겼어요',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="settings-section" aria-label="백업">
      <h3>백업</h3>
      <p class="muted">
        대기열·만든 우표·올린 사진·보정값을 파일 하나로 저장해요. TMDB 키는 넣지 않아요. 가져오면 지금 데이터에
        합쳐져요.
      </p>
      <div class="row">
        <button class="btn" disabled={busy} onClick={doExport}>
          내보내기
        </button>
        <button class="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          가져오기
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="백업 파일 선택"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) doImport(file);
          }}
        />
      </div>
      <Note message={message} />
    </section>
  );
}

export function Settings({ deps = defaultSettingsDeps }: { deps?: SettingsDeps }) {
  return (
    <OverlayFrame title="설정">
      <div class="settings">
        <KeySection deps={deps} />
        <CalibrationSection deps={deps} />
        <OutputSection />
        <BackupSection deps={deps} />
      </div>
    </OverlayFrame>
  );
}
