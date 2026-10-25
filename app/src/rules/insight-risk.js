// 인수인계 위험 인사이트(CR-14 B, R-26, D-31). 순수 함수이며 view(합성 뷰)만 입력으로 받는다(12.7 rules). LLM 없이 규칙으로 계산한다.
//   ① 지식 집중 위험 — 업무를 해 본 사람이 한 명뿐인데 인수인계 기록이 없는 업무
//   ② 인수인계 준비도 — 업무마다 6항목 충족 수(n/6)와 빠진 항목
//   ③ 파급 영향 — 선후행·산출→참조를 따라 닿는 업무 수(길목 업무), 혼자 맡은 사람이 빠질 때 함께 막히는 업무 수
// 모든 결과에 근거 노드·이력 ID가 붙는다. 데이터가 모자라면 결론 없이 insufficient와 사유만 돌려준다.
// 묶은 지도(통합 반영 view)에서도 같은 방식으로 동작한다(canonical은 view가 이미 적용한 끝점을 그대로 쓴다).

import { edgeStatus, periodStatus } from '../view/describe.js';
import { refGid } from '../view/view.js';
import { SUBTYPE_HANDOVER_DOC, SUBTYPE_ROLE } from '../model/schema.js';
import { josa } from '../model/josa.js';
import { edgeIndex, workFormMissing } from './form.js';
import { openMemos, memoTarget } from './issues.js';

/** 바꾸기 쉬운 상수 한 곳(CR-14 8절 C14-4·C14-5) */
export const RISK = { RECENT_DAYS: 180, TOP_WORKS: 5, TOP_PEOPLE: 5, NEW_OWNER_DAYS: 30 }; // NEW_OWNER_DAYS: 담당 시작이 기준일에서 이 일수 안이면 「새로 맡음」 표시(CR-18 D-7, 표시만 — 세는 규칙은 그대로)

/** 준비도 항목 키와 화면 이름(이 순서로 보인다) */
export const READINESS_ITEMS = [
  { key: 'form', label: '표준 양식 권장 항목' },
  { key: 'noOpenIssues', label: '미해결 이슈 없음' },
  { key: 'hasArtifact', label: '산출물 연결' },
  { key: 'hasCurrent', label: '현재 담당자' },
  { key: 'hasHandover', label: '인수인계 이력 또는 인수인계서' },
  { key: 'recent', label: `최근 ${RISK.RECENT_DAYS}일 이내 이력` },
];

const live = (e) => !e.hidden;
const uniq = (ids) => [...new Set(ids)];
const dayNum = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};

// 활성 업무: 숨기지 않았고 업무 자체의 기간이 기준일에 진행 중인 것(밀집·공백과 같은 기준)
function activeWorks(view, asOf) {
  return view.nodes.filter((n) => n.core_type === 'work' && !n.hidden && periodStatus(n.period, asOf) === 'current');
}

const isRole = (n) => n.subtype === SUBTYPE_ROLE;

// 업무에 이어진 수행 연결의 사람(숨김 제외). 아직 시작하지 않은 담당은 경험이 아니라 뺀다
function performers(view, workGid, asOf) {
  const people = new Map(); // gid → {node, current}
  let any = false;
  for (const e of edgeIndex(view).byTarget.get(workGid) || []) {
    if (!live(e) || e.core_type !== 'performs' || e.target !== workGid) continue;
    const p = view.getNode(e.source);
    if (!p || p.hidden || p.core_type !== 'person') continue;
    any = true;
    const st = edgeStatus(view, e, asOf); // M5·M7: 담당을 넘긴 날 끝나는 쪽은 current가 아니다
    if (st === 'scheduled') continue;
    const cur = people.get(p.gid) || { node: p, current: false, start: undefined };
    if (st === 'current') cur.current = true;
    // 가장 이른 담당 시작일(시작일이 없는 연결이 하나라도 있으면 null = 언제부터인지 모름). D-7 「새로 맡음」 표시에만 쓴다
    const start = e.period && e.period.start ? e.period.start : null;
    cur.start = cur.start === undefined ? start : (cur.start === null || start === null ? null : (start < cur.start ? start : cur.start));
    people.set(p.gid, cur);
  }
  return { any, people };
}

