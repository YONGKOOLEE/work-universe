// 지도 그리기(CR-24 D24-3): 파생 문서 → 유니버스 view·접기(projectView) → 유니버스 그래프(Cytoscape). 업무잇다 화면 색에 맞춘 밝은·어두운 테마.
import { useEffect, useMemo, useRef } from 'react';
import type { Derived } from './derive';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { projectView } from '../../../app/src/view/collapse.js';
// @ts-expect-error 유니버스 화면 모듈(JS, Cytoscape)
import { createGraph } from '../../../app/src/ui/graph.js';

// 유형별 색(dataviz 검증기 통과: 밝은 화면 #ffffff, 어두운 화면 #151c2c — 2026-10-29). 지도 중심은 남색(모양·크기로도 구분)
export const MAP_COLORS = {
  light: { root: '#14295c', work: '#2f6fd0', person: '#0d8a6c', artifact: '#b7791f', org: '#7c5ad6', topic: '#c2477a' },
  dark: { root: '#bed0ff', work: '#5b8fe0', person: '#249b7a', artifact: '#bf8a2c', org: '#9b7fe8', topic: '#d4628d' },
} as const;
export const TYPE_NAMES: Record<string, string> = { root: '지도 중심', work: '업무·할 일', person: '사람', artifact: '문서', org: '조직', topic: '주제' };

const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
const isDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
const rgb = (name: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().split(/\s+/).join(',')})`;

function themeNow() {
  const dark = isDark();
  return {
    bg: rgb('surface'),
    text: rgb('ink'),
    muted: rgb('muted'),
    edge: dark ? '#5a6a8a' : '#8a96ad',
    accent: rgb('brand'),
    select: dark ? '#ffffff' : '#14295c',
    font: FONT,
    types: dark ? MAP_COLORS.dark : MAP_COLORS.light,
  };
}

export interface MapMarks {
  cls: string | null;
  gids: string[];
  dim?: boolean;
}

export function useMapView(derived: Derived) {
  return useMemo(() => buildView(derived.doc, derived.resolve), [derived]);
}

export function MapView({
  derived,
  view,
  expanded,
  selected,
  onSelect,
  onToggle,
  marks,
  height = 560,
  testid,
}: {
  derived: Derived;
  view: any;
  expanded: Set<string>;
  selected: string | null;
  onSelect: (gid: string | null) => void;
  onToggle?: (universeId: string) => void;
  marks?: MapMarks;
  height?: number | string;
  testid?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const graph = useRef<any>(null);
  const handlers = useRef({ onSelect, onToggle });
  handlers.current = { onSelect, onToggle };

  useEffect(() => {
    if (!box.current) return;
    const g = createGraph(box.current, {
      onSelect: (gid: string | null) => handlers.current.onSelect(gid),
      onToggle: (u: string) => handlers.current.onToggle?.(u),
      theme: themeNow(),
    });
    graph.current = g;
    if (typeof window !== 'undefined') (window as any).__itdaMap = { graph: g, derived };
    return () => {
      try {
        g.cy.destroy();
      } catch {
        /* 이미 정리됨 */
      }
      graph.current = null;
    };
    // 그래프는 한 번 만들고, 데이터가 바뀌면 render로 다시 그린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const display = useMemo(() => projectView(view, { expanded }), [view, expanded]);

  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    g.render(display, selected);
    if (typeof window !== 'undefined') (window as any).__itdaMap = { graph: g, derived, view, display };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display]);

  useEffect(() => {
    graph.current?.highlight(selected);
  }, [selected]);

  useEffect(() => {
    graph.current?.setSpaceMarks(marks && marks.cls ? { cls: marks.cls, gids: marks.gids, dim: !!marks.dim } : {});
  }, [marks]);

  return <div ref={box} data-testid={testid} className="w-full rounded-lg border border-line bg-surface" style={{ height }} />;
}

/** 범례: 지금 그린 유형만 */
export function MapLegend({ view }: { view: any }) {
  const dark = isDark();
  const colors = dark ? MAP_COLORS.dark : MAP_COLORS.light;
  const present = new Set<string>(view.nodes.filter((n: any) => !n.hidden).map((n: any) => n.core_type));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
      {Object.keys(TYPE_NAMES)
        .filter((k) => present.has(k))
        .map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: (colors as any)[k], background: `${(colors as any)[k]}55` }} />
            {TYPE_NAMES[k]}
          </span>
        ))}
    </div>
  );
}
