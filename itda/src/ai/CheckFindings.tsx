// Claude 점검 결과(사전 점검·업무 상세가 함께 쓴다). 성공한 결과는 업무마다 마지막 1개만 AppState.aiChecks에 저장한다(lib/aiChecks.ts).
// 진행 중·오류 같은 화면 상태는 훅에만 둔다. 취소·실패·엔진 바뀜으로 버려진 결과는 저장하지 않고, 지난 저장 결과도 지우지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Quote, Sparkles } from 'lucide-react';
import { CiteLink, ProvChip } from '../components/ui';
import { cx, fmtDateTime } from '../lib/util';
import type { AiCheckRecord, AppState, Cite } from '../lib/types';
import { canEdit, useStore } from '../lib/store';
import { isAiCheckStale, linkedDocIds, makeAiCheckRecord, saveAiCheck } from '../lib/aiChecks';
import { useAI } from './claude';
import { CHECK_NAMES, claudeCheck, type CheckResult } from './aiCheck';

export interface ClaudeCheckState {
  running: boolean;
  result: CheckResult | null;
  error: string;
  /** 이 업무의 마지막 AI 점검 저장 결과(새로 고침·다른 업무 다녀와도 남음) */
  saved?: AiCheckRecord | null;
  /** 방금 실행한 결과가 저장됐는가(고칠 권한이 없으면 화면에만 보이고 저장·이력은 없다) */
  savedNow?: boolean;
  workId?: string;
}

/** Claude 점검 실행 훅. run()은 결과(실패하면 null)를 돌려준다 — 실패해도 규칙 점검 흐름은 막지 않는다 */
export function useClaudeCheck(s: AppState, workId: string) {
  const ai = useAI();
  const store = useStore();
  const [st, setSt] = useState<ClaudeCheckState>({ running: false, result: null, error: '' });
  const ctl = useRef<AbortController | null>(null);
  // 다른 업무로 바뀌면 예전 결과를 버린다
  useEffect(() => {
    ctl.current?.abort();
    setSt({ running: false, result: null, error: '' });
  }, [workId]);
  // 엔진이 바뀌면(규칙·사내로) 진행 중인 호출을 끊는다. 끊긴 결과는 화면에도 이력에도 쓰이지 않는다(run이 null을 돌려줌) — 오류 문구는 그대로 둔다(M-4)
  useEffect(() => {
    ctl.current?.abort();
    setSt((x) => (x.running ? { ...x, running: false } : x));
  }, [ai.engine]);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = useCallback(async (): Promise<CheckResult | null> => {
    if (!ai.client || ai.engine !== 'claude') return null;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    const ver = s.works.find((x) => x.id === workId)?.version ?? 0;
    setSt({ running: true, result: null, error: '' });
    try {
      const r = await claudeCheck(ai.client, s, workId, c.signal);
      if (c.signal.aborted) return null;
      // 성공해 화면에 쓰이는 결과만 저장한다. 점검한 때의 업무 버전을 함께 남긴다(그 사이 기록이 바뀌면 「오래됨」)
      const rec = makeAiCheckRecord(r, { at: new Date().toISOString(), byId: s.currentUserId, model: ai.model, workVersion: ver, docIds: linkedDocIds(store.raw.docs, workId) });
      // 저장 직전에 고칠 권한을 다시 확인한다(인수자·담당에서 빠진 사람은 저장·이력 없이 화면에만 보여 줌)
      let savedNow = false;
      store.update((d) => {
        savedNow = saveAiCheck(d, workId, rec, store.log, canEdit(d, workId, d.currentUserId));
      });
      setSt({ running: false, result: r, error: '', savedNow });
      return r;
    } catch (e) {
      if (c.signal.aborted) return null;
      console.warn('AI 점검 실패', e);
      setSt({ running: false, result: null, error: ai.onError(e) });
      return null;
    }
  }, [ai, s, workId, store]);
  return { ...st, saved: store.raw.aiChecks?.[workId] ?? null, workId, run, available: ai.engine === 'claude' && !!ai.client };
}

/** 근거 문서 링크. 문서가 지금 없으면(삭제됨) 이동하지 않고 「삭제된 문서」로 보인다 */
function SafeCite({ c }: { c: Cite }) {
  const { raw } = useStore();
  if (!raw.docs.some((d) => d.id === c.docId))
    return (
      <span className="inline-flex items-center rounded border border-line bg-sunken px-1.5 py-px text-2xs text-faint" data-testid="ai-check-cite-gone">
        삭제된 문서
      </span>
    );
  return <CiteLink c={c} />;
}

