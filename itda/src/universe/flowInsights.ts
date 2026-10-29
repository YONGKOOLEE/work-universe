// 업무 흐름·반복 인사이트(업무 유니버스 규칙을 업무잇다 데이터에). 인계 위험(insights.ts)과 같은 방식으로 규칙을 그대로 부르고 근거를 업무잇다 ID로 되돌린다.
//   인계 사슬(handover_chain)·같은 주제 반복(topic_repeat): app/src/rules/insight.js repeatInefficiency
//   인계 준비도 낮음(low_readiness): app/src/rules/insight-risk.js handoverReadiness
//   유사 경험자(similar): app/src/rules/insight.js similarExperts — 업무마다
// 그리고 키 없이 계산하는 「한눈에」 한 줄(overview). AI를 쓰지 않는다. 브라우저 기능을 쓰지 않는다(vitest로 검증).
import type { AppState } from '../lib/types';
import { deriveMap, worksInScope, type MapScope, type UDoc } from './derive';
import { originIds, type FlowInsight, type FlowKind, type Insight, type InsightResult } from './insights';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { handoverReadiness } from '../../../app/src/rules/insight-risk.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { repeatInefficiency, similarExperts } from '../../../app/src/rules/insight.js';

export const FLOW_KINDS: FlowKind[] = ['handover_chain', 'topic_repeat', 'low_readiness', 'similar'];
export const FLOW_NAMES: Record<FlowKind, string> = {
  handover_chain: '인계 사슬',
  topic_repeat: '같은 주제 반복',
  low_readiness: '인계 준비도 낮음',
  similar: '유사 경험자',
};
export const FLOW_HELP: Record<FlowKind, string> = {
  handover_chain: '같은 업무가 두 번 이상 인계됨. 앞 인계 내용을 이어받았는지 확인할 업무',
  topic_repeat: '같은 주제가 서로 다른 업무 여러 곳의 진행 사항에 되풀이됨. 따로 하면 중복·어긋남이 생길 수 있음',
  low_readiness: '인계에 필요한 6가지(양식·미해결 이슈·문서·현재 담당·인계 이력·최근 이력) 중 채워진 것이 적은 진행 중 업무',
  similar: '이 업무와 같은 주제·문서 유형의 일을 해 본 사람. 직접 해 본 이전 담당이 있으면 맨 앞',
};
export const FLOW_GROUP_NAME = '업무 흐름·반복';
/** 인계 준비도가 이 값 이하(6점 만점)면 「낮음」. 바꾸기 쉬운 곳 하나 */
export const READINESS_LOW = 2;
/** 유사 경험자로 보여 줄 사람 수 */
export const SIMILAR_SHOW = 3;

export interface FlowResult {
  items: FlowInsight[];
  counts: Record<FlowKind, number>;
  notes: string[];
}

const SEP = ' · ';