// D-7: 지금 담당 중이고 가장 이른 담당 시작일이 기준일에서 NEW_OWNER_DAYS일 안이면 그 날짜, 아니면 null
export function newOwnerStart(entry, asOf) {
  if (!entry || !entry.current || !entry.start || !/^\d{4}-\d{2}-\d{2}/.test(entry.start)) return null;
  const start = entry.start.slice(0, 10);
  const age = dayNum(asOf) - dayNum(start);
  return age >= 0 && age <= RISK.NEW_OWNER_DAYS ? start : null;
}

/** D-7 표시 글: 「혼자만 아는 일」 항목에 붙인다. 높음(인수인계 기록 없음)이면 줄이는 방법까지, 주의(이미 기록 있음)이면 사실만. 해당 없으면 '' */
export function newOwnerText(item) {
  if (!item || !item.new_owner) return '';
  return item.level === 'high' ? `새로 맡음(시작 ${item.new_owner}) — 인수인계 기록을 남기면 줄어듭니다` : `새로 맡음(시작 ${item.new_owner})`;
}

// 업무의 인수인계 근거: 기준일까지의 handover 이력, 업무가 산출한 인수인계서
function handoverBasis(view, work, asOf) {
  const events = (view.index.eventsByNode.get(work.gid) || []).filter((ev) => ev.type === 'handover' && ev.occurred_at <= asOf && view.canonical(refGid(ev.universe_id, ev.payload.work_id)) === work.gid);
  const docs = [];
  for (const e of edgeIndex(view).bySource.get(work.gid) || []) {
    if (!live(e) || e.core_type !== 'produces' || e.source !== work.gid) continue;
    const a = view.getNode(e.target);
    if (a && !a.hidden && a.core_type === 'artifact' && a.subtype === SUBTYPE_HANDOVER_DOC && !docs.includes(a.gid)) docs.push(a.gid);
  }
  return { events: events.map((e) => e.gid), docs };
}

// ── ① 지식 집중 위험 ───────────────────────────────────────────────────────

/**
 * level: high(해 본 사람 1명 + 인수인계 기록 없음) | caution(1명이지만 인수인계 기록 있음).
 * counts: 업무 수와 해 본 사람 수별 분류(unknown: 수행 연결 없음, role_only: 역할 노드만, one: 1명, many: 2명 이상)
 * @returns {{status:'ok'|'none'|'insufficient', reason:string, items:object[], counts:object, insufficient:boolean}}
 */
export function knowledgeConcentration(view, { asOf }) {
  const works = activeWorks(view, asOf);
  const counts = { works: works.length, unknown: 0, role_only: 0, one: 0, many: 0, high: 0, caution: 0 };
  const items = [];
  const unknownWorks = [];
  for (const w of works) {
    const { any, people } = performers(view, w.gid, asOf);
    if (!any) {
      counts.unknown += 1;
      unknownWorks.push(w.gid);
      continue;
    }
    const real = [...people.values()].filter((x) => !isRole(x.node));
    if (real.length === 0) {
      // 역할 노드만(또는 아직 시작 전 담당만): 사람을 알 수 없다
      if ([...people.values()].length > 0) counts.role_only += 1;
      else { counts.unknown += 1; unknownWorks.push(w.gid); }
      continue;
    }
    if (real.length >= 2) {
      counts.many += 1;
      continue;
    }
    counts.one += 1;
    const person = real[0].node;
    const basis = handoverBasis(view, w, asOf);
    const has = basis.events.length > 0 || basis.docs.length > 0;
    const level = has ? 'caution' : 'high';
    counts[level] += 1;
    items.push({
      work: { gid: w.gid, label: w.label, universe_name: w.universe_name },
      person: { gid: person.gid, label: person.label },
      level,
      new_owner: newOwnerStart(real[0], asOf), // 표시용(D-7): 최근에 담당을 맡았으면 시작일(YYYY-MM-DD), 아니면 null. 세는 숫자에는 영향 없음
      handover_events: basis.events.length,
      handover_docs: basis.docs.length,
      evidence: uniq([w.gid, person.gid, ...basis.events, ...basis.docs]),
    });
  }
  items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1) || a.work.label.localeCompare(b.work.label, 'ko') || (a.work.gid < b.work.gid ? -1 : 1));
  const base = { items, counts, unknown_works: unknownWorks };
  if (works.length === 0) return { ...base, status: 'insufficient', insufficient: true, reason: '기준일에 진행 중인 업무가 없어 지식 집중을 셀 수 없습니다' };
  // 수행 연결이 없거나 역할 이름만 있는 업무뿐이면 해 본 사람을 한 명도 알 수 없다 → 결론 없이 부족(재검증 D1)
  if (counts.unknown + counts.role_only === works.length) return { ...base, status: 'insufficient', insufficient: true, reason: counts.role_only ? '업무에 실제 사람의 담당(수행) 연결이 없어(역할 이름만 있음) 해 본 사람을 셀 수 없습니다' : '업무에 담당자(수행) 연결이 없어 해 본 사람을 셀 수 없습니다' };
  if (items.length === 0) return { ...base, status: 'none', insufficient: false, reason: '혼자만 해 본 업무가 없습니다' };
  return { ...base, status: 'ok', insufficient: false, reason: '' };
}