export function CheckFindings({ state, className }: { state: ClaudeCheckState; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const saved = state.saved ?? null;
  const running = state.running ? (
    <p className="flex items-center gap-1.5 text-[13px] text-muted" data-testid="claude-check-running">
      <Loader2 size={14} className="animate-spin" /> AI가 업무 기록과 연결 문서를 대조하는 중입니다(최대 90초)
    </p>
  ) : null;
  const err = !state.running && state.error ? (
    <p className="text-[13px] text-warn" data-testid="claude-check-error">
      AI 점검을 하지 못했습니다: {state.error} 규칙 점검 결과는 그대로 쓸 수 있습니다.{saved ? ' 아래는 지난 점검 결과입니다.' : ''}
    </p>
  ) : null;
  // 보일 결과: 방금 실행해 받은 결과가 있으면 그것(저장 여부와 무관), 없으면 저장된 마지막 결과(「저장 당시」 문구)
  const fresh = !!state.result;
  const r = state.result ? { findings: state.result.findings, dropped: state.result.dropped } : saved;
  const header = fresh ? (state.savedNow ? saved : null) : saved;
  if (!running && !err && !r) return null;
  return (
    <div className={cx(className, 'space-y-2')}>
      {running}
      {err}
      {r && <FindingList r={r} saved={header} fresh={fresh} workId={state.workId} open={open} setOpen={setOpen} />}
    </div>
  );
}

function FindingList({ r, saved, fresh, workId, open, setOpen }: { r: { findings: AiCheckRecord['findings']; dropped: number }; saved: AiCheckRecord | null; fresh: boolean; workId?: string; open: number | null; setOpen: (n: number | null) => void }) {
  const { raw } = useStore();
  const byName = saved ? raw.users.find((u) => u.id === saved.byId)?.name ?? '지워진 사람' : '';
  const stale = saved && workId ? isAiCheckStale(saved, raw.works.find((w) => w.id === workId), raw.docs) : false;
  const goneSome = !fresh && r.findings.some((f) => f.cite && !raw.docs.some((d) => d.id === f.cite!.docId));
  return (
    <div data-testid="claude-check">
      {saved && (
        <div className="mb-1.5 text-2xs text-muted" data-testid="ai-check-saved">
          마지막 AI 점검 · <span className="tnum" data-testid="ai-check-at">{fmtDateTime(saved.at)}</span> · {byName} · AI · {saved.findings.length}건
          {stale && (
            <span className="ml-2 rounded bg-warnsoft px-1.5 py-px font-medium text-warn" data-testid="ai-check-stale">
              점검 뒤 기록이 바뀜 — 다시 점검 권장
            </span>
          )}
        </div>
      )}
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
        <Sparkles size={14} className="text-infer" /> AI가 찾은 것 <span className="text-2xs font-normal text-muted">{r.findings.length}건 · {fresh ? '원문 인용 대조 통과' : '저장 당시 원문 인용 대조 통과'}
          {goneSome && <span data-testid="ai-check-docs-gone"> · 근거 문서 일부 삭제됨</span>}
        </span>
      </h4>
      {r.findings.length === 0 ? (
        <p className="text-[13px] text-muted">업무 기록과 연결 문서 사이에서 더 찾은 것이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {r.findings.map((f, i) => (
            <li key={i} className="text-[13px]" data-testid="claude-check-item">
              <div className="flex items-start gap-2">
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', f.severity === 'high' ? 'bg-danger' : f.severity === 'mid' ? 'bg-warn' : 'bg-faint')} />
                <span className="min-w-0 flex-1">
                  <span className="mr-1.5 text-2xs font-semibold text-infer">{CHECK_NAMES[f.kind]}</span>
                  <b className="font-medium">{f.title}</b>
                  {f.detail && <span className="text-xs text-muted"> — {f.detail}</span>}
                </span>
                <ProvChip prov="inference" compact />
                <button className="shrink-0 text-muted hover:text-ink" onClick={() => setOpen(open === i ? null : i)} title="근거 원문 보기" aria-expanded={open === i}>
                  <Quote size={13} />
                </button>
              </div>
              {open === i && (
                <div className="ml-4 mt-1 rounded border-l-2 border-infer/40 bg-sunken/60 px-2 py-1 text-xs text-muted">
                  「{f.quote}」
                  <div className="mt-0.5">{f.cite ? <SafeCite c={f.cite} /> : f.recordLine ? <span className="text-2xs text-faint">업무 기록: {f.recordLine}</span> : <span className="text-2xs text-faint" data-testid="ai-check-no-cite">근거 문서 없음</span>}</div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {r.dropped > 0 && <p className="mt-1.5 text-2xs text-faint" data-testid="claude-check-dropped">원문 인용이 확인되지 않아 뺀 항목 {r.dropped}개</p>}
    </div>
  );
}
