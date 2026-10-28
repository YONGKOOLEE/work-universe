// Claude 점검 결과(사전 점검·업무 상세가 함께 쓴다). 상태는 화면에만 둔다(업무 데이터·내보내기에 넣지 않음).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Quote, Sparkles } from 'lucide-react';
import { CiteLink, ProvChip } from '../components/ui';
import { cx } from '../lib/util';
import type { AppState } from '../lib/types';
import { useAI } from './claude';
import { CHECK_NAMES, claudeCheck, type CheckResult } from './aiCheck';

export interface ClaudeCheckState {
  running: boolean;
  result: CheckResult | null;
  error: string;
}

/** Claude 점검 실행 훅. run()은 결과(실패하면 null)를 돌려준다 — 실패해도 규칙 점검 흐름은 막지 않는다 */
export function useClaudeCheck(s: AppState, workId: string) {
  const ai = useAI();
  const [st, setSt] = useState<ClaudeCheckState>({ running: false, result: null, error: '' });
  const ctl = useRef<AbortController | null>(null);
  // 다른 업무로 바뀌면 예전 결과를 버린다
  useEffect(() => {
    ctl.current?.abort();
    setSt({ running: false, result: null, error: '' });
  }, [workId]);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = useCallback(async (): Promise<CheckResult | null> => {
    if (!ai.client || ai.engine !== 'claude') return null;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setSt({ running: true, result: null, error: '' });
    try {
      const r = await claudeCheck(ai.client, s, workId, c.signal);
      if (c.signal.aborted) return null;
      setSt({ running: false, result: r, error: '' });
      return r;
    } catch (e) {
      if (c.signal.aborted) return null;
      console.warn('Claude 점검 실패', e);
      setSt({ running: false, result: null, error: ai.onError(e) });
      return null;
    }
  }, [ai, s, workId]);
  return { ...st, run, available: ai.engine === 'claude' && !!ai.client };
}

export function CheckFindings({ state, className }: { state: ClaudeCheckState; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (state.running)
    return (
      <p className={cx('flex items-center gap-1.5 text-[13px] text-muted', className)} data-testid="claude-check-running">
        <Loader2 size={14} className="animate-spin" /> Claude가 업무 기록과 연결 문서를 대조하는 중입니다(최대 90초)
      </p>
    );
  if (state.error)
    return (
      <p className={cx('text-[13px] text-warn', className)} data-testid="claude-check-error">
        Claude 점검을 하지 못했습니다: {state.error} 규칙 점검 결과는 그대로 쓸 수 있습니다.
      </p>
    );
  const r = state.result;
  if (!r) return null;
  return (
    <div className={className} data-testid="claude-check">
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
        <Sparkles size={14} className="text-infer" /> Claude가 찾은 것 <span className="text-2xs font-normal text-muted">{r.findings.length}건 · 원문 인용 대조 통과</span>
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
                  <div className="mt-0.5">{f.cite ? <CiteLink c={f.cite} /> : <span className="text-2xs text-faint">업무 기록: {f.recordLine}</span>}</div>
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
