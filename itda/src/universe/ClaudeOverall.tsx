// Claude 「전체 인사이트」(키가 있을 때) — 인사이트 판의 「Claude로 더 찾기」 옆. 범위 전체를 관통하는 것 3~5가지를 카드로.
// 결과는 이 화면 메모리에만 둔다(업무 데이터·내보내기에 넣지 않음). 근거 인용은 앱이 업무 기록과 대조한 것만 남는다(ai/aiOverall.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { cx } from '../lib/util';
import type { AppState } from '../lib/types';
import { useAI } from '../ai/claude';
import { buildInsightInput } from '../ai/aiInsight';
import { claudeOverall, type OverallFinding, type OverallResult } from '../ai/aiOverall';
import type { MapScope } from './derive';
import { evidenceGids, type Insight } from './insights';

export function fingerprint(t: string) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i += 1) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return `${t.length}:${(h >>> 0).toString(36)}`;
}

// 범위 → 마지막 결과(이 탭 메모리). fp: 보낸 입력의 지문 — 기록이 바뀌었는지 가린다
const cache = new Map<string, { fp: string; result: OverallResult }>();

export type OverallState = ReturnType<typeof useClaudeOverall>;

export function useClaudeOverall(s: AppState, scope: MapScope, asOf: string) {
  const ai = useAI();
  const available = ai.engine === 'claude' && !!ai.client;
  const scopeKey = `${JSON.stringify(scope)}|${ai.model}`;
  const fp = useMemo(() => (available ? fingerprint(buildInsightInput(s, scope, asOf).user) : ''), [available, s, scope, asOf]);
  const [st, setSt] = useState<{ running: boolean; error: string; tick: number }>({ running: false, error: '', tick: 0 });
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    ctl.current?.abort();
    setSt((x) => ({ running: false, error: '', tick: x.tick + 1 }));
  }, [scopeKey]);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = useCallback(async () => {
    if (!ai.client || !available) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setSt((x) => ({ ...x, running: true, error: '' }));
    try {
      const r = await claudeOverall(ai.client, s, scope, asOf, c.signal);
      if (c.signal.aborted) return;
      cache.set(scopeKey, { fp, result: r });
      setSt((x) => ({ running: false, error: '', tick: x.tick + 1 }));
    } catch (e) {
      if (c.signal.aborted) return;
      console.warn('AI 전체 인사이트 실패', e);
      setSt((x) => ({ ...x, running: false, error: ai.onError(e) }));
    }
  }, [ai, available, s, scope, asOf, scopeKey, fp]);
  const cancel = () => {
    ctl.current?.abort();
    setSt((x) => ({ ...x, running: false }));
  };
  const hit = cache.get(scopeKey);
  return { running: st.running, error: st.error, result: hit?.result ?? null, stale: !!hit && hit.fp !== fp, run, cancel };
}

export function OverallButton({ o }: { o: OverallState }) {
  if (o.running) return null;
  return (
    <button
      className="inline-flex items-center gap-1 rounded border border-infer/30 bg-surface px-2 py-0.5 text-[12px] font-medium text-infer hover:bg-infersoft"
      onClick={() => void o.run()}
      title="이 범위의 업무 기록 전체를 AI(지금: Claude)에 보내, 팀 전체를 관통하는 것(공통 병목·같은 외부기관 의존·되풀이되는 결정 번복 등)을 찾습니다(「나만 보기」 메모는 보내지 않음)"
      data-testid="claude-overall-run"
    >
      <Layers size={12} /> {o.result ? (o.stale ? '바뀐 기록으로 전체 인사이트 다시' : '전체 인사이트 다시') : 'AI로 전체 인사이트'}
    </button>
  );
}

