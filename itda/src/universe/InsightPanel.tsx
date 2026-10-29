// 인사이트 판(지도 오른쪽): 한눈에 한 줄 + 인계 위험 + 업무 흐름·반복. 항목을 누르면 지도에서 근거 항목을 강조하고 그 업무·사람 카드를 연다.
import { useMemo, useState } from 'react';
import { Info, Lightbulb } from 'lucide-react';
import { cx } from '../lib/util';
import type { AppState } from '../lib/types';
import type { MapScope } from './derive';
import { effectiveOrgs, orgChain, orgOfName, orgShort } from '../lib/orgs';
import { handoverInsights, INSIGHT_HELP, INSIGHT_NAMES, type FlowKind, type Insight, type InsightKind } from './insights';
import { FLOW_GROUP_NAME, FLOW_HELP, FLOW_KINDS, FLOW_NAMES, flowInsights, overview } from './flowInsights';
import { ClaudeInsights } from './ClaudeInsights';

const KINDS = Object.keys(INSIGHT_NAMES) as InsightKind[];
const LEVEL_DOT = { high: 'bg-danger', mid: 'bg-warn', low: 'bg-faint' } as const;
const SHOW = 6;
type AnyKind = InsightKind | FlowKind;
const NAMES: Record<string, string> = { ...INSIGHT_NAMES, ...FLOW_NAMES };
const HELP: Record<string, string> = { ...INSIGHT_HELP, ...FLOW_HELP };

export function InsightPanel({ data, scope, asOf, focusId, onFocus }: { data: AppState; scope: MapScope; asOf: string; focusId: string | null; onFocus: (x: Insight | null) => void }) {
  const r = useMemo(() => handoverInsights(data, scope, asOf), [data, scope, asOf]);
  const f = useMemo(() => flowInsights(data, scope, asOf), [data, scope, asOf]);
  const ov = useMemo(() => overview(data, scope, r, f), [data, scope, r, f]);
  const [kind, setKind] = useState<AnyKind | 'all'>('all');
  const [more, setMore] = useState({ risk: false, flow: false });
  // 위 조직 지도: 위험을 한 단계 아래 조직별로 모아 보인다(부 → 팀별, 회사 → 본부별). 누르면 그 조직 것만
  const all: Insight[] = useMemo(() => [...r.items, ...f.items], [r.items, f.items]);
  const groups = useMemo(() => rollup(data, scope, all), [data, scope, all]);
  const [org, setOrg] = useState<string | null>(null);
  const orgOk = org && groups?.some((g) => g.id === org) ? org : null;
  const pass = (x: Insight) => (kind === 'all' || x.kind === kind) && (!orgOk || groups!.find((g) => g.id === orgOk)!.ids.has(x.id));
  const sections = [
    { key: 'risk' as const, title: '인계 위험', list: r.items.filter(pass) },
    { key: 'flow' as const, title: FLOW_GROUP_NAME, list: f.items.filter(pass) },
  ];
  const empty = sections.every((x) => x.list.length === 0);
  const notes = [...r.notes, ...f.notes];
  return (
    <div className="rounded-lg border border-line bg-surface p-4" data-testid="map-risk">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[14px] font-bold">
          <Lightbulb size={15} className="text-warn" /> 인사이트
        </h3>
        <span className="rounded bg-sunken px-1.5 text-2xs font-semibold text-muted" title="업무 유니버스의 규칙으로 계산합니다(키 없이 동작)">규칙 기반</span>
      </div>
      <p className="mt-1.5 rounded bg-sunken/70 px-2 py-1.5 text-2xs leading-snug text-muted" data-testid="insight-summary">
        <b className="mr-1 text-ink">한눈에</b>
        {ov.text}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1" role="tablist" aria-label="인사이트 종류">
        <Chip on={kind === 'all'} onClick={() => setKind('all')} testid="insight-kind-all">전체 {all.length}</Chip>
      </div>
      <ChipGroup title="인계 위험" kinds={KINDS} counts={r.counts} kind={kind} setKind={setKind} />
      <ChipGroup title={FLOW_GROUP_NAME} kinds={FLOW_KINDS} counts={f.counts} kind={kind} setKind={setKind} />
      {groups && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-2xs" data-testid="insight-orgs">
          <span className="font-semibold text-faint">조직별</span>
          {groups.map((g) => (
            <button key={g.id} className={cx('rounded border px-1.5 py-0.5', orgOk === g.id ? 'border-brand bg-brandsoft text-brand' : 'border-line text-muted hover:bg-sunken')} onClick={() => setOrg(orgOk === g.id ? null : g.id)} aria-pressed={orgOk === g.id} data-testid="insight-org">
              {g.label} <b className="tnum">{g.ids.size}</b>
            </button>
          ))}
        </div>
      )}
      {kind !== 'all' && <p className="mt-1.5 flex items-start gap-1 text-2xs text-muted"><Info size={12} className="mt-px shrink-0" />{HELP[kind]}</p>}
      {empty && <p className="mt-2 text-[12.5px] text-muted">{notes.length ? notes.join(' · ') : '찾은 인사이트가 없습니다'}</p>}
      {sections.map((sec) => {
        if (!sec.list.length) return null;
        const shown = more[sec.key] ? sec.list : sec.list.slice(0, SHOW);
        return (
          <div key={sec.key} className="mt-2" data-testid={`insight-group-${sec.key}`}>
            <h4 className="px-1.5 text-2xs font-bold text-faint">{sec.title} {sec.list.length}</h4>
            <ul className="mt-0.5 space-y-0.5">
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
                        <span className="shrink-0 text-2xs text-faint">{NAMES[x.kind]}</span>
                      </span>
                      <span className="block text-2xs leading-snug text-muted">{x.detail}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {sec.list.length > SHOW && (
              <button className="mt-1 text-2xs text-brand" onClick={() => setMore((v) => ({ ...v, [sec.key]: !v[sec.key] }))} data-testid={sec.key === 'risk' ? 'insight-more' : 'insight-more-flow'}>
                {more[sec.key] ? '줄여 보기' : `${sec.list.length - SHOW}건 더 보기`}
              </button>
            )}
          </div>
        );
      })}
      <p className="mt-2 text-2xs text-faint">항목을 누르면 지도에서 근거가 노랗게 강조됩니다. 다시 누르면 풀립니다.</p>
      <ClaudeInsights data={data} scope={scope} asOf={asOf} focusId={focusId} onFocus={onFocus} />
    </div>
  );
}

