// 인계 위험 인사이트(업무 유니버스 규칙을 업무잇다 데이터에). 지도 위험 판·대시보드가 함께 쓴다.
// 유니버스 규칙(app/src/rules/insight-risk.js·insight.js)을 그대로 부르고, 결과의 근거 항목(전역 ID)을 업무잇다 업무·사람 ID로 되돌린다.
// 인계 준비도(6항목)는 넣지 않았다: 표준 양식 항목이 업무잇다 「필수 항목 미작성」 점검과 겹치고, 진행 중 메모를 미해결 이슈로 세어 잡음이 많다.
// 브라우저 기능을 쓰지 않는다(vitest로 검증).
import type { AppState, User, Work } from '../lib/types';
import { deriveMap, worksInScope, type Derived, type MapScope } from './derive';
import { effectiveOrgs, subtreeNames } from '../lib/orgs';
import { isLeft } from '../lib/people';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { handoverReadiness, knowledgeConcentration, ripple } from '../../../app/src/rules/insight-risk.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { densityGaps, similarExperts } from '../../../app/src/rules/insight.js';

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
  gap: '지금 담당자가 없는 업무. 담당자가 전출·퇴직한 업무도 여기에 올라옴',
};
/** 인계 후보로 보여 줄 사람 수 */
export const CANDIDATE_SHOW = 2;
/** 「빠지면 함께 막히는」 업무 이름을 적을 개수(나머지는 「외 n개」) */
export const BLOCKED_SHOW = 3;
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
  blockedWorkIds?: string[]; // 빠지면 함께 막히는 업무(빠지면 함께 막히는 사람)
  next?: string; // 다음 행동 한 줄(예: 「인계 후보: 최민서(비슷한 일 경험)」). 후보가 없으면 없음
  readiness?: { score: number; total: number }; // 인계 준비도 낮음 항목의 점수
}

/** 이름 목록을 「A」, 「B」, 「C」 외 n개 꼴로 */
export function namesText(names: string[], show = BLOCKED_SHOW): string {
  const shown = names.slice(0, show).map((x) => `「${x}」`).join(', ');
  return names.length > show ? `${shown} 외 ${names.length - show}개` : shown;
}

export interface Candidate {
  userId: string;
  name: string;
  direct: boolean; // 그 업무를 이전에 맡아 본 사람
}
const candidateText = (list: Candidate[]) => (list.length ? `인계 후보: ${list.map((c) => `${c.name}(${c.direct ? '이전 담당' : '비슷한 일 경험'})`).join(', ')}` : undefined);

/** 지도 업무 항목의 전역 ID ← 업무잇다 업무 ID */
function workGids(d: Derived, view: any): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of view.nodes as any[]) {
    if (n.core_type !== 'work' || n.hidden) continue;
    const w = originIds(d, view, [n.gid]).workIds[0];
    if (w && !m.has(w)) m.set(w, n.gid);
  }
  return m;
}

/** 업무들을 이어받을 후보(유사 경험자 규칙). 전출·퇴직한 사람과 exclude는 뺀다 */
function candidatesFor(s: AppState, d: Derived, view: any, gids: string[], asOf: string, exclude: string[] = []): Candidate[] {
  if (!gids.length) return [];
  const r = similarExperts(view, { works: gids, asOf });
  if (r.status !== 'ok') return [];
  const out: Candidate[] = [];
  const add = (p: any, direct: boolean) => {
    const userId = originIds(d, view, [p.gid]).userIds[0];
    if (!userId || exclude.includes(userId) || out.some((x) => x.userId === userId)) return;
    const u = s.users.find((x) => x.id === userId);
    if (!u || isLeft(u)) return;
    out.push({ userId, name: u.name, direct });
  };
  for (const p of r.direct as any[]) add(p, true);
  const directIds = new Set((r.direct as any[]).map((p) => p.gid));
  for (const p of r.people as any[]) if (!directIds.has(p.gid)) add(p, false);
  return out.slice(0, CANDIDATE_SHOW);
}