/** 업무 상세의 한 줄용: 높음이면 {level, person}, 아니면 null */
export function riskNoteFor(view, gid, asOf) {
  const g = view.canonical(gid);
  const w = view.getNode(g);
  if (!w || w.core_type !== 'work' || w.hidden || periodStatus(w.period, asOf) !== 'current') return null;
  const r = knowledgeConcentration(view, { asOf });
  const hit = r.items.find((x) => x.work.gid === w.gid && x.level === 'high');
  return hit ? { level: hit.level, person: hit.person, evidence: hit.evidence } : null;
}

// ── ② 인수인계 준비도 ──────────────────────────────────────────────────────

/**
 * 업무마다 6항목 충족 수. 낮은 순(같으면 업무 이름 순).
 * @returns {{status:'ok'|'insufficient', reason:string, items:{work:object, flags:object, score:number, total:number, missing:{key:string,label:string,detail:string,evidence:string[]}[]}[], insufficient:boolean}}
 */
export function handoverReadiness(view, { asOf }) {
  const works = activeWorks(view, asOf);
  if (works.length === 0) return { status: 'insufficient', insufficient: true, reason: '기준일에 진행 중인 업무가 없어 준비도를 셀 수 없습니다', items: [] };
  const asOfDay = dayNum(asOf);
  const memos = view.events.filter((ev) => ev.type === 'memo' && ev.occurred_at <= asOf);
  const open = openMemos(view, { memos });
  // 미해결 메모를 대상별로 한 번만 묶는다(업무마다 전체를 훑지 않게, RV10C-4). 묶음 안 순서는 open의 순서 그대로
  const openByTarget = new Map();
  for (const ev of open) {
    const t = memoTarget(view, ev);
    const list = openByTarget.get(t);
    if (list) list.push(ev);
    else openByTarget.set(t, [ev]);
  }
  const bySource = edgeIndex(view).bySource;
  const items = works.map((w) => {
    const formMissing = workFormMissing(view, w.gid) || [];
    const issues = openByTarget.get(w.gid) || [];
    const artifacts = (bySource.get(w.gid) || []).filter((e) => live(e) && e.core_type === 'produces' && view.getNode(e.target)?.core_type === 'artifact' && !view.getNode(e.target).hidden);
    const { people } = performers(view, w.gid, asOf);
    const currents = [...people.values()].filter((x) => x.current && !isRole(x.node));
    const roleOnlyNow = currents.length === 0 && [...people.values()].some((x) => x.current && isRole(x.node));
    const basis = handoverBasis(view, w, asOf);
    const evs = (view.index.eventsByNode.get(w.gid) || []).filter((ev) => ev.occurred_at <= asOf);
    const recentEvs = evs.filter((ev) => asOfDay - dayNum(ev.occurred_at) <= RISK.RECENT_DAYS);
    const lastEv = evs[evs.length - 1];
    const flags = {
      form: formMissing.length === 0,
      noOpenIssues: issues.length === 0,
      hasArtifact: artifacts.length > 0,
      hasCurrent: currents.length > 0,
      hasHandover: basis.events.length > 0 || basis.docs.length > 0,
      recent: recentEvs.length > 0,
    };
    const detail = {
      form: formMissing.length ? `비어 있는 권장 항목: ${formMissing.join(', ')}` : '',
      noOpenIssues: `미해결 이슈 ${issues.length}건`,
      hasArtifact: '이 업무가 산출한 문서 연결이 없음',
      hasCurrent: roleOnlyNow ? '역할 이름만 있고 담당 중인 실제 사람이 없음' : '기준일에 담당 중인 사람이 없음',
      hasHandover: '인수인계 이력도 인수인계서도 없음',
      recent: lastEv ? `마지막 이력 ${String(lastEv.occurred_at).slice(0, 10)} (기준일보다 ${asOfDay - dayNum(lastEv.occurred_at)}일 전)` : '기준일까지의 이력이 없음',
    };
    const evidence = {
      form: [w.gid],
      noOpenIssues: issues.map((ev) => ev.gid),
      hasArtifact: [w.gid],
      hasCurrent: [w.gid],
      hasHandover: [w.gid],
      recent: lastEv ? [w.gid, lastEv.gid] : [w.gid],
    };
    const missing = READINESS_ITEMS.filter((it) => !flags[it.key]).map((it) => ({ key: it.key, label: it.label, detail: detail[it.key], evidence: evidence[it.key] }));
    return {
      work: { gid: w.gid, label: w.label, universe_name: w.universe_name },
      flags,
      score: READINESS_ITEMS.length - missing.length,
      total: READINESS_ITEMS.length,
      missing,
      evidence: uniq([w.gid, ...missing.flatMap((m) => m.evidence)]),
    };
  });
  items.sort((a, b) => a.score - b.score || a.work.label.localeCompare(b.work.label, 'ko') || (a.work.gid < b.work.gid ? -1 : 1));
  return { status: 'ok', insufficient: false, reason: '', items };
}