export function OverallResults({ o, data, scope, focusId, onFocus }: { o: OverallState; data: AppState; scope: MapScope; focusId: string | null; onFocus: (x: Insight | null) => void }) {
  const workName = (id: string) => data.works.find((w) => w.id === id)?.name ?? id;
  const focusOf = (id: string, title: string, f: OverallFinding, workIds: string[]): Insight => ({ id, kind: 'claude', level: 'mid', title, detail: f.insight, workIds, userIds: [], evidence: evidenceGids(data, scope, workIds, []) });
  const r = o.result;
  return (
    <>
      {o.running && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted" data-testid="claude-overall-running">
          <Loader2 size={14} className="animate-spin" /> 업무 기록 전체를 읽고 있습니다(최대 120초)
          <button className="ml-auto text-2xs text-brand" onClick={o.cancel}>취소</button>
        </p>
      )}
      {o.error && <p className="mt-1.5 text-[12.5px] text-warn" data-testid="claude-overall-error">Claude 전체 인사이트를 찾지 못했습니다: {o.error}</p>}
      {r && (
        <div className="mt-2" data-testid="claude-overall">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-[12.5px] font-bold">팀 전체 인사이트 {r.items.length}가지</h5>
            <span className="rounded bg-infersoft px-1.5 text-2xs font-semibold text-infer" data-testid="claude-overall-engine">Claude</span>
          </div>
          {o.stale && <p className="mt-1 text-2xs text-warn">찾은 뒤 기록이 바뀌었습니다. 아래는 이전 기록 기준입니다.</p>}
          {r.items.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-muted">기록에서 확인되는, 여러 업무를 가로지르는 인사이트를 찾지 못했습니다.</p>
          ) : (
            <ul className="mt-1.5 space-y-2">
              {r.items.map((f, i) => {
                const id = `claude-overall:${i}`;
                return (
                  <li key={id} className={cx('rounded-md border border-line bg-surface p-2.5', focusId === id && 'bg-brandsoft ring-1 ring-brand/30')} data-testid="claude-overall-item">
                    <button className="block w-full text-left" onClick={() => onFocus(focusId === id ? null : focusOf(id, f.title, f, f.workIds))} aria-pressed={focusId === id} title="누르면 지도에서 근거 업무가 강조됩니다">
                      <span className="block text-[13px] font-bold leading-snug">{f.title}</span>
                      <span className="mt-1 block text-[12.5px] leading-snug">{f.insight}</span>
                    </button>
                    {f.why && <p className="mt-1.5 text-2xs leading-snug text-muted"><b className="text-ink">왜 중요한가</b> {f.why}</p>}
                    {f.suggestion && <p className="mt-1 text-2xs leading-snug text-muted"><b className="text-ink">다음 한 걸음</b> {f.suggestion}</p>}
                    <ul className="mt-1.5 space-y-1">
                      {f.evidence.map((e) => {
                        const eid = `${id}:${e.workId}#${e.lineNo}`;
                        return (
                          <li key={eid} className="flex items-start gap-1.5 text-2xs text-muted">
                            <button
                              className={cx('shrink-0 rounded-full border px-1.5 py-px font-medium', focusId === eid ? 'border-brand bg-brand text-onbrand' : 'border-line hover:bg-sunken')}
                              onClick={() => onFocus(focusId === eid ? null : focusOf(eid, workName(e.workId), f, [e.workId]))}
                              aria-pressed={focusId === eid}
                              title="누르면 지도에서 이 업무가 강조됩니다"
                              data-testid="claude-overall-evidence"
                            >
                              {workName(e.workId)}
                            </button>
                            <span className="min-w-0">「{e.quote}」 <span className="text-faint">기록 {e.lineNo}번째 줄</span></span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
          {r.dropped > 0 && <p className="mt-1 text-2xs text-faint" data-testid="claude-overall-dropped">근거가 업무 기록에서 확인되지 않거나 한 업무뿐이라 뺀 항목 {r.dropped}개</p>}
          {r.truncated > 0 && <p className="mt-1 text-2xs text-faint">업무가 많아 최근 갱신순으로 일부만 보냈습니다(빠진 업무 {r.truncated}개).</p>}
          <p className="mt-1 text-2xs text-faint">AI(Claude)가 쓴 해석입니다. 근거 인용이 실제 업무 기록에 있는지, 서로 다른 업무 둘 이상에 걸치는지는 앱이 확인했습니다. 결과는 이 탭에만 있고 저장·내보내기에 들어가지 않습니다.</p>
        </div>
      )}
    </>
  );
}
