// 인계 위험 인사이트(업무 유니버스 규칙을 업무잇다 데이터에). 지도 위험 판·대시보드가 함께 쓴다.
// 유니버스 규칙(app/src/rules/insight-risk.js·insight.js)을 그대로 부르고, 결과의 근거 항목(전역 ID)을 업무잇다 업무·사람 ID로 되돌린다.
// 인계 준비도(6항목)는 넣지 않았다: 표준 양식 항목이 업무잇다 「필수 항목 미작성」 점검과 겹치고, 진행 중 메모를 미해결 이슈로 세어 잡음이 많다.
// 브라우저 기능을 쓰지 않는다(vitest로 검증).
import type { AppState } from '../lib/types';
import { deriveMap, worksInScope, type Derived, type MapScope } from './derive';
import { effectiveOrgs, subtreeNames } from '../lib/orgs';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { knowledgeConcentration, ripple } from '../../../app/src/rules/insight-risk.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { densityGaps } from '../../../app/src/rules/insight.js';

export type InsightKind = 'solo' | 'bottleneck' | 'sole_person' | 'dense' | 'gap';
export const INSIGHT_NAMES: Record<InsightKind, string> = {
  solo: '혼자만 아는 일',
  bottleneck: '길목 업무',
  sole_person: '빠지면 함께 막히는 사람',
  dense: '일 몰린 사람',
  gap: '담당자 빈 업무',
};
/** 한 줄 설명(화면 도움말) */
export const INSIGHT_HELP: Record<InsightKind, string> = {
  solo: '지금까지 한 사람만 담당해 본 업무. 인계 기록이 없으면 높음',
  bottleneck: '선후행·산출물로 이어져, 늦어지면 뒤 업무가 함께 늦어지는 업무',
  sole_person: '혼자 맡은 업무가 길목이라, 이 사람이 빠지면 이어진 업무까지 멈춤',
  dense: '지금 맡은 업무가 기준(3개) 이상인 사람',
  gap: '지금 담당자가 없는 업무',
};
/** 일 몰린 사람 기준(유니버스 기본값 3과 같다). 바꾸기 쉬운 곳 하나 */
export const DENSE_N = 3;

/** 업무 흐름·반복 인사이트 종류(universe/flowInsights.ts): 인계 사슬·같은 주제 반복·인계 준비도 낮음·유사 경험자 */
export type FlowKind = 'handover_chain' | 'topic_repeat' | 'low_readiness' | 'similar';

export interface Insight {
  id: string;
  kind: InsightKind | FlowKind | 'claude'; // claude: Claude 인사이트(ai/aiInsight.ts)를 지도에서 강조할 때
  level: 'high' | 'mid' | 'low';
  title: string; // 업무 또는 사람 이름
  detail: string;
  workIds: string[]; // 근거 업무(업무잇다 ID)
  userIds: string[]; // 근거 사람(업무잇다 ID)
  evidence: string[]; // 지도 전역 ID(지도에서 강조할 항목)
}

/** 규칙 인사이트(종류가 규칙 다섯 가지 중 하나) */
export type RuleInsight = Insight & { kind: InsightKind };
/** 업무 흐름·반복 규칙 인사이트 */
export type FlowInsight = Insight & { kind: FlowKind };

export interface InsightResult {
  items: RuleInsight[];
  counts: Record<InsightKind, number>;
  notes: string[]; // 데이터가 모자라 셀 수 없는 규칙의 사유
}

/** 전역 ID(합쳐진 노드 포함) → 원래 업무잇다 항목 */
export function originIds(d: Derived, view: any, gids: string[]) {
  const workIds = new Set<string>();
  const userIds = new Set<string>();
  for (const gid of gids) {
    const n = view.getNode(gid);
    for (const g of [gid, ...(n?.merged_from || [])]) {
      const o = d.origin.get(g);
      if (o?.kind === 'work') workIds.add(o.id);
      else if (o?.kind === 'user') userIds.add(o.id);
    }
  }
  return { workIds: [...workIds], userIds: [...userIds] };
}

/**
 * 범위(내 지도·팀 지도) 안의 인계 위험. asOf: YYYY-MM-DD.
 * 문서에서 온 할 일은 빼고(업무만) 센다 — 지도 위험 점검과 같은 기준.
 */