// ── ③ 파급 영향 ────────────────────────────────────────────────────────────

// 의존 그래프: w → x. 선후행 precedes(w → x), 그리고 w가 산출한 문서 a를 x가 참조(w produces a, x references a)
function dependencyGraph(view) {
  const isWork = (gid) => { const n = view.getNode(gid); return !!n && n.core_type === 'work' && !n.hidden; };
  const isArtifact = (gid) => { const n = view.getNode(gid); return !!n && n.core_type === 'artifact' && !n.hidden; };
  const adj = new Map(); // w → [{to, via}]
  const add = (from, to, via) => {
    if (from === to) return;
    if (!adj.has(from)) adj.set(from, []);
    if (!adj.get(from).some((h) => h.to === to && h.via === via)) adj.get(from).push({ to, via });
  };
  const producers = new Map();
  const referrers = new Map();
  for (const e of view.edges) {
    if (!live(e)) continue;
    if (e.core_type === 'precedes' && isWork(e.source) && isWork(e.target)) add(e.source, e.target, null);
    else if (e.core_type === 'produces' && isWork(e.source) && isArtifact(e.target)) (producers.get(e.target) || producers.set(e.target, []).get(e.target)).push(e.source);
    else if (e.core_type === 'references' && isWork(e.source) && isArtifact(e.target)) (referrers.get(e.target) || referrers.set(e.target, []).get(e.target)).push(e.source);
  }
  for (const [a, ws] of producers) for (const w of ws) for (const x of referrers.get(a) || []) add(w, x, a);
  for (const list of adj.values()) list.sort((p, q) => (p.to < q.to ? -1 : p.to > q.to ? 1 : (p.via || '') < (q.via || '') ? -1 : 1));
  return adj;
}