/** 이 사람이 빠지면 지금 담당이 비는 업무(진행 중이고, 이 사람 말고 재직 중인 담당이 없음) */
export function soleWorksOf(s: AppState, userId: string) {
  return s.works.filter((w) => w.status !== '완료' && w.owners.includes(userId) && !w.owners.some((o) => o !== userId && !isLeft(s.users.find((u) => u.id === o))));
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

  // 업무별 인계 준비도(6점 만점) — 사람 항목에 가장 낮은 업무의 점수를 붙인다
  const rd = handoverReadiness(view, { asOf });
  const readyOf = new Map<string, { score: number; total: number }>();
  for (const it of (rd.items ?? []) as any[]) {
    const wid = originIds(d, view, [it.work.gid]).workIds[0];
    if (wid) readyOf.set(wid, { score: it.score, total: it.total });
  }
  const lowestReadiness = (ws: Work[]) => ws.map((w) => readyOf.get(w.id)).filter((x): x is { score: number; total: number } => !!x).sort((a, b) => a.score - b.score)[0] ?? null;

  const r = ripple(view, { asOf });
  if (r.insufficient) notes.push(`${INSIGHT_NAMES.bottleneck}: ${r.reason}`);
  for (const it of r.works) {
    push('bottleneck', it.count >= 2 ? 'mid' : 'low', it.work.gid, it.work.label, `늦어지면 이어진 업무 ${it.count}개가 함께 늦어짐 — ${it.path.text}`, it.evidence);
  }
  for (const it of r.people) {
    const ids = originIds(d, view, [it.person.gid]);
    const blocked = originIds(d, view, it.reached as string[]).workIds;
    const names = blocked.map((id) => s.works.find((w) => w.id === id)?.name).filter((x): x is string => !!x);
    const userId = ids.userIds[0];
    const low = userId ? lowestReadiness(soleWorksOf(s, userId)) : null;
    push('sole_person', it.count >= 2 ? 'high' : 'mid', userId ?? it.person.gid, it.person.label, `혼자 맡은 업무 ${it.sole_works}개 · 빠지면 ${names.length ? `${namesText(names)} 업무가` : `이어진 업무 ${it.count}개가`} 함께 막힘${low ? ` · 인계 준비 최저 ${low.score}/${low.total}` : ''}`, it.evidence);
    if (low) items[items.length - 1].readiness = low;
    items[items.length - 1].blockedWorkIds = blocked;
  }

  const g = densityGaps(view, { asOf, n: DENSE_N });
  if (g.status === 'insufficient') notes.push(`${INSIGHT_NAMES.dense}·${INSIGHT_NAMES.gap}: ${g.reason}`);
  for (const p of g.dense || []) {
    push('dense', p.count >= DENSE_N + 2 ? 'high' : 'mid', p.gid, p.label, `지금 맡은 업무 ${p.count}개(기준 ${g.n}개 이상): ${p.works.slice(0, 3).map((w: any) => `「${w.label}」`).join(', ')}${p.works.length > 3 ? ` 외 ${p.works.length - 3}개` : ''}`, p.evidence_ids);
  }
  for (const w of g.gaps || []) {
    const wid = originIds(d, view, [w.gid]).workIds[0];
    const left = (s.works.find((x) => x.id === wid)?.owners ?? []).map((o) => s.users.find((u) => u.id === o)).filter((u) => isLeft(u));
    const why =
      w.kind !== 'scheduled' && left.length ? `담당자 ${left.map((u) => u!.name).join('·')} 전출·퇴직 — 지금 담당이 없음` : w.kind === 'scheduled' ? `${w.next_person?.label ?? '다음 담당'}이(가) ${w.next_start}부터 맡을 예정` : w.kind === 'ended' ? `이전 담당 ${w.last_person?.label ?? ''}(${w.last_end}까지) 뒤로 담당 없음` : '담당 기록 없음';
    push('gap', w.kind === 'scheduled' ? 'low' : 'high', w.gid, w.label, why, w.evidence_ids);
  }

  // 다음 행동: 사람·업무 위험 항목에 인계 후보 한 줄(유사 경험자 규칙, 후보가 없으면 붙이지 않는다)
  const gidOf = workGids(d, view);
  for (const x of items) {
    if (x.kind !== 'solo' && x.kind !== 'gap' && x.kind !== 'sole_person' && x.kind !== 'dense') continue;
    const person = x.kind === 'sole_person' || x.kind === 'dense' ? x.userIds[0] : undefined;
    const ws = person ? (x.kind === 'dense' ? s.works.filter((w) => w.status !== '완료' && w.owners.includes(person)) : soleWorksOf(s, person)) : x.workIds.slice(0, 1).map((id) => s.works.find((w) => w.id === id)!).filter(Boolean);
    const gids = ws.map((w) => gidOf.get(w.id)).filter((g): g is string => !!g);
    x.next = candidateText(candidatesFor(s, d, view, gids, asOf, person ? [person] : []));
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

/** 위험 업무 수(서로 다른 업무)와 항목 수. 한 업무가 여러 항목에 걸리므로 둘을 따로 센다(처음 사용 점검 M-8) */
export function riskTotals(items: Insight[]): { works: number; items: number; high: number } {
  const ws = new Set<string>();
  for (const x of items) for (const w of x.kind === 'sole_person' || x.kind === 'dense' ? x.workIds : x.workIds.slice(0, 1)) ws.add(w);
  return { works: ws.size, items: items.length, high: items.filter((x) => x.level === 'high').length };
}

/** 대시보드 카드 머리: 위험 업무 n건(항목 m개) + 종류별 항목 수 */
export function insightSummary(r: InsightResult): string {
  const t = riskTotals(r.items);
  const parts = (Object.keys(INSIGHT_NAMES) as InsightKind[]).filter((k) => r.counts[k] > 0).map((k) => `${INSIGHT_NAMES[k]} ${r.counts[k]}`);
  return parts.length ? `위험 업무 ${t.works}건(항목 ${t.items}개) · ${parts.join(' · ')}` : '찾은 위험 없음';
}

export interface PersonImpact {
  user: User;
  left: boolean;
  works: Work[]; // 지금 맡은 진행 중 업무
  soleWorks: Work[]; // 이 사람이 빠지면 담당이 비는 업무
  blocked: Work[]; // 빠지면 함께 막히는 업무(혼자 맡은 업무에서 선후행·산출물로 이어진 업무)
  candidates: Candidate[]; // 인계 후보(유사 경험자 규칙)
  readiness: { work: Work; score: number; total: number }[]; // 맡은 업무의 인계 준비도(6점 만점)
}

/** 선후행(precedes)·산출물 참조(produces→references)로 이어진 업무 사슬. 업무 유니버스 ripple 규칙과 같은 연결(그 규칙은 상위 5명만 돌려줘 사람 하나를 물을 때는 직접 센다) */
function reachFrom(view: any, starts: string[]): string[] {
  const isKind = (g: string, k: string) => {
    const n = view.getNode(g);
    return !!n && n.core_type === k && !n.hidden;
  };
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b);
  };
  const producers = new Map<string, string[]>();
  const referrers = new Map<string, string[]>();
  for (const e of view.edges as any[]) {
    if (e.hidden) continue;
    if (e.core_type === 'precedes' && isKind(e.source, 'work') && isKind(e.target, 'work')) add(e.source, e.target);
    else if (e.core_type === 'produces' && isKind(e.source, 'work') && isKind(e.target, 'artifact')) producers.set(e.target, [...(producers.get(e.target) ?? []), e.source]);
    else if (e.core_type === 'references' && isKind(e.source, 'work') && isKind(e.target, 'artifact')) referrers.set(e.target, [...(referrers.get(e.target) ?? []), e.source]);
  }
  for (const [a, ws] of producers) for (const w of ws) for (const x of referrers.get(a) ?? []) add(w, x);
  const seen = new Set(starts);
  const queue = [...starts];
  const out: string[] = [];
  for (let i = 0; i < queue.length; i += 1) {
    for (const to of adj.get(queue[i]) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
      out.push(to);
    }
  }
  return out;
}