/** 범위(내 지도·조직·전체) 안의 업무 흐름·반복. asOf: YYYY-MM-DD. 문서에서 온 할 일은 뺀다(인계 위험과 같은 기준) */
export function flowInsights(s: AppState, scope: MapScope, asOf: string): FlowResult {
  const counts: Record<FlowKind, number> = { handover_chain: 0, topic_repeat: 0, low_readiness: 0, similar: 0 };
  if (!s.works.length) return { items: [], counts, notes: ['업무가 없어 셀 수 없습니다'] };
  const d = deriveMap(s, scope, undefined, { actions: false });
  // 업무잇다의 진행 사항 메모에는 주제가 따로 없고 주제는 업무에 달려 있다 → 메모에 그 업무의 주제를 붙여 같은 주제 반복을 센다
  // (조직·전체 지도는 조직마다 문서가 따로이므로 문서마다 붙인다)
  const docs = new Map<string, UDoc>();
  for (const [uid, src] of d.docs) {
    const topicsOf = new Map<string, string[]>();
    for (const e of src.edges) {
      if (e.core_type !== 'relates_to') continue;
      const t = src.nodes.find((n) => n.id === e.target);
      if (t?.core_type === 'topic') topicsOf.set(e.source, [...(topicsOf.get(e.source) ?? []), t.id]);
    }
    docs.set(uid, { ...src, events: src.events.map((ev) => (ev.type === 'memo' && ev.payload.target_id ? { ...ev, payload: { ...ev.payload, topic_ids: topicsOf.get(String(ev.payload.target_id)) ?? [] } } : ev)) });
  }
  const view = buildView(docs.get(d.doc.universe.id) ?? d.doc, (id: string) => docs.get(id) ?? null);
  const inScope = new Set(worksInScope(s, scope).map((w) => w.id));
  const items: FlowInsight[] = [];
  const notes: string[] = [];
  const wid = (gid: string): string | undefined => originIds(d, view, [gid]).workIds[0];
  const push = (kind: FlowKind, level: Insight['level'], key: string, title: string, detail: string, evidence: string[]) => {
    const ids = originIds(d, view, evidence);
    // 근거 업무가 범위 밖이면 뺀다(내 지도: 내 업무만, 조직 지도: 그 조직 업무만)
    if (!ids.workIds.some((w) => inScope.has(w))) return;
    items.push({ id: `${kind}:${key}`, kind, level, title, detail, ...ids, evidence });
    counts[kind] += 1;
  };

  const rep = repeatInefficiency(view, { asOf });
  if (rep.status === 'insufficient') notes.push(`${FLOW_NAMES.handover_chain}·${FLOW_NAMES.topic_repeat}: ${rep.reason}`);
  for (const p of rep.patterns as any[]) {
    if (p.kind === 'handover_chain') {
      const w = wid(p.work.gid);
      if (!w || !inScope.has(w)) continue;
      const steps = (p.steps as any[]).map((x) => String(x.text).split(' (인수인계서')[0]).join(' / ');
      push('handover_chain', p.missed >= 2 ? 'high' : 'mid', w, p.work.label, `${p.total}번 인계됨 — ${steps}. 앞 인계 내용을 이어받았는지 확인 필요`, [p.work.gid]);
    } else if (p.kind === 'topic_repeat') {
      const works = (p.works as any[]).map((x) => ({ gid: x.gid as string, label: x.label as string, id: wid(x.gid) })).filter((x) => x.id && inScope.has(x.id));
      if (works.length < 2) continue;
      const shown = works.slice(0, 4).map((x) => `「${x.label}」`).join(', ');
      push('topic_repeat', works.length >= 5 ? 'mid' : 'low', p.topic.label, `주제 「${p.topic.label}」`, `${works.length}개 업무의 진행 사항에 되풀이됨: ${shown}${works.length > 4 ? ` 외 ${works.length - 4}개` : ''}`, [...works.map((x) => x.gid), ...p.topic.gids]);
    }
  }

  const rd = handoverReadiness(view, { asOf });
  if (rd.insufficient) notes.push(`${FLOW_NAMES.low_readiness}: ${rd.reason}`);
  for (const it of rd.items as any[]) {
    if (it.score > READINESS_LOW) continue;
    push('low_readiness', it.score <= 1 ? 'high' : 'mid', wid(it.work.gid) ?? it.work.gid, it.work.label, `인계 준비 ${it.score}/${it.total} — 빠진 것: ${it.missing.map((m: any) => m.label).join(', ')}`, [it.work.gid]);
  }

  for (const n of view.nodes as any[]) {
    if (n.core_type !== 'work' || n.hidden) continue;
    const w = wid(n.gid);
    if (!w || !inScope.has(w)) continue;
    const r = similarExperts(view, { works: [n.gid], asOf });
    if (r.status !== 'ok') continue;
    const direct = (r.direct as any[]).slice(0, SIMILAR_SHOW);
    const directIds = new Set((r.direct as any[]).map((p) => p.gid));
    const like = (r.people as any[]).filter((p) => !directIds.has(p.gid)).slice(0, SIMILAR_SHOW);
    if (!direct.length && !like.length) continue;
    const parts = [
      direct.length ? `직접 해 본 이전 담당: ${direct.map((p) => p.label).join(', ')}` : '',
      like.length ? `비슷한 일을 해 본 사람: ${like.map((p) => p.label).join(', ')}` : '',
    ].filter(Boolean);
    push('similar', direct.length ? 'mid' : 'low', w, n.label, parts.join(SEP), [n.gid, ...direct.map((p) => p.gid), ...like.map((p) => p.gid)]);
  }

  const rank = { high: 0, mid: 1, low: 2 };
  items.sort((a, b) => rank[a.level] - rank[b.level]);
  return { items, counts, notes };
}

