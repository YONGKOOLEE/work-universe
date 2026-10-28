import { useRef, useState } from 'react';
import { Download, Upload, Copy } from 'lucide-react';
import { useStore, parseBackup } from '../lib/store';
import { Button, Modal } from './ui';
import { cx, localDay } from '../lib/util';
import type { AppState } from '../lib/types';

/** 데이터 옮기기 — 게시 페이지와 내려받은 HTML 파일은 브라우저 저장소가 달라 데이터가 공유되지 않으므로 백업 파일로 이동 */
export function DataTransfer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { raw, replace, toast } = useStore();
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<AppState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLTextAreaElement>(null);
  const json = open && tab === 'export' ? JSON.stringify(raw) : '';

  const close = () => {
    setText('');
    setErr('');
    setPending(null);
    onClose();
  };
  const save = () => {
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `업무잇다_백업_${localDay(new Date().toISOString())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('백업 파일 저장을 요청했습니다');
    } catch {
      toast('파일 저장이 막힌 환경입니다. 복사 기능을 사용하세요');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast('데이터를 복사했습니다');
    } catch {
      outRef.current?.select();
      const ok = document.execCommand?.('copy');
      toast(ok ? '데이터를 복사했습니다' : '복사가 막힌 환경입니다. 내용을 직접 선택해 복사하세요');
    }
  };
  const check = (t: string) => {
    setErr('');
    setPending(null);
    if (!t.trim()) return;
    try {
      setPending(parseBackup(t));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Modal open={open} onClose={close} title="데이터 옮기기 (백업 · 불러오기)">
      <p className="mb-3 text-xs leading-relaxed text-muted">
        claude.ai 게시 페이지와 내려받은 HTML 파일은 데이터가 서로 따로 저장됨. 한쪽에서 '내보내기' 한 백업을 다른 쪽에서 '불러오기' 하면 등록한 업무·문서·인계 내용이 그대로 옮겨짐.
      </p>
      <div className="mb-3 flex gap-1 rounded-md bg-sunken p-1 text-[13px]">
        {(['export', 'import'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('flex-1 rounded px-3 py-1.5 font-medium', tab === t ? 'bg-surface text-ink shadow-card' : 'text-muted')}>
            {t === 'export' ? '내보내기' : '불러오기'}
          </button>
        ))}
      </div>
      {tab === 'export' ? (
        <div className="space-y-3">
          <p className="text-[13px]">
            업무 <b>{raw.works.length}</b>건 · 문서 <b>{raw.docs.length}</b>건 · 타임라인 이벤트 <b>{raw.events.length}</b>건 · 인계 <b>{raw.handovers.length}</b>건
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save}>
              <Download size={14} /> 백업 파일 저장
            </Button>
            <Button variant="ghost" onClick={copy}>
              <Copy size={14} /> 내용 복사
            </Button>
          </div>
          <textarea ref={outRef} readOnly value={json} className="h-28 w-full rounded-md border border-line bg-sunken p-2 font-mono text-2xs text-muted" aria-label="백업 데이터" />
          <p className="text-2xs text-faint">파일 저장이 안 되면 '내용 복사' 후 메모장에 붙여 .json으로 저장하거나, 다른 쪽 '불러오기'에 바로 붙여넣기</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> 백업 파일 선택
            </Button>
            <span className="text-2xs text-faint">또는 아래에 백업 내용 붙여넣기</span>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const t = await f.text();
                setText(t);
                check(t);
              }}
            />
          </div>
          <textarea
            id="dt-paste"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              check(e.target.value);
            }}
            placeholder="백업 내용을 붙여넣으세요"
            className="h-28 w-full rounded-md border border-line bg-surface p-2 font-mono text-2xs"
          />
          {err && <p className="text-xs font-medium text-danger">{err}</p>}
          {pending && (
            <div className="rounded-md border border-warn/40 bg-warnsoft p-3 text-[13px]">
              <p>
                불러올 데이터: 업무 <b>{pending.works.length}</b>건 · 문서 <b>{pending.docs.length}</b>건 · 인계 <b>{pending.handovers.length}</b>건
              </p>
              <p className="mt-1 truncate text-2xs text-muted">{pending.works.map((w) => w.name).join(', ')}</p>
              <p className="mt-2 text-xs text-warn">지금 이 화면의 데이터는 불러온 데이터로 바뀜 (필요하면 먼저 '내보내기'로 백업)</p>
              <div className="mt-2 flex gap-2">
                <Button
                  onClick={() => {
                    replace(pending);
                    toast('데이터를 불러왔습니다');
                    close();
                  }}
                >
                  불러오기
                </Button>
                <Button variant="ghost" onClick={() => setPending(null)}>
                  취소
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