export function handoverInsights(s: AppState, scope: MapScope, asOf: string): InsightResult {
  const counts: Record<InsightKind, number> = { solo: 0, bottleneck: 0, sole_person: 0, dense: 0, gap: 0 };
  if (!s.works.length) return { items: [], counts, notes: ['업무가 없어 셀 수 없습니다'] };
  const d = deriveMap(s, scope, undefined, { actions: false });
  const view = buildView(d.doc, d.resolve);
  const items: RuleInsight[] = [];
  const notes: string[] = [];
  const push = (kind: InsightKind, level: Insight['level'], key: string, title: string, detail: string, evidence: string[]) => {
    const ids = originIds(d, view, evidence);
    // 지도 밖(다른 팀 사람만 근거) 같은 경우에도 업무 하나는 있어야 화면에서 갈 곳이 생긴다
    items.push({ id: `${kind}:${key}`, kind, level, title, detail, ...ids, evidence });
    counts[kind] += 1;
  };

  const c = knowledgeConcentration(view, { asOf });
  if (c.insufficient) notes.push(`${INSIGHT_NAMES.solo}: ${c.reason}`);
  for (const it of c.items) {
    const ids = originIds(d, view, [it.work.gid]);
    const has = it.handover_events + it.handover_docs > 0;
    push('solo', it.level === 'high' ? 'high' : 'low', ids.workIds[0] ?? it.work.gid, it.work.label, `${it.person.label}만 해 본 업무 · 인계 기록 ${has ? '있음' : '없음'}${it.new_owner ? ` · 새로 맡음(${it.new_owner})` : ''}`, it.evidence);
  }

  const r = ripple(view, { asOf });
  if (r.insufficient) notes.push(`${INSIGHT_NAMES.bottleneck}: ${r.reason}`);
  for (const it of r.works) {
    push('bottleneck', it.count >= 2 ? 'mid' : 'low', it.work.gid, it.work.label, `늦어지면 이어진 업무 ${it.count}개가 함께 늦어짐 — ${it.path.text}`, it.evidence);
  }
  for (const it of r.people) {
    const ids = originIds(d, view, [it.person.gid]);
    push('sole_person', it.count >= 2 ? 'high' : 'mid', ids.userIds[0] ?? it.person.gid, it.person.label, `혼자 맡은 업무 ${it.sole_works}개 · 빠지면 이어진 업무 ${it.count}개가 함께 막힘`, it.evidence);
  }

  const g = densityGaps(view, { asOf, n: DENSE_N });
  if (g.status === 'insufficient') notes.push(`${INSIGHT_NAMES.dense}·${INSIGHT_NAMES.gap}: ${g.reason}`);
  for (const p of g.dense || []) {
    push('dense', p.count >= DENSE_N + 2 ? 'high' : 'mid', p.gid, p.label, `지금 맡은 업무 ${p.count}개(기준 ${g.n}개 이상): ${p.works.slice(0, 3).map((w: any) => `「${w.label}」`).join(', ')}${p.works.length > 3 ? ` 외 ${p.works.length - 3}개` : ''}`, p.evidence_ids);
  }
  for (const w of g.gaps || []) {
    const why =
      w.kind === 'scheduled' ? `${w.next_person?.label ?? '다음 담당'}이(가) ${w.next_start}부터 맡을 예정` : w.kind === 'ended' ? `이전 담당 ${w.last_person?.label ?? ''}(${w.last_end}까지) 뒤로 담당 없음` : '담당 기록 없음';
    push('gap', w.kind === 'scheduled' ? 'low' : 'high', w.gid, w.label, why, w.evidence_ids);
  }

  // 내 지도: 「이 지도 밖」으로 그린 남의 업무는 담당 연결 없이 그려져 공백·혼자로 잘못 셀 수 있다 → 내 업무·나에 관한 것만 남긴다
  let out = items;
  if (scope.kind === 'mine') {
    const mineIds = new Set(s.works.filter((w) => w.owners.includes(scope.userId)).map((w) => w.id));
    out = items.filter((x) => (x.kind === 'dense' || x.kind === 'sole_person' ? x.userIds[0] === scope.userId : mineIds.has(x.workIds[0])));
    for (const k of Object.keys(counts) as InsightKind[]) counts[k] = out.filter((x) => x.kind === k).length;
  }
  // 조직 지도: 다른 조직의 상위·관련 업무를 「이 지도 밖」으로 그리므로 같은 이유로 이 조직(아래 포함) 업무·사람 것만 남긴다
  if (scope.kind === 'org') {
    const ids = new Set(worksInScope(s, scope).map((w) => w.id));
    const names = subtreeNames(effectiveOrgs(s), scope.orgId);
    const member = (u?: string) => !!u && names.has(s.users.find((y) => y.id === u)?.dept ?? '');
    out = items.filter((x) => (x.kind === 'dense' || x.kind === 'sole_person' ? member(x.userIds[0]) || x.workIds.some((w) => ids.has(w)) : ids.has(x.workIds[0])));
    for (const k of Object.keys(counts) as InsightKind[]) counts[k] = out.filter((x) => x.kind === k).length;
  }
  const rank = { high: 0, mid: 1, low: 2 };
  out.sort((a, b) => rank[a.level] - rank[b.level]);
  return { items: out, counts, notes };
}

/** 업무잇다 업무·사람 ID → 지도 전역 ID(Claude 인사이트 근거를 지도에서 강조할 때). 지도는 같은 범위로 파생(업무·사람 노드 ID는 할 일 표시와 무관하게 같다) */
export function evidenceGids(s: AppState, scope: MapScope, workIds: string[], userIds: string[]): string[] {
  const d = deriveMap(s, scope, undefined, { actions: false });
  const out: string[] = [];
  for (const [gid, o] of d.origin) if ((o.kind === 'work' && workIds.includes(o.id)) || (o.kind === 'user' && userIds.includes(o.id))) out.push(gid);
  return out;
}

/** 사람 이름을 붙인 짧은 요약(대시보드 카드 머리) */
export function insightSummary(r: InsightResult): string {
  const parts = (Object.keys(INSIGHT_NAMES) as InsightKind[]).filter((k) => r.counts[k] > 0).map((k) => `${INSIGHT_NAMES[k]} ${r.counts[k]}`);
  return parts.length ? parts.join(' · ') : '찾은 위험 없음';
}
