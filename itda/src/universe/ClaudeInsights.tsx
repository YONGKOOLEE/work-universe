// Claude 인사이트(키가 있을 때) — 지도 오른쪽 인사이트 판 아래. 결과는 이 화면 메모리에만 둔다(업무 데이터·내보내기에 넣지 않음).
// 같은 범위·같은 기록이면 다시 부르지 않고 받아 둔 결과를 보여 준다. 기록이 바뀌면 받아 둔 결과에 「기록이 바뀜」을 표시하고 다시 찾기를 권한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Quote, Sparkles } from 'lucide-react';
import { cx } from '../lib/util';
import type { AppState } from '../lib/types';
import { useAI } from '../ai/claude';
import { insightCacheKey } from '../ai/llm';
import { useStore } from '../lib/store';
import { AI_INSIGHT_NAMES, buildInsightInput, claudeInsights, type AiInsight, type AiInsightResult } from '../ai/aiInsight';
import type { MapScope } from './derive';
import { evidenceGids, type Insight } from './insights';
import { fingerprint, OverallButton, OverallResults, useClaudeOverall } from './ClaudeOverall';

const LEVEL_DOT = { high: 'bg-danger', mid: 'bg-warn', low: 'bg-faint' } as const;

// 범위 → 마지막 결과(이 탭 메모리). fp: 보낸 입력의 지문 — 기록이 바뀌었는지 가린다
const cache = new Map<string, { fp: string; result: AiInsightResult }>();
export function useClaudeInsights(s: AppState, scope: MapScope, asOf: string) {
  const ai = useAI();
  const available = ai.engine === 'claude' && !!ai.client;
  const { me } = useStore();
  const scopeKey = insightCacheKey(scope, ai.model, me.id); // 사용자별로 나눈다 — 다른 사용자에게 남의 미확정 인계가 보이지 않게(M-2)
  const fp = useMemo(() => (available ? fingerprint(buildInsightInput(s, scope, asOf).user) : ''), [available, s, scope, asOf]);
  const [st, setSt] = useState<{ running: boolean; error: string; tick: number }>({ running: false, error: '', tick: 0 });
  const ctl = useRef<AbortController | null>(null);
  // 범위·사용자·모델이 바뀌면 진행 중인 호출을 끊고 상태를 비운다
  useEffect(() => {
    ctl.current?.abort();
    setSt((x) => ({ running: false, error: '', tick: x.tick + 1 }));
  }, [scopeKey]);
  // 엔진이 바뀌면(규칙·사내로, 또는 키 거부로 규칙으로 내려가면) 진행 중인 호출을 끊는다 — 끊긴 결과는 캐시·화면에 넣지 않는다(M-4).
  // 오류 문구는 지우지 않는다(키 거부 직후 엔진이 바뀌어도 그 안내가 남아야 한다)
  useEffect(() => {
    ctl.current?.abort();
    setSt((x) => (x.running ? { ...x, running: false } : x));
  }, [ai.engine]);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = useCallback(async () => {
    if (!ai.client || !available) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setSt((x) => ({ ...x, running: true, error: '' }));
    try {
      const r = await claudeInsights(ai.client, s, scope, asOf, c.signal);
      if (c.signal.aborted) return;
      cache.set(scopeKey, { fp, result: r });
      setSt((x) => ({ running: false, error: '', tick: x.tick + 1 }));
    } catch (e) {
      if (c.signal.aborted) return;
      console.warn('AI 인사이트 실패', e);
      setSt((x) => ({ ...x, running: false, error: ai.onError(e) }));
    }
  }, [ai, available, s, scope, asOf, scopeKey, fp]);
  const cancel = () => {
    ctl.current?.abort();
    setSt((x) => ({ ...x, running: false }));
  };
  const hit = cache.get(scopeKey);
  return { available, keyButRule: !available && ai.status === 'available', denied: ai.status === 'denied', internal: ai.preferred === 'internal', running: st.running, error: st.error, result: hit?.result ?? null, stale: !!hit && hit.fp !== fp, run, cancel };
}

