// 인계 위험 인사이트 판(지도 오른쪽). 항목을 누르면 지도에서 근거 항목을 강조하고 그 업무·사람 카드를 연다.
import { useMemo, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cx } from '../lib/util';
import type { AppState } from '../lib/types';
import type { MapScope } from './derive';
import { handoverInsights, INSIGHT_HELP, INSIGHT_NAMES, type Insight, type InsightKind } from './insights';
import { ClaudeInsights } from './ClaudeInsights';

const KINDS = Object.keys(INSIGHT_NAMES) as InsightKind[];
const LEVEL_DOT = { high: 'bg-danger', mid: 'bg-warn', low: 'bg-faint' } as const;
const SHOW = 6;

export function InsightPanel({ data, scope, asOf, focusId, onFocus }: { data: AppState; scope: MapScope; asOf: string; focusId: string | null; onFocus: (x: Insight | null) => void }) {
  const r = useMemo(() => handoverInsights(data, scope, asOf), [data, scope, asOf]);
  const [kind, setKind] = useState<InsightKind | 'all'>('all');
  const [more, setMore] = useState(false);
  const list = r.items.filter((x) => kind === 'all' || x.kind === kind);
  const shown = more ? list : list.slice(0, SHOW);
  return (
    <div className="rounded-lg border border-line bg-surface p-4" data-testid="map-risk">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[14px] font-bold">
          <AlertTriangle size={15} className="text-warn" /> 인계 위험 인사이트
        </h3>
        <span className="rounded bg-sunken px-1.5 text-2xs font-semibold text-muted" title="업무 유니버스의 위험 규칙으로 계산합니다(키 없이 동작)">규칙 기반</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="인사이트 종류">
        <Chip on={kind === 'all'} onClick={() => setKind('all')} testid="insight-kind-all">전체 {r.items.length}</Chip>
        {KINDS.map((k) => (
          <Chip key={k} on={kind === k} onClick={() => setKind(k)} disabled={!r.counts[k]} title={INSIGHT_HELP[k]} testid={`insight-kind-${k}`}>
            {INSIGHT_NAMES[k]} {r.counts[k]}
          </Chip>
        ))}
      </div>
      {kind !== 'all' && <p className="mt-1.5 flex items-start gap-1 text-2xs text-muted"><Info size={12} className="mt-px shrink-0" />{INSIGHT_HELP[kind]}</p>}
      {list.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-muted">{r.notes.length ? r.notes.join(' · ') : '찾은 위험이 없습니다'}</p>
      ) : (
        <ul className="mt-2 space-y-0.5">
          {shown.map((x) => (
            <li key={x.id}>
              <button
                className={cx('flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left hover:bg-sunken', focusId === x.id && 'bg-brandsoft ring-1 ring-brand/30')}
                onClick={() => onFocus(focusId === x.id ? null : x)}
                aria-pressed={focusId === x.id}
                data-testid="insight-item"
              >
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', LEVEL_DOT[x.level])} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold">{x.title}</span>
                    <span className="shrink-0 text-2xs text-faint">{INSIGHT_NAMES[x.kind]}</span>
                  </span>
                  <span className="block text-2xs leading-snug text-muted">{x.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > SHOW && (
        <button className="mt-1 text-2xs text-brand" onClick={() => setMore((v) => !v)} data-testid="insight-more">
          {more ? '줄여 보기' : `${list.length - SHOW}건 더 보기`}
        </button>
      )}
      <p className="mt-2 text-2xs text-faint">항목을 누르면 지도에서 근거가 노랗게 강조됩니다. 다시 누르면 풀립니다.</p>
      <ClaudeInsights data={data} scope={scope} asOf={asOf} focusId={focusId} onFocus={onFocus} />
    </div>
  );
}

function Chip({ on, onClick, disabled, title, testid, children }: { on: boolean; onClick: () => void; disabled?: boolean; title?: string; testid?: string; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={on}
      className={cx('rounded-full border px-2 py-0.5 text-2xs font-medium', on ? 'border-brand bg-brand text-onbrand' : 'border-line text-muted hover:bg-sunken', disabled && 'opacity-40')}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testid}
    >
      {children}
    </button>
  );
}