function ChipGroup<K extends AnyKind>({ title, kinds, counts, kind, setKind }: { title: string; kinds: K[]; counts: Record<K, number>; kind: AnyKind | 'all'; setKind: (k: K) => void }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" role="tablist" aria-label={title}>
      <span className="mr-0.5 text-2xs font-semibold text-faint">{title}</span>
      {kinds.map((k) => (
        <Chip key={k} on={kind === k} onClick={() => setKind(k)} disabled={!counts[k]} title={HELP[k]} testid={`insight-kind-${k}`}>
          {NAMES[k]} {counts[k]}
        </Chip>
      ))}
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

/** 위험 항목을 범위 조직의 한 단계 아래 조직으로 모은다. 묶음이 둘 이상일 때만(한 팀 지도에서는 없음) */
function rollup(data: AppState, scope: MapScope, items: Insight[]): { id: string; label: string; ids: Set<string> }[] | null {
  if (scope.kind !== 'org' && scope.kind !== 'all') return null;
  const orgs = effectiveOrgs(data);
  const deptOf = (x: Insight) => data.works.find((w) => w.id === x.workIds[0])?.dept ?? data.users.find((u) => u.id === x.userIds[0])?.dept ?? '';
  const groupOf = (dept: string) => {
    const o = orgOfName(orgs, dept);
    const chain = o ? orgChain(orgs, o.id) : []; // 아래 → 위
    if (scope.kind === 'all') return chain[chain.length - 1] ?? null;
    const i = chain.findIndex((y) => y.id === scope.orgId);
    return i > 0 ? chain[i - 1] : i === 0 ? chain[0] : null;
  };
  const map = new Map<string, { id: string; label: string; ids: Set<string> }>();
  for (const x of items) {
    const g = groupOf(deptOf(x));
    const id = g?.id ?? '-';
    const label = !g ? '그 밖' : scope.kind === 'org' && g.id === scope.orgId ? `${orgShort(g.name)} 직접` : orgShort(g.name);
    if (!map.has(id)) map.set(id, { id, label, ids: new Set() });
    map.get(id)!.ids.add(x.id);
  }
  return map.size >= 2 ? [...map.values()].sort((a, b) => b.ids.size - a.ids.size) : null;
}
