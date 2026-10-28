// 지도 위험 점검 → 업무잇다 점검 목록(CR-24 D24-6 c). 대시보드 「AI가 발견한 누락·갱신 필요 항목」이 같은 목록으로 보여 준다.
// 업무 유니버스 규칙(view/space-marks.js soloWorks = rules/insight-risk.js knowledgeConcentration)을 그대로 쓰고, 할 일은 빼고 업무만 센다.
import type { AppState } from '../lib/types';
import { deriveMap } from './derive';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { soloWorks } from '../../../app/src/view/space-marks.js';

export interface MapRisk {
  id: string;
  workId: string;
  severity: 'mid';
  title: string;
  detail: string;
  to: string;
}

/** 혼자만 아는 업무(지금까지 한 사람만 담당해 본 업무). asOf: YYYY-MM-DD */
export function mapRiskIssues(s: AppState, asOf: string): MapRisk[] {
  if (!s.works.length) return [];
  const d = deriveMap(s, { kind: 'all' }, undefined, { actions: false });
  const view = buildView(d.doc, d.resolve);
  const out: MapRisk[] = [];
  for (const g of soloWorks(view, asOf) as Iterable<string>) {
    const n = view.getNode(g);
    const o = [g, ...(n?.merged_from || [])].map((x: string) => d.origin.get(x)).find((x) => x?.kind === 'work');
    const w = o && s.works.find((x) => x.id === o.id);
    if (!w || out.some((x) => x.workId === w.id)) continue;
    const who = w.owners.map((u) => s.users.find((x) => x.id === u)?.name ?? u).join('·');
    out.push({ id: `${w.id}-solo`, workId: w.id, severity: 'mid', title: '혼자만 아는 업무', detail: `${who || '담당자'}만 담당해 본 업무 — 인계 대비 필요(업무 유니버스 위험 점검)`, to: `/works/${w.id}?tab=map` });
  }
  return out;
}