// w에서 닿는 업무(자기 제외)와 각 업무까지의 최단 경로. 순환에 안전하다
function reach(adj, start) {
  const prev = new Map([[start, null]]);
  const dist = new Map([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i += 1) {
    const cur = queue[i];
    for (const { to, via } of adj.get(cur) || []) {
      if (prev.has(to)) continue;
      prev.set(to, { from: cur, via });
      dist.set(to, dist.get(cur) + 1);
      queue.push(to);
    }
  }
  return { prev, dist, reached: queue.slice(1) };
}

function pathTo(prev, target) {
  const steps = [];
  for (let cur = target; prev.get(cur); cur = prev.get(cur).from) steps.unshift({ to: cur, via: prev.get(cur).via });
  return steps;
}

/**
 * @returns {{status:'ok'|'none'|'insufficient', reason:string, insufficient:boolean, edges:number, works:object[], people:object[]}}
 *   works: 닿는 업무 수 많은 순 상위 TOP_WORKS(길목 업무). people: 기준일에 혼자 현재 담당인 업무들의 닿는 업무 합집합 수 상위 TOP_PEOPLE
 */
export function ripple(view, { asOf }) {
  const adj = dependencyGraph(view);
  const edgeCount = [...adj.values()].reduce((n, l) => n + l.length, 0);
  if (edgeCount === 0) return { status: 'insufficient', insufficient: true, reason: '업무 사이의 선후행·산출→참조 연결이 없어 파급 영향을 셀 수 없습니다', edges: 0, works: [], people: [] };
  const label = (g) => view.getNode(g).label;
  const all = new Map(); // 업무 gid → 도달 결과
  const reachOf = (g) => { if (!all.has(g)) all.set(g, reach(adj, g)); return all.get(g); };

  const rows = [];
  for (const g of adj.keys()) {
    const r = reachOf(g);
    if (r.reached.length === 0) continue;
    // 가장 먼 업무(같으면 ID 순 첫째)까지의 최단 경로를 예시로
    const far = [...r.reached].sort((a, b) => r.dist.get(b) - r.dist.get(a) || (a < b ? -1 : 1))[0];
    const steps = pathTo(r.prev, far);
    const nodes = [g, ...steps.flatMap((s) => (s.via ? [s.via, s.to] : [s.to]))];
    const pathText = steps.reduce((t, s) => `${t}${s.via ? ` →(산출물 「${label(s.via)}」)→ ` : ' → '}「${label(s.to)}」`, `「${label(g)}」`);
    rows.push({
      work: { gid: g, label: label(g), universe_name: view.getNode(g).universe_name },
      count: r.reached.length,
      reached: r.reached,
      path: { to: far, steps, text: pathText },
      evidence: uniq(nodes),
    });
  }
  rows.sort((a, b) => b.count - a.count || a.work.label.localeCompare(b.work.label, 'ko') || (a.work.gid < b.work.gid ? -1 : 1));
  const works = rows.slice(0, RISK.TOP_WORKS);

  // 사람: 기준일에 혼자 현재 담당인 업무(수행 연결의 현재 담당 사람이 정확히 1명, 역할 제외)
  const sole = new Map(); // 사람 gid → {person, works:[gid]}
  for (const w of activeWorks(view, asOf)) {
    const cur = [...performers(view, w.gid, asOf).people.values()].filter((x) => x.current && !isRole(x.node));
    if (cur.length !== 1) continue;
    const p = cur[0].node;
    if (!sole.has(p.gid)) sole.set(p.gid, { person: p, works: [] });
    sole.get(p.gid).works.push(w.gid);
  }
  const people = [];
  for (const { person, works: ws } of sole.values()) {
    const union = new Set();
    const nodes = new Set([person.gid]);
    const own = new Set(ws);
    for (const g of ws) {
      const r = reachOf(g);
      for (const x of r.reached) if (!own.has(x)) union.add(x); // 그 사람이 혼자 맡은 업무 자신은 "함께 막히는 업무"가 아니다(재검증 D2)
      if (r.reached.some((x) => !own.has(x))) nodes.add(g);
    }
    if (union.size === 0) continue;
    people.push({
      person: { gid: person.gid, label: person.label },
      sole_works: ws.length,
      count: union.size,
      reached: [...union],
      evidence: uniq([...nodes, ...union]),
    });
  }
  people.sort((a, b) => b.count - a.count || a.person.label.localeCompare(b.person.label, 'ko') || (a.person.gid < b.person.gid ? -1 : 1));
  const top = people.slice(0, RISK.TOP_PEOPLE);
  if (rows.length === 0) return { status: 'none', insufficient: false, reason: '이어서 닿는 업무가 없습니다', edges: edgeCount, works: [], people: [] };
  return { status: 'ok', insufficient: false, reason: '', edges: edgeCount, works, people: top };
}

// ── 규칙 기반 설명 문장(llm/connector.js explainInsight 요청 모양: explain.js와 같다) ──────────────
// 사전 생성 조회 키 target: risk_concentration|<유니버스 ID>, risk_readiness|<유니버스 ID>, risk_ripple|<유니버스 ID> (task는 insight_explain)

const sorted = (ids) => [...new Set(ids)].sort();

/** ① 요약 문장 요청. 높음·주의가 없으면 null */
export function concentrationExplain(result, universeId) {
  if (!result || result.status !== 'ok') return null;
  const high = result.items.filter((x) => x.level === 'high');
  const caution = result.items.filter((x) => x.level === 'caution');
  const rule = [];
  if (high.length) {
    const shown = high.slice(0, 3).map((x) => `「${x.work.label}」(${x.person.label})`).join(', ');
    rule.push({ text: `한 사람만 해 본 업무 중 인수인계 기록이 없는 업무가 ${high.length}개입니다: ${shown}${high.length > 3 ? ` 외 ${high.length - 3}개` : ''}.`, evidence_ids: sorted(high.slice(0, 3).flatMap((x) => x.evidence)) });
  }
  if (caution.length) {
    rule.push({ text: `한 사람만 해 봤지만 인수인계 기록이 있는 업무가 ${caution.length}개입니다.`, evidence_ids: sorted(caution.slice(0, 3).flatMap((x) => x.evidence)) });
  }
  return { target: `risk_concentration|${universeId}`, evidence_ids: sorted(rule.flatMap((s) => s.evidence_ids)), rule };
}

/** ② 요약 문장 요청 */
export function readinessExplain(result, universeId) {
  if (!result || result.status !== 'ok' || result.items.length === 0) return null;
  const total = result.items.length;
  const full = result.items.filter((x) => x.score === x.total).length;
  const lows = result.items.filter((x) => x.score < x.total).slice(0, 3);
  const rule = [];
  rule.push({ text: `업무 ${total}개 중 6항목을 모두 갖춘 업무는 ${full}개입니다.`, evidence_ids: sorted(lows.length ? lows.map((x) => x.work.gid) : [result.items[0].work.gid]) });
  for (const x of lows) {
    rule.push({ text: `「${x.work.label}」 ${x.score}/${x.total} — 빠진 항목: ${x.missing.map((m) => m.label).join(', ')}.`, evidence_ids: sorted(x.evidence) });
  }
  return { target: `risk_readiness|${universeId}`, evidence_ids: sorted(rule.flatMap((s) => s.evidence_ids)), rule };
}

/** ③ 요약 문장 요청 */
export function rippleExplain(result, universeId) {
  if (!result || result.status !== 'ok') return null;
  const rule = [];
  const w = result.works[0];
  if (w) rule.push({ text: `가장 많은 업무에 닿는 길목 업무: 「${w.work.label}」(${w.count}개 업무에 이어짐). 예: ${w.path.text}.`, evidence_ids: sorted(w.evidence) });
  const p = result.people[0];
  if (p) rule.push({ text: `${p.person.label}${josa(p.person.label, '이/가')} 혼자 맡은 업무 ${p.sole_works}개가 막히면 ${p.count}개 업무가 함께 영향을 받습니다.`, evidence_ids: sorted(p.evidence) });
  if (!rule.length) return null;
  return { target: `risk_ripple|${universeId}`, evidence_ids: sorted(rule.flatMap((s) => s.evidence_ids)), rule };
}
