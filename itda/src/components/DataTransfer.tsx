import { useMemo, useRef, useState } from 'react';
import { Download, Upload, Copy } from 'lucide-react';
import { useStore, parseBackup } from '../lib/store';
import { Button, Modal } from './ui';
import { cx, localDay } from '../lib/util';
import type { AppState } from '../lib/types';
import { applyMerge, planMerge, previewCounts, type MergeChoices } from '../lib/mergeImport';

/** 데이터 옮기기 — 다른 PC·브라우저·동료와는 저장소가 달라 데이터가 공유되지 않으므로 백업 파일로 이동(바꿔 불러오기·합쳐 불러오기) */
export function DataTransfer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { raw, replace, toast } = useStore();
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<AppState | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [choices, setChoices] = useState<MergeChoices>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLTextAreaElement>(null);
  const json = open && tab === 'export' ? JSON.stringify(raw) : '';

  const close = () => {
    setText('');
    setErr('');
    setPending(null);
    setChoices({});
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
    setChoices({});
    if (!t.trim()) return;
    try {
      setPending(parseBackup(t));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const plan = useMemo(() => (pending && mode === 'merge' ? planMerge(raw, pending) : null), [pending, mode, raw]);
  const counts = plan && pending ? previewCounts(raw, pending, plan, choices) : null;
  const sameOf = (id: string, def: boolean) => choices.people?.[id] ?? def;
  const mergeOf = (id: string, def: boolean) => choices.works?.[id] ?? def;
  const setPerson = (id: string, v: boolean) => setChoices((c) => ({ ...c, people: { ...c.people, [id]: v } }));
  const setWork = (id: string, v: boolean) => setChoices((c) => ({ ...c, works: { ...c.works, [id]: v } }));

  return (
    <Modal open={open} onClose={close} title="데이터 옮기기 (백업 · 불러오기)">
      <p className="mb-3 text-xs leading-relaxed text-muted">
        데이터는 이 PC의 이 브라우저에만 저장됨. 다른 PC·브라우저로 옮기거나 동료와 합칠 때는 '내보내기' 한 백업을 '불러오기'(바꿔 불러오기 또는 합쳐 불러오기). AI 키는 백업에 들어가지 않음.
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
          <div data-testid="merge-mode" className="grid gap-2 sm:grid-cols-2">
            {([
              ['replace', '바꿔 불러오기', '지금 데이터를 바꿈'],
              ['merge', '합쳐 불러오기', '동료 데이터를 더함 — 팀 지도용'],
            ] as const).map(([m, label, sub]) => (
              <label key={m} className={cx('flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-[13px]', mode === m ? 'border-brand bg-sunken' : 'border-line')}>
                <input type="radio" name="dt-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-0.5" />
                <span>
                  <b>{label}</b>
                  <span className="block text-2xs text-muted">({sub})</span>
                </span>
              </label>
            ))}
          </div>
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
          {pending && mode === 'replace' && (
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
          {pending && mode === 'merge' && plan && counts && (
            <div data-testid="merge-preview" className="space-y-3 rounded-md border border-brand/40 bg-sunken p-3 text-[13px]">
              <p className="text-xs text-muted">지금 데이터는 그대로 두고, 불러온 데이터를 더함. 같은 사람·같은 업무로 보이는 것은 아래에서 고를 수 있음</p>
              <div>
                <p className="mb-1 font-medium">사람 맞춤 ({plan.people.length}명)</p>
                <ul className="space-y-1">
                  {plan.people.map((p) => (
                    <li key={p.incomingId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="min-w-0 flex-1 truncate">
                        {p.name} <span className="text-faint">({p.dept})</span>
                      </span>
                      {p.status === 'new' ? (
                        <span className="text-muted">새 사람</span>
                      ) : (
                        <select
                          aria-label={`${p.name} 사람 맞춤`}
                          data-testid={`merge-person-${p.incomingId}`}
                          value={sameOf(p.incomingId, p.status === 'same') ? 'same' : 'other'}
                          onChange={(e) => setPerson(p.incomingId, e.target.value === 'same')}
                          className="rounded border border-line2 bg-surface px-1.5 py-1"
                        >
                          <option value="same">{p.status === 'same' ? `같은 사람 (사번 일치: ${p.currentName})` : `같은 사람 (${p.currentName})`}</option>
                          <option value="other">다른 사람</option>
                        </select>
                      )}
                      {p.status === 'candidate' && <span className="rounded bg-warnsoft px-1.5 py-0.5 text-2xs text-warn">확인 필요 · 사번 없음, 이름·부서만 같음</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium">업무 맞춤 ({plan.works.length}건)</p>
                <ul className="space-y-1">
                  {plan.works.map((w) => (
                    <li key={w.incomingId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="min-w-0 flex-1 truncate">{w.name}</span>
                      {w.status === 'candidate' && (
                        <span className="w-full rounded bg-warnsoft px-1.5 py-0.5 text-2xs text-warn" data-testid={`merge-work-reason-${w.incomingId}`}>
                          비슷한 업무 후보 · 점수 {w.score} — {w.reason}. 같은 업무인지 확인 후 고르세요
                        </span>
                      )}
                      {w.currentId ? (
                        <select
                          aria-label={`${w.name} 업무 맞춤`}
                          data-testid={`merge-work-${w.incomingId}`}
                          value={mergeOf(w.incomingId, w.status === 'same') ? 'merge' : 'separate'}
                          onChange={(e) => setWork(w.incomingId, e.target.value === 'merge')}
                          className="rounded border border-line2 bg-surface px-1.5 py-1"
                        >
                          <option value="merge">합치기 (지금 업무: {w.currentName})</option>
                          <option value="separate">따로 두기</option>
                        </select>
                      ) : (
                        <span className="text-muted">새 업무</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="rounded bg-surface px-2 py-1.5 text-xs">
                추가될 내용: 사람 <b>{counts.users}</b>명 · 업무 <b>{counts.works}</b>건 (합침 {counts.worksMerged}건) · 문서 <b>{counts.docs}</b>건 · 결정 <b>{counts.decisions}</b>건 · 조치 <b>{counts.actions}</b>건 · 인계 <b>{counts.handovers}</b>건{counts.orgs > 0 && <> · 조직 <b>{counts.orgs}</b>개 추가</>}
              </p>
              <p className="text-2xs text-faint">같은 업무로 합칠 때 지금 업무의 내용이 우선이고, 비어 있는 항목만 채움. 같은 제목·작성일 문서와 같은 결정·조치는 한 번만 들어감 (필요하면 먼저 '내보내기'로 백업)</p>
              <div className="flex gap-2">
                <Button
                  data-testid="merge-confirm"
                  onClick={() => {
                    const r = applyMerge(raw, pending, choices);
                    replace(r.state);
                    toast(`합쳐 불러왔습니다 — ${r.summary}`);
                    close();
                  }}
                >
                  합쳐 불러오기
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