// ── 한눈에(AI 없이 계산하는 한 줄) ─────────────────────────────────────────

export interface Overview {
  works: number;
  high: number; // 높은 위험(인계 위험 + 업무 흐름·반복)
  people: { name: string; count: number }[]; // 가장 많은 업무를 맡은 사람(1명)
  topics: { name: string; count: number }[]; // 업무에 가장 많이 걸린 주제(2개 업무 이상, 최대 2)
  agencies: { name: string; count: number }[]; // 가장 많은 업무가 걸린 외부기관(2개 업무 이상, 최대 2)
  text: string;
}
const UNKNOWN_AGENCY = /별도\s*확인|미입력|^-$/;
const agencyName = (t: string) => String(t || '').replace(/\s*\((?:시연용 )?가상[^)]*\)\s*$/, '').trim();

function topN(m: Map<string, Set<string>>, n: number, min: number) {
  return [...m.entries()]
    .map(([name, ids]) => ({ name, count: ids.size }))
    .filter((x) => x.count >= min)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))
    .slice(0, n);
}
const bump = (m: Map<string, Set<string>>, k: string, id: string) => {
  if (!k) return;
  if (!m.has(k)) m.set(k, new Set());
  m.get(k)!.add(id);
};

/** 범위의 「한눈에」 한 줄: 업무 수·높은 위험·가장 많이 걸린 사람/주제/외부기관. 같은 입력이면 같은 결과 */
export function overview(s: AppState, scope: MapScope, risk: InsightResult, flow: FlowResult): Overview {
  const works = worksInScope(s, scope);
  const byUser = new Map<string, Set<string>>();
  const byTopic = new Map<string, Set<string>>();
  const byAgency = new Map<string, Set<string>>();
  for (const w of works) {
    for (const u of w.owners) bump(byUser, s.users.find((x) => x.id === u)?.name ?? u, w.id);
    for (const t of w.topics || []) bump(byTopic, String(t).trim(), w.id);
    for (const p of w.partners || []) bump(byAgency, agencyName(p.name), w.id);
    const ag = agencyName(w.agency || '');
    if (ag && !UNKNOWN_AGENCY.test(ag)) bump(byAgency, ag, w.id);
  }
  const high = [...risk.items, ...flow.items].filter((x) => x.level === 'high').length;
  const people = topN(byUser, 1, 1);
  const topics = topN(byTopic, 2, 2);
  const agencies = topN(byAgency, 2, 2);
  const fmt = (l: { name: string; count: number }[]) => l.map((x) => `${x.name}(${x.count}개)`).join(', ');
  const parts = [`업무 ${works.length}개`, `높은 위험 ${high}건`];
  if (people.length) parts.push(`가장 많이 맡은 사람 ${fmt(people)}`);
  if (topics.length) parts.push(`가장 많이 걸린 주제 ${fmt(topics)}`);
  if (agencies.length) parts.push(`가장 많이 걸린 외부기관 ${fmt(agencies)}`);
  return { works: works.length, high, people, topics, agencies, text: parts.join(SEP) };
}
