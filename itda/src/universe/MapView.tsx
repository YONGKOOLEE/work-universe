// 지도 그리기(CR-24 D24-3): 파생 문서 → 유니버스 view·접기(projectView) → 유니버스 그래프(Cytoscape). 업무잇다 화면 색에 맞춘 밝은·어두운 테마.
import { useEffect, useMemo, useRef } from 'react';
import type { Derived } from './derive';
import { useEffectiveMapStyle, type MapStyle } from './mapStyle';
import { isDarkNow, useTheme } from '../lib/theme';
import { retireCy } from './retireCy';
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
const isDark = isDarkNow;
const rgb = (name: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().split(/\s+/).join(',')})`;

// (가) 우주: 짙은 남색 바탕에서 또렷한 유형 색(dataviz 검증기, 바탕 #0b1430 — 2026-10-29)
export const SPACE_COLORS = { root: '#a9c1ff', work: '#5b9bff', person: '#2fd3a0', artifact: '#f2b84b', org: '#b48cff', topic: '#ff6fa8' } as const;
const SPACE_BG = '#0b1430';
const MIX_NODE = '#142046'; // 가+나 노드 바탕(우주 바탕보다 한 단계 밝게)

// (나) 정돈: 유형마다 선 아이콘(흰 바탕 노드 안). 24×24 선 그림, 색은 유형 색
const ICONS: Record<string, string> = {
  root: '<circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-25 12 12)"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  artifact: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  org: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/>',
  topic: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
};
export const iconUri = (type: string, color: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[type] ?? ICONS.work}</svg>`)}`;

function themeFor(style: MapStyle) {
  const base = themeNow();
  if (style === 'space') {
    const types = SPACE_COLORS as Record<string, string>;
    const col = (n: any) => types[n.data('core_type')] || '#8fa3c8';
    return {
      ...base,
      bg: SPACE_BG,
      text: '#e8eefc',
      muted: '#a8b4d2',
      edge: '#4a5d8f',
      accent: '#8fb4ff',
      select: '#ffffff',
      types,
      // 빛나는 항목: 같은 색 아래깔기(underlay)로 은은한 빛
      nodeStyle: { 'background-opacity': 0.3, 'border-width': 2, 'underlay-color': col, 'underlay-opacity': 0.22, 'underlay-padding': 7, 'underlay-shape': 'ellipse', 'text-outline-color': SPACE_BG, 'font-weight': 'normal' },
      rootStyle: { 'underlay-opacity': 0.35, 'underlay-padding': 16, 'background-opacity': 0.95 },
      edgeStyle: { width: 1.1, opacity: 0.6, 'arrow-scale': 0.7, 'text-outline-color': SPACE_BG },
    };
  }
  if (style === 'mix') {
    // 가+나: 우주 바탕·빛 + 짙은 노드 안 유형 아이콘(유형 색) + 이름 띠(선이 지나가도 읽힘)
    const types = SPACE_COLORS as Record<string, string>;
    const col = (n: any) => types[n.data('core_type')] || '#8fa3c8';
    return {
      ...base,
      bg: SPACE_BG,
      text: '#e8eefc',
      muted: '#a8b4d2',
      edge: '#4a5d8f',
      accent: '#8fb4ff',
      select: '#ffffff',
      types,
      nodeStyle: {
        'background-color': MIX_NODE,
        'background-opacity': 1,
        'border-width': 1.8,
        'background-image': (n: any) => iconUri(n.data('core_type'), col(n)),
        'background-width': '54%',
        'background-height': '54%',
        'background-clip': 'none',
        'underlay-color': col,
        'underlay-opacity': 0.2,
        'underlay-padding': 6,
        'underlay-shape': 'ellipse',
        'text-background-color': SPACE_BG,
        'text-background-opacity': 0.82,
        'text-background-padding': 2,
        'text-background-shape': 'roundrectangle',
        'font-weight': 'normal',
      },
      rootStyle: { 'background-color': col, 'background-opacity': 1, 'border-width': 0, 'background-image': () => iconUri('root', SPACE_BG), 'background-width': '50%', 'background-height': '50%', 'underlay-opacity': 0.35, 'underlay-padding': 14 },
      edgeStyle: { width: 1.1, opacity: 0.65, 'arrow-scale': 0.7, 'text-outline-color': SPACE_BG },
    };
  }
  if (style === 'clean') {
    const types = base.types as Record<string, string>;
    const col = (n: any) => types[n.data('core_type')] || base.muted;
    return {
      ...base,
      edge: isDark() ? '#4a5878' : '#8794ab', // 밝게: 흰 판에서 본부 사이 선이 옅다는 지적(처음 사용 점검 2 M-7)으로 한 단계 진하게
      // 흰 바탕 노드 + 얇은 유형 색 테두리 + 유형 아이콘. 이름은 바탕색 띠로 선이 지나가도 읽힘
      nodeStyle: {
        'background-color': base.bg,
        'background-opacity': 1,
        'border-width': 1.6,
        'background-image': (n: any) => iconUri(n.data('core_type'), col(n)),
        'background-width': '54%',
        'background-height': '54%',
        'background-clip': 'none',
        'text-background-color': base.bg,
        'text-background-opacity': 0.88,
        'text-background-padding': 2,
        'text-background-shape': 'roundrectangle',
      },
      rootStyle: { 'background-color': col, 'background-opacity': 1, 'border-width': 0, 'background-image': (n: any) => iconUri('root', '#ffffff'), 'background-width': '50%', 'background-height': '50%' },
      edgeStyle: { width: isDark() ? 1 : 1.3, opacity: 0.85, 'arrow-scale': 0.65 },
    };
  }
  return { ...base, edgeStyle: { width: isDark() ? 1.4 : 1.7, opacity: 0.9 } };
}

function themeNow() {
  const dark = isDark();
  return {
    bg: rgb('surface'),
    text: rgb('ink'),
    muted: rgb('muted'),
    edge: dark ? '#5a6a8a' : '#6b7893',
    accent: rgb('brand'),
    select: dark ? '#ffffff' : '#14295c',
    font: FONT,
    types: dark ? MAP_COLORS.dark : MAP_COLORS.light,
  };
}

/**
 * 접힌 조직 꼭지 라벨: 엔진은 「이름＋숨긴 노드 수(업무·사람·문서·주제 합)」로 그려 칩의 「업무 n」과 숫자가 달라 헷갈린다
 * (처음 사용 점검 1 M-5, 2 M-7). 접힌 조직(하위 포함)의 업무 수로 바꾼다. 엔진은 건드리지 않고 render 뒤에 data('label')만 고친다.
 * 업무 수 = 접힌 조직과 그 아래 조직 문서의 업무 항목(원래 업무 ID 기준 중복 없이, 「이 지도 밖」 표시 항목 제외)
 */
export function collapsedWorkCounts(derived: Derived, display: { collapsed: Map<string, { root_gid: string }> }): Map<string, number> {
  const out = new Map<string, number>();
  const below = (uid: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(uid)) return seen;
    seen.add(uid);
    for (const r of derived.docs.get(uid)?.refs ?? []) below(r.child_universe_id, seen);
    return seen;
  };
  for (const [uid, c] of display.collapsed) {
    const ids = new Set<string>();
    for (const u of below(uid)) {
      const d = derived.docs.get(u);
      if (!d) continue;
      for (const n of d.nodes) {
        if (n.core_type !== 'work' || n.hidden || n.attrs?.범위 === '이 지도 밖') continue;
        const o = derived.origin.get(`${u}/${n.id}`);
        if (o?.kind === 'work') ids.add(o.id);
      }
    }
    out.set(c.root_gid, ids.size);
  }
  return out;
}

function relabelCollapsed(cy: any, display: any, derived: Derived) {
  if (!display?.collapsed || !derived) return;
  const counts = collapsedWorkCounts(derived, display);
  cy.nodes().forEach((n: any) => {
    if (!n.data('collapsed') || !counts.has(n.id())) return;
    const name = String(n.data('label')).split('\n')[0];
    n.data('label', `${name}\n업무 ${counts.get(n.id())}`);
  });
}

export interface MapMarks {
  cls: string | null;
  gids: string[];
  dim?: boolean;
}

export function useMapView(derived: Derived) {
  return useMemo(() => buildView(derived.doc, derived.resolve), [derived]);
}

/** 시안·화면 밝기를 바꾸면 그래프를 새로 만든다(색·모양은 만들 때 정해짐) */
export function MapView(props: Parameters<typeof MapViewInner>[0]) {
  const style = useEffectiveMapStyle();
  const [theme] = useTheme();
  return <MapViewInner key={`${style}-${theme}`} {...props} mapStyle={style} />;
}

function MapViewInner({
  derived,
  view,
  expanded,
  selected,
  onSelect,
  onToggle,
  marks,
  height = 560,
  testid,
  mapStyle = 'basic',
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
  mapStyle?: MapStyle;
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
      theme: themeFor(mapStyle),
    });
    graph.current = g;
    // 끝난 담당(기간 끝 있음)은 점선 「전 담당」 — 인계 뒤 전임 → 후임이 지도에서 보이게(D24-6 b)
    g.cy.style().selector('edge.past').style({ 'line-style': 'dashed', opacity: 0.6, label: '전 담당', 'target-arrow-shape': 'none', 'font-size': 10 }).update();
    // 밝은 흰 판: 접힌 본부·부 사이 요약 연결(점선)이 옅어 거의 안 보인다 → 더 진하고 굵게(엔진 규칙 뒤에 덧붙임)
    if (mapStyle !== 'space' && mapStyle !== 'mix' && !isDark()) g.cy.style().selector('edge[?summarized]').style({ width: 2.4, opacity: 1, 'line-color': '#55627f', 'target-arrow-color': '#55627f' }).update();
    if (typeof window !== 'undefined') (window as any).__itdaMap = { graph: g, derived };
    return () => {
      // 엔진의 늦은 타이머·rAF·창 크기 콜백이 파기된 인스턴스를 부르면 isHeadless 예외가 난다 — 파기와 함께 막아 둔다(처음 사용 점검 M-6)
      retireCy(g.cy);
      graph.current = null;
    };
    // 그래프는 한 번 만들고, 데이터가 바뀌면 render로 다시 그린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const display = useMemo(() => projectView(view, { expanded, deepSummary: true }), [view, expanded]);

  useEffect(() => {
    const g = graph.current;
    if (!g) return;
    g.render(display, selected);
    const ended = new Set(view.edges.filter((e: any) => e.core_type === 'performs' && e.period?.end).map((e: any) => e.gid));
    g.cy.edges().forEach((ed: any) => {
      if (ended.has(ed.id())) ed.addClass('past');
    });
    relabelCollapsed(g.cy, display, derived);
    if (typeof window !== 'undefined') (window as any).__itdaMap = { graph: g, derived, view, display };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display]);

  useEffect(() => {
    graph.current?.highlight(selected);
  }, [selected]);

  useEffect(() => {
    graph.current?.setSpaceMarks(marks && marks.cls ? { cls: marks.cls, gids: marks.gids, dim: !!marks.dim } : {});
  }, [marks]);

  return <div ref={box} data-testid={testid} data-map-style={mapStyle} className={mapStyle === 'basic' ? 'w-full rounded-lg border border-line bg-surface' : `map-canvas map-canvas-${mapStyle === 'mix' ? 'space' : mapStyle} w-full`} style={{ height }} />;
}

/** 범례: 지금 그린 유형만 */
export function MapLegend({ view }: { view: any }) {
  const style = useEffectiveMapStyle();
  useTheme(); // 밝기를 바꾸면 범례 색도 다시
  const dark = isDark();
  const colors = style === 'space' || style === 'mix' ? SPACE_COLORS : dark ? MAP_COLORS.dark : MAP_COLORS.light;
  const present = new Set<string>(view.nodes.filter((n: any) => !n.hidden).map((n: any) => n.core_type));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
      {Object.keys(TYPE_NAMES)
        .filter((k) => present.has(k))
        .map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            {style === 'clean' || style === 'mix' ? (
              <img src={iconUri(k, (colors as any)[k])} alt="" className="h-3.5 w-3.5" />
            ) : (
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: (colors as any)[k], background: `${(colors as any)[k]}55`, boxShadow: style === 'space' ? `0 0 8px ${(colors as any)[k]}` : undefined }} />
            )}
            {TYPE_NAMES[k]}
          </span>
        ))}
    </div>
  );
}