/** 사람 한 명이 빠지면(또는 이미 빠졌으면) 무엇이 막히는가 — 회사 전체 지도 기준. 규칙 검색·대시보드가 쓴다 */
export function personImpact(s: AppState, userId: string, asOf: string): PersonImpact | null {
  const user = s.users.find((u) => u.id === userId);
  if (!user) return null;
  const works = s.works.filter((w) => w.status !== '완료' && w.owners.includes(userId));
  const soleWorks = soleWorksOf(s, userId);
  const base = { user, left: isLeft(user), works, soleWorks };
  if (!works.length) return { ...base, blocked: [], candidates: [], readiness: [] };
  const d = deriveMap(s, { kind: 'all' }, undefined, { actions: false });
  const view = buildView(d.doc, d.resolve);
  const gidOf = workGids(d, view);
  const gidsOf = (ws: Work[]) => ws.map((w) => gidOf.get(w.id)).filter((g): g is string => !!g);
  const own = new Set(soleWorks.map((w) => w.id));
  const blockedIds = new Set(originIds(d, view, reachFrom(view, gidsOf(soleWorks))).workIds.filter((id) => !own.has(id)));
  const blocked = s.works.filter((w) => blockedIds.has(w.id));
  const candidates = candidatesFor(s, d, view, gidsOf(soleWorks.length ? soleWorks : works), asOf, [userId]);
  const rd = handoverReadiness(view, { asOf });
  const readiness: PersonImpact['readiness'] = [];
  for (const it of (rd.items ?? []) as any[]) {
    const id = originIds(d, view, [it.work.gid]).workIds[0];
    const w = works.find((x) => x.id === id);
    if (w) readiness.push({ work: w, score: it.score, total: it.total });
  }
  return { ...base, blocked, candidates, readiness };
}