export function ClaudeInsights({ data, scope, asOf, focusId, onFocus }: { data: AppState; scope: MapScope; asOf: string; focusId: string | null; onFocus: (x: Insight | null) => void }) {
  const c = useClaudeInsights(data, scope, asOf);
  const o = useClaudeOverall(data, scope, asOf);
  const [open, setOpen] = useState<number | null>(null);
  if (!c.available)
    return (
      <div className="mt-3 border-t border-line pt-2" data-testid="insight-claude-fallback">
        {/* 키 거부 직후에는 엔진이 규칙으로 내려가 이 안내만 남는다 — 방금 난 오류 문구가 힌트에 가려지지 않게 먼저 보인다 */}
        {c.error && <p className="mb-1 text-[12.5px] text-warn" data-testid="claude-insight-error">AI 인사이트를 찾지 못했습니다: {c.error} 위의 규칙 인사이트는 그대로 쓸 수 있습니다.</p>}
        {o.error && o.error !== c.error && <p className="mb-1 text-[12.5px] text-warn" data-testid="claude-overall-error">Claude 전체 인사이트를 찾지 못했습니다: {o.error}</p>}
        <p className="text-2xs text-faint" data-testid="insight-claude-hint">
          {c.denied
            ? '키가 거부되어 지금은 규칙 인사이트만 보입니다. 상단 「AI 설정」에서 키를 지우거나 새 키를 넣으면'
            : c.internal
              ? '사내 AI는 아직 연결되지 않아 지금은 규칙 인사이트만 보입니다. 상단 AI 엔진에서 Claude를 고르면(본인 키 필요)'
              : c.keyButRule
                ? '상단 AI 엔진에서 Claude를 고르면'
                : '상단 「AI 설정」에 본인 Claude API 키를 넣으면'}{' '}
          AI가 업무 기록을 읽고 규칙이 못 보는 위험(숨은 의존·기한 몰림·한 사람만 아는 절차 등)을 더 찾고, 팀 전체를 관통하는 인사이트도 뽑습니다.
        </p>
      </div>
    );
  const r = c.result;
  const focusOf = (x: AiInsight, i: number): Insight => ({ id: `claude:${i}`, kind: 'claude', level: x.level, title: x.title, detail: x.detail, workIds: x.workIds, userIds: x.userIds, evidence: evidenceGids(data, scope, x.workIds, x.userIds) });
  const workName = (id: string) => data.works.find((w) => w.id === id)?.name ?? id;
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="claude-insights">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[13px] font-bold">
          <Sparkles size={14} className="text-infer" /> AI가 찾은 인사이트
        </h4>
        {r && <span className="rounded bg-infersoft px-1.5 text-2xs font-semibold text-infer">Claude API</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {c.running ? (
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted" data-testid="claude-insight-running">
            <Loader2 size={14} className="animate-spin" /> 업무 기록을 읽고 있습니다(최대 120초)
            <button className="ml-2 text-2xs text-brand" onClick={c.cancel}>취소</button>
          </p>
        ) : (
          <button
            className="inline-flex items-center gap-1 rounded border border-infer/30 bg-surface px-2 py-0.5 text-[12px] font-medium text-infer hover:bg-infersoft"
            onClick={() => void c.run()}
            title="이 범위의 업무 기록·사람 목록을 AI(지금: Claude)에 보내, 규칙이 못 보는 위험을 찾습니다(「나만 보기」 메모는 보내지 않음)"
            data-testid="claude-insight-run"
          >
            <Sparkles size={12} /> {r ? (c.stale ? '바뀐 기록으로 다시 찾기' : '다시 찾기') : 'AI로 더 찾기'}
          </button>
        )}
        <OverallButton o={o} />
      </div>
      <OverallResults o={o} data={data} scope={scope} focusId={focusId} onFocus={onFocus} />
      {c.error && <p className="mt-1.5 text-[12.5px] text-warn" data-testid="claude-insight-error">AI 인사이트를 찾지 못했습니다: {c.error} 위의 규칙 인사이트는 그대로 쓸 수 있습니다.</p>}
      {r && (
        <>
          {c.stale && <p className="mt-1 text-2xs text-warn" data-testid="claude-insight-stale">찾은 뒤 기록이 바뀌었습니다. 아래는 이전 기록 기준입니다.</p>}
          {r.items.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-muted">규칙 인사이트 밖에서 더 찾은 위험이 없습니다.</p>
          ) : (
            <ul className="mt-1.5 space-y-0.5">
              {r.items.map((x, i) => {
                const id = `claude:${i}`;
                return (
                  <li key={id}>
                    <div className={cx('flex items-start gap-1 rounded hover:bg-sunken', focusId === id && 'bg-brandsoft ring-1 ring-brand/30')}>
                      <button className="flex min-w-0 flex-1 items-start gap-2 px-1.5 py-1.5 text-left" onClick={() => onFocus(focusId === id ? null : focusOf(x, i))} aria-pressed={focusId === id} data-testid="claude-insight-item">
                        <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', LEVEL_DOT[x.level])} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-1.5">
                            <span className="text-[12.5px] font-semibold">{x.title}</span>
                            <span className="shrink-0 text-2xs text-infer">{AI_INSIGHT_NAMES[x.kind]}</span>
                          </span>
                          <span className="block text-2xs leading-snug text-muted">{x.detail}</span>
                        </span>
                      </button>
                      <button className="mt-1.5 shrink-0 px-1 text-muted hover:text-ink" onClick={() => setOpen(open === i ? null : i)} title="인용 원문 보기" aria-expanded={open === i} data-testid="claude-insight-quote">
                        <Quote size={12} />
                      </button>
                    </div>
                    {open === i && (
                      <ul className="mb-1 ml-5 space-y-1 rounded border-l-2 border-infer/40 bg-sunken/60 px-2 py-1 text-2xs text-muted">
                        {x.refs.map((ref) => (
                          <li key={`${ref.workId}#${ref.lineNo}`}>
                            「{ref.quote}」 <span className="text-faint">— {workName(ref.workId)} 기록 {ref.lineNo}번째 줄</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {r.dropped > 0 && <p className="mt-1 text-2xs text-faint" data-testid="claude-insight-dropped">근거 인용이 업무 기록에서 확인되지 않아 뺀 항목 {r.dropped}개</p>}
          {r.truncated > 0 && <p className="mt-1 text-2xs text-faint">업무가 많아 최근 갱신순으로 일부만 보냈습니다(빠진 업무 {r.truncated}개).</p>}
        </>
      )}
      <p className="mt-2 text-2xs text-faint">근거 인용이 실제 업무 기록에 있는지 앱이 확인한 것만 보여 줍니다. 위험인지 판단은 사람이 합니다.</p>
    </div>
  );
}
