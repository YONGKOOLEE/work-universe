// RV10C-4 성능: 연결·메모 색인으로 고친 handoverReadiness·formReport·mergePlan이 옛 판과 결과가 1비트도 다르지 않은지(동등성),
// 업무 3000개에서도 제때 끝나는지. RV10C-3: 사번이 바뀐 자동 연결이 통합 확인 목록에 다시 오르는지.
// 옛 판은 고치기 직전(2026-10-25) app/src의 함수를 그대로 복사한 것이다. 고치지 않는다 — 새 판과 달라지면 새 판이 틀린 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { PREGEN } from '../app/data/pregen.js';
import { buildView, refGid } from '../app/src/view/view.js';
import { edgeStatus, periodStatus } from '../app/src/view/describe.js';
import { SUBTYPE_HANDOVER_DOC, SUBTYPE_ROLE, normalizeEmpNo, normalizeLabel, pairKey } from '../app/src/model/schema.js';
import { josa } from '../app/src/model/josa.js';
import { STANDARD_FORM } from '../app/src/rules/form.js';
import { formReport, workFormMissing } from '../app/src/rules/form.js';
import { READINESS_ITEMS, RISK, handoverReadiness } from '../app/src/rules/insight-risk.js';
import { hasCautionMemo } from '../app/src/rules/handover.js';
import { openMemos, memoTarget } from '../app/src/rules/issues.js';
import { GENERIC_ARTIFACT_TYPES, WEIGHTS, tokensOf } from '../app/src/rules/insight.js';
import { WORK_CANDIDATE_LIMIT, mergePlan } from '../app/src/merge/merge.js';
import { decideIdentity } from '../app/src/model/commands.js';
import { mkDoc, mkNode, mkEdge } from './helpers.js';

// ════════ 옛 판(고치기 전 그대로) ════════
const nonEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const normEmp = (v) => normalizeEmpNo(v);
function workFormMissingOld(view, workGid) {
  const work = view.getNode(view.canonical(workGid));
  if (!work || work.core_type !== 'work' || work.hidden) return null;
  const attrs = work.attrs || {};
  const missing = [];
  if (!nonEmpty(work.description)) missing.push(STANDARD_FORM.description);
  for (const k of STANDARD_FORM.workAttrs) {
    // 주의사항은 속성 말고 주의사항 범주 메모도 인정한다 — 인수인계 초안이 그 메모를 주의사항 근거로 쓰기 때문(D8-4)
    if (k === '주의사항' && hasCautionMemo(view, work.gid)) continue;
    if (!nonEmpty(attrs[k])) missing.push(k);
  }

  const edges = view.edges.filter((e) => !e.hidden);
  const hasDoc = nonEmpty(attrs[STANDARD_FORM.relatedDocAttr])
    || edges.some((e) => {
      if (!['produces', 'references'].includes(e.core_type)) return false;
      const other = e.source === work.gid ? e.target : e.target === work.gid ? e.source : null;
      const n = other && view.getNode(other);
      return !!n && !n.hidden && n.core_type === 'artifact';
    });
  if (!hasDoc) missing.push(STANDARD_FORM.relatedDocAttr);

  const hasPerformer = edges.some((e) => e.core_type === 'performs' && e.target === work.gid && view.getNode(e.source)?.core_type === 'person' && !view.getNode(e.source).hidden);
  if (!hasPerformer) missing.push(STANDARD_FORM.performer);
  return missing;
}

/**
 * 합성 뷰 전체의 표준 양식 점검(가져오기 미리 보기·제출 전 샘플 점검용).
 * @returns {{total:number, incomplete:number, works:{gid:string,label:string,universe_name?:string,missing:string[]}[]}}
 */
function formReportOld(view) {
  const works = [];
  let total = 0;
  for (const n of view.nodes) {
    if (n.core_type !== 'work' || n.hidden) continue;
    total += 1;
    const missing = workFormMissingOld(view, n.gid);
    if (missing && missing.length) works.push({ gid: n.gid, label: n.label, universe_name: n.universe_name, missing });
  }
  return { total, incomplete: works.length, works };
}


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
  for (const e of view.edges) {
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


// 업무의 인수인계 근거: 기준일까지의 handover 이력, 업무가 산출한 인수인계서
function handoverBasis(view, work, asOf) {
  const events = (view.index.eventsByNode.get(work.gid) || []).filter((ev) => ev.type === 'handover' && ev.occurred_at <= asOf && view.canonical(refGid(ev.universe_id, ev.payload.work_id)) === work.gid);
  const docs = [];
  for (const e of view.edges) {
    if (!live(e) || e.core_type !== 'produces' || e.source !== work.gid) continue;
    const a = view.getNode(e.target);
    if (a && !a.hidden && a.core_type === 'artifact' && a.subtype === SUBTYPE_HANDOVER_DOC && !docs.includes(a.gid)) docs.push(a.gid);
  }
  return { events: events.map((e) => e.gid), docs };
}


function handoverReadinessOld(view, { asOf }) {
  const works = activeWorks(view, asOf);
  if (works.length === 0) return { status: 'insufficient', insufficient: true, reason: '기준일에 진행 중인 업무가 없어 준비도를 셀 수 없습니다', items: [] };
  const asOfDay = dayNum(asOf);
  const memos = view.events.filter((ev) => ev.type === 'memo' && ev.occurred_at <= asOf);
  const open = openMemos(view, { memos });
  const items = works.map((w) => {
    const formMissing = workFormMissingOld(view, w.gid) || [];
    const issues = open.filter((ev) => memoTarget(view, ev) === w.gid);
    const artifacts = view.edges.filter((e) => live(e) && e.core_type === 'produces' && e.source === w.gid && view.getNode(e.target)?.core_type === 'artifact' && !view.getNode(e.target).hidden);
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


function mergePlanOld(view, links = []) {
  // 판정·중복은 대표 노드(합쳐진 노드) 기준으로 본다 — 같은 사람이 여러 유니버스에 있어도 한 번만 묻는다
  const canon = (g) => view.canonical(g);
  // 지금 문서의 판정 + 묶인 아래층 문서의 판정(위층이 다시 묻지 않는다, 여섯 번째 검토 C-4)
  const allLinks = [...links, ...(view.decided_links || [])];
  const decided = new Map(allLinks.filter((l) => l.status !== 'pending').map((l) => [pairKey(canon(l.a), canon(l.b)), l.status]));
  const isDecided = (a, b) => decided.has(pairKey(canon(a), canon(b)));
  const asked = new Set();
  const once = (a, b) => { const k = pairKey(canon(a), canon(b)); if (asked.has(k)) return false; asked.add(k); return true; };
  const sameNow = (a, b) => view.canonical(a) === view.canonical(b);
  const raw = (view.raw_nodes || []).filter((n) => !n.hidden && n.universe_id !== view.universe_id);
  const uname = (n) => n.universe_name;

  // ── 사람 ──
  const persons = raw.filter((n) => n.core_type === 'person' && n.subtype !== SUBTYPE_ROLE);
  const auto = [];
  const personItems = [];
  const byEmp = new Map();
  for (const p of persons) {
    if (!p.emp_no) continue;
    const k = normEmp(p.emp_no);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k).push(p);
  }
  for (const [emp, list] of byEmp) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const [x, y] = [list[i], list[j]];
        if (x.universe_id === y.universe_id || sameNow(x.gid, y.gid) || isDecided(x.gid, y.gid)) continue;
        if (!once(x.gid, y.gid)) continue;
        if (normalizeLabel(x.label) === normalizeLabel(y.label)) {
          auto.push({ kind: 'person', a: x.gid, b: y.gid, method: 'emp_no_auto', status: 'confirmed', reason: `사번 ${emp}, 이름 ${x.label}${josa(x.label, '이/가')} 같음` });
        } else {
          personItems.push({
            type: 'conflict', kind: 'person', a: x.gid, b: y.gid,
            title: `사번 충돌: ${emp}`,
            reason: `사번 ${emp}가 같은데 이름이 다릅니다 — ${x.label}(${uname(x)}) / ${y.label}(${uname(y)}). 같은 사람인지 확인이 필요합니다.`,
            evidence_ids: [x.gid, y.gid],
          });
        }
      }
    }
  }
  const paired = new Set(); // 이미 쌍 항목에 든 사람은 "혼자" 항목을 또 만들지 않는다(여섯 번째 검토 C-9)
  for (const p of persons.filter((x) => !x.emp_no)) {
    const same = persons.filter((q) => q !== p && q.universe_id !== p.universe_id && normalizeLabel(q.label) === normalizeLabel(p.label) && !sameNow(p.gid, q.gid) && !isDecided(p.gid, q.gid) && once(p.gid, q.gid));
    if (same.length) {
      for (const q of same) {
        paired.add(p.gid).add(q.gid);
        personItems.push({ type: 'no_empno', kind: 'person', a: p.gid, b: q.gid, title: `사번 없음: ${p.label}`, reason: `${p.label}(${uname(p)})은 사번이 없습니다. 이름이 같은 ${q.label}(${uname(q)}${q.emp_no ? `, ${q.emp_no}` : ''})과 같은 사람인지 확인이 필요합니다.`, evidence_ids: [p.gid, q.gid] });
      }
    } else if (!paired.has(p.gid) && !allLinks.some((l) => l.a === p.gid || l.b === p.gid)) {
      personItems.push({ type: 'no_empno', kind: 'person', a: p.gid, b: null, title: `사번 없음: ${p.label}`, reason: `${p.label}(${uname(p)})은 사번이 없어 다른 업무 지도의 사람과 자동으로 잇지 않았습니다. 같은 사람이 있다면 사번을 넣거나 직접 연결해 주세요.`, evidence_ids: [p.gid] });
    }
  }

  // ── 업무 후보 ──
  const profile = (w) => {
    const c = view.canonical(w.gid);
    const topics = new Map();
    const types = new Map();
    for (const e of view.edges) {
      if (e.hidden || e.source !== c) continue;
      const t = view.getNode(e.target);
      if (!t || t.hidden) continue;
      if (e.core_type === 'relates_to' && t.core_type === 'topic') topics.set(normalizeLabel(t.label), t);
      if (e.core_type === 'produces' && t.core_type === 'artifact' && t.subtype && !GENERIC_ARTIFACT_TYPES.has(t.subtype)) types.set(t.subtype, t);
    }
    return { topics, types, tokens: tokensOf(w.label) };
  };
  // 합쳐진 업무는 품은 노드들의 유니버스를 모두 자기 유니버스로 본다(같은 유니버스 업무와 짝짓지 않게)
  const universesOf = new Map();
  for (const n of raw.filter((x) => x.core_type === 'work')) {
    const c = view.canonical(n.gid);
    if (!universesOf.has(c)) universesOf.set(c, new Set());
    universesOf.get(c).add(n.universe_id);
  }
  const works = [];
  const seen = new Set();
  for (const w of raw.filter((n) => n.core_type === 'work')) {
    const c = view.canonical(w.gid);
    if (seen.has(c)) continue;
    seen.add(c);
    works.push({ node: view.getNode(c) || w, gid: c, universe_id: w.universe_id, prof: profile(w) });
  }
  const candidates = [];
  for (let i = 0; i < works.length; i += 1) {
    for (let j = i + 1; j < works.length; j += 1) {
      const [x, y] = [works[i], works[j]];
      if ([...universesOf.get(x.gid)].some((u) => universesOf.get(y.gid).has(u)) || isDecided(x.gid, y.gid)) continue;
      const topics = [...x.prof.topics.keys()].filter((k) => y.prof.topics.has(k));
      const types = [...x.prof.types.keys()].filter((k) => y.prof.types.has(k));
      const tokens = [...x.prof.tokens].filter((t) => y.prof.tokens.has(t));
      const score = WEIGHTS.topic * topics.length + WEIGHTS.artifactType * types.length + WEIGHTS.token * tokens.length;
      if (score <= 0) continue;
      const why = [
        ...topics.map((k) => `같은 주제 「${x.prof.topics.get(k).label}」`),
        ...types.map((k) => `같은 산출물 유형 「${k}」`),
        ...(tokens.length ? [`이름에 같은 낱말 「${tokens.join('·')}」`] : []),
      ];
      const evidence = [x.gid, y.gid, ...topics.flatMap((k) => [x.prof.topics.get(k).gid, y.prof.topics.get(k).gid]), ...types.flatMap((k) => [x.prof.types.get(k).gid, y.prof.types.get(k).gid])];
      candidates.push({
        type: 'work_candidate', kind: 'work', a: x.gid, b: y.gid, score,
        title: `「${x.node.label}」(${x.node.universe_name}) ↔ 「${y.node.label}」(${y.node.universe_name})`,
        reason: `${why.join(', ')}. 같은 업무인지 사람이 확인합니다.`,
        evidence_ids: [...new Set(evidence)],
      });
    }
  }
  candidates.sort((p, q) => q.score - p.score || p.title.localeCompare(q.title));
  const shown = candidates.slice(0, WORK_CANDIDATE_LIMIT);

  return {
    auto,
    persons: personItems,
    works: shown,
    hidden_candidates: candidates.length - shown.length,
    counts: { auto: auto.length, persons: personItems.length, works: shown.length, pending: personItems.length + shown.length },
  };
}

// ════════ 옛 판 끝 ════════

// ── 씨앗 있는 무작위 ──
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['정산', '월말', '점검', '보고', '예산', '승인', '구매', '계약', '교육', '감사', '업무', '관리'];
const NAMES = ['가나', '나다', '다라', '라마', '마바', '바사'];
const TOPICS = ['예산', '인사', '구매', '보안', '교육'];
const ARTIFACT_TYPES = [undefined, '보고서', '양식', SUBTYPE_HANDOVER_DOC, '지침'];
const T0 = '2026-09-01T00:00:00+09:00';

/** 자식 유니버스 문서 하나(업무·사람·주제·산출물·연결·이력). 이름 풀이 좁아 유니버스 사이에 같은 이름·주제가 겹친다 */
function genDoc(uid, nWorks, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const chance = (p) => r() < p;
  const nodes = [];
  const edges = [];
  const events = [];
  const n = (id, type, label, extra = {}) => { nodes.push(mkNode(id, type, label, extra)); return id; };
  const e = (s, t, c, extra = {}) => edges.push(mkEdge(s, t, c, extra));
  const topics = TOPICS.filter(() => chance(0.7)).map((t, i) => n(`T${i}`, 'topic', `${t} 주제`, chance(0.05) ? { hidden: true } : {}));
  const people = NAMES.map((nm, i) => n(`P${i}`, 'person', nm, {
    ...(chance(0.6) ? { emp_no: `V-${1000 + Math.floor(r() * 5)}` } : {}),
    ...(chance(0.1) ? { subtype: SUBTYPE_ROLE } : {}),
    ...(chance(0.05) ? { hidden: true } : {}),
  }));
  const arts = Array.from({ length: Math.max(2, Math.floor(nWorks / 2)) }, (_, i) => {
    const st = pick(ARTIFACT_TYPES);
    return n(`A${i}`, 'artifact', `문서 ${i}`, { ...(st ? { subtype: st } : {}), ...(chance(0.05) ? { hidden: true } : {}) });
  });
  const works = [];
  for (let i = 0; i < nWorks; i += 1) {
    const label = `${pick(WORDS)} ${pick(WORDS)} ${chance(0.3) ? i : ''}`.trim();
    const attrs = {};
    for (const k of ['절차', '주기', '마감', '주의사항', '관련 문서']) if (chance(0.5)) attrs[k] = chance(0.1) ? '  ' : `${k} 내용`;
    const period = chance(0.7) ? undefined : pick([{ start: '2025-01-01' }, { start: '2026-12-01' }, { start: '2024-01-01', end: '2025-06-30' }, { start: '2026-01-01', end: '2027-01-01' }]);
    const w = n(`W${i}`, 'work', label, {
      ...(chance(0.5) ? { description: '설명' } : {}), attrs, ...(period ? { period } : {}), ...(chance(0.06) ? { hidden: true } : {}),
    });
    works.push(w);
    e('N-000', w, 'contains');
    for (const t of topics) if (chance(0.25)) e(w, t, 'relates_to', chance(0.1) ? { hidden: true } : {});
    for (const a of arts) {
      if (chance(0.15)) e(w, a, 'produces', chance(0.1) ? { hidden: true } : {});
      else if (chance(0.15)) e(w, a, 'references');
    }
    for (const p of people) {
      if (!chance(0.25)) continue;
      const per = chance(0.5) ? undefined : pick([{ start: '2025-01-01' }, { start: '2026-12-01' }, { start: '2024-01-01', end: '2025-06-30' }, { start: '2026-01-01' }]);
      e(p, w, 'performs', { ...(per ? { period: per } : {}), ...(chance(0.08) ? { hidden: true } : {}) });
    }
    if (i > 0 && chance(0.4)) e(works[i - 1], w, 'precedes');
    if (i > 0 && chance(0.15)) e(works[i - 1], w, 'contains'); // 업무 아래 업무(범위 따라 내려가기)
  }
  let ev = 0;
  const addEv = (type, payload, extra = {}) => {
    ev += 1;
    events.push({ id: `E-${ev}`, type, occurred_at: `2026-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`, recorded_at: T0, source: 'user', payload, ...extra });
  };
  const memoIds = [];
  for (let i = 0; i < nWorks * 2; i += 1) {
    const cat = pick(['issue', 'caution', 'in_progress', 'resolved', 'issue']);
    const payload = { category: cat };
    if (chance(0.8)) payload.target_id = pick(works);
    if (chance(0.3) && topics.length) payload.topic_ids = [pick(topics)];
    if (cat === 'resolved' && memoIds.length && chance(0.5)) payload.resolves_id = pick(memoIds);
    addEv('memo', payload, { note: `메모 ${i}` });
    memoIds.push(`E-${ev}`);
  }
  for (let i = 0; i < Math.floor(nWorks / 2); i += 1) {
    if (people.length > 1) addEv('handover', { work_id: pick(works), from_person_id: people[0], to_person_id: people[1] });
  }
  return mkDoc(uid, nodes, edges, events);
}

/** 부모 유니버스(자식 참조 + 사람이 판정한 연결 몇 개) */
function genWorld(seed, kids = 3, perKid = 8) {
  const r = rng(seed);
  const docs = Array.from({ length: kids }, (_, i) => genDoc(`U-K${i}`, perKid, r));
  const links = [];
  let li = 0;
  for (let t = 0; t < 12; t += 1) {
    const [ka, kb] = [Math.floor(r() * kids), Math.floor(r() * kids)];
    if (ka === kb) continue;
    const kind = r() < 0.5 ? 'work' : 'person';
    const pre = kind === 'work' ? 'W' : 'P';
    const cnt = kind === 'work' ? perKid : NAMES.length;
    const status = ['confirmed', 'rejected', 'pending'][Math.floor(r() * 3)];
    li += 1;
    links.push({ id: `I-${li}`, a: `U-K${ka}/${pre}${Math.floor(r() * cnt)}`, b: `U-K${kb}/${pre}${Math.floor(r() * cnt)}`, kind, method: 'human', status, ...(status === 'pending' ? {} : { decided_by: '시험', decided_at: T0 }) });
  }
  const parent = mkDoc('U-PARENT', [], [], [], { refs: docs.map((d) => ({ child_universe_id: d.universe.id, added_at: T0 })), identity_links: links });
  const byId = new Map([...docs, parent].map((d) => [d.universe.id, d]));
  return { parent, docs, view: buildView(parent, (id) => byId.get(id) || null), links };
}

const same = (a, b, msg) => {
  assert.equal(JSON.stringify(a), JSON.stringify(b), msg); // 키 순서까지 같아야 한다
  assert.deepEqual(a, b, msg);
};

// ════════ 동등성 ════════
test('RV10C-4 동등성: formReport·workFormMissing — 무작위 세계 300개, 옛 판과 같다', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const { view, docs } = genWorld(seed, 1 + (seed % 3), 4 + (seed % 9));
    same(formReport(view), formReportOld(view), `seed ${seed}`);
    for (const w of view.nodes.filter((x) => x.core_type === 'work')) same(workFormMissing(view, w.gid), workFormMissingOld(view, w.gid), `seed ${seed} ${w.gid}`);
    // 자식 하나만의 뷰, 그리고 엉뚱한 gid
    const solo = buildView(docs[0]);
    same(formReport(solo), formReportOld(solo));
    assert.equal(workFormMissing(solo, 'U-K0/없음'), workFormMissingOld(solo, 'U-K0/없음'));
  }
});

test('RV10C-4 동등성: handoverReadiness — 무작위 세계 300개 × 기준일 3개, 옛 판과 같다', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const { view } = genWorld(seed + 1000, 1 + (seed % 3), 4 + (seed % 9));
    for (const asOf of ['2025-03-01', '2026-10-02', '2027-02-01']) same(handoverReadiness(view, { asOf }), handoverReadinessOld(view, { asOf }), `seed ${seed} ${asOf}`);
  }
});

test('RV10C-4 동등성: mergePlan — 무작위 세계 300개(판정 연결 포함), 옛 판과 같다', () => {
  let withCandidates = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const { view, links } = genWorld(seed + 2000, 2 + (seed % 3), 3 + (seed % 12));
    const now = mergePlan(view, links);
    const old = mergePlanOld(view, links);
    same(now, old, `seed ${seed}`);
    if (now.works.length) withCandidates += 1;
    same(mergePlan(view, []), mergePlanOld(view, []), `seed ${seed} 판정 없이`);
  }
  assert.ok(withCandidates > 100, `후보가 있는 세계 ${withCandidates}개 — 시험이 의미 있으려면 많아야 한다`);
});

test('RV10C-4 동등성: 후보가 12개를 훨씬 넘고 점수·제목이 겹치는 경우(자르기·정렬 순서)', () => {
  // 모든 업무가 같은 낱말을 공유하고 라벨 몇 개만 반복 → 점수 동점·제목 동점이 많다
  const r = rng(77);
  for (let round = 0; round < 40; round += 1) {
    const kids = 3 + (round % 3);
    const docs = Array.from({ length: kids }, (_, k) => {
      const nodes = [];
      const edges = [];
      for (let i = 0; i < 15; i += 1) {
        nodes.push(mkNode(`W${i}`, 'work', `정산 ${['월말', '분기', '연말'][Math.floor(r() * 3)]} 점검`));
        edges.push(mkEdge('N-000', `W${i}`, 'contains'));
      }
      return mkDoc(`U-K${k}`, nodes, edges);
    });
    const parent = mkDoc('U-PARENT', [], [], [], { refs: docs.map((d) => ({ child_universe_id: d.universe.id, added_at: T0 })) });
    const byId = new Map([...docs, parent].map((d) => [d.universe.id, d]));
    const view = buildView(parent, (id) => byId.get(id) || null);
    const now = mergePlan(view, []);
    same(now, mergePlanOld(view, []), `round ${round}`);
    assert.equal(now.works.length, WORK_CANDIDATE_LIMIT);
    assert.ok(now.hidden_candidates > 0);
  }
});

test('RV10C-4 동등성: 내장 샘플·사전 생성 문서의 모든 뷰에서 세 함수가 옛 판과 같다', () => {
  const all = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d]));
  const asOfs = ['2026-03-01', '2026-10-02'];
  let views = 0;
  for (const d of SAMPLES) {
    const view = buildView(d, (id) => all[id] || null);
    views += 1;
    same(formReport(view), formReportOld(view), d.universe.id);
    for (const asOf of asOfs) same(handoverReadiness(view, { asOf }), handoverReadinessOld(view, { asOf }), `${d.universe.id} ${asOf}`);
    same(mergePlan(view, d.identity_links || []), mergePlanOld(view, d.identity_links || []), d.universe.id);
  }
  assert.ok(views >= 5);
  assert.ok(PREGEN && typeof PREGEN === 'object'); // 사전 생성 데이터는 규칙 입력이 아니라 초안 결과다 — 입력 문서(샘플) 쪽을 모두 비교했다
});

// ════════ 규모 ════════
function bigWorld(perKid) {
  const r = rng(5);
  const docs = Array.from({ length: 3 }, (_, i) => genDoc(`U-K${i}`, perKid, r));
  const parent = mkDoc('U-PARENT', [], [], [], { refs: docs.map((d) => ({ child_universe_id: d.universe.id, added_at: T0 })) });
  const byId = new Map([...docs, parent].map((d) => [d.universe.id, d]));
  return buildView(parent, (id) => byId.get(id) || null);
}

test('RV10C-4 규모: 업무 3000개(자식 3 × 1000)에서 세 함수가 각각 2초 안에 끝난다(옛 판은 수 초~수십 초)', { timeout: 120000 }, () => {
  const view = bigWorld(1000);
  assert.ok(view.nodes.filter((n) => n.core_type === 'work').length >= 2800);
  const timeOf = (f) => { const t = performance.now(); const out = f(); return [out, performance.now() - t]; };
  const [hr, tHr] = timeOf(() => handoverReadiness(view, { asOf: '2026-10-02' }));
  const [fr, tFr] = timeOf(() => formReport(view));
  const [mp, tMp] = timeOf(() => mergePlan(view, []));
  console.log(`  업무 3000개: handoverReadiness ${tHr.toFixed(0)}ms, formReport ${tFr.toFixed(0)}ms, mergePlan ${tMp.toFixed(0)}ms`);
  for (const [name, ms] of [['handoverReadiness', tHr], ['formReport', tFr], ['mergePlan', tMp]]) assert.ok(ms < 2000, `${name} ${ms.toFixed(0)}ms`);
  assert.equal(hr.status, 'ok');
  assert.equal(fr.total > 2000, true);
  assert.equal(mp.works.length, WORK_CANDIDATE_LIMIT);
  // 옛 판과 같은 결과: 옛 판은 3000개에서 수십 초 걸리므로 같은 만드는 법의 작은 세계(150 × 3)로 비교한다
  const small = bigWorld(150);
  same(handoverReadiness(small, { asOf: '2026-10-02' }), handoverReadinessOld(small, { asOf: '2026-10-02' }));
  same(formReport(small), formReportOld(small));
  same(mergePlan(small, []), mergePlanOld(small, []));
});

// ════════ RV10C-3: 사번이 바뀐 자동 연결 ════════
function staleWorld({ aEmp = 'V-1001', bEmp = 'V-1001', link = {} } = {}) {
  const a = mkDoc('U-A', [mkNode('P1', 'person', '가나', { emp_no: aEmp })], []);
  const b = mkDoc('U-B', [mkNode('P2', 'person', '가나', { emp_no: bEmp })], []);
  const links = [{ id: 'I-1', a: 'U-A/P1', b: 'U-B/P2', kind: 'person', method: 'emp_no_auto', status: 'confirmed', reason: '사번 V-1001', ...link }];
  const parent = mkDoc('U-P', [], [], [], { refs: [{ child_universe_id: 'U-A', added_at: T0 }, { child_universe_id: 'U-B', added_at: T0 }], identity_links: links });
  const byId = new Map([a, b, parent].map((d) => [d.universe.id, d]));
  return { parent, links, view: buildView(parent, (id) => byId.get(id) || null), byId };
}

test('RV10C-3: 사번이 그대로면 자동 연결은 합쳐져 있고 확인 목록에 오르지 않는다', () => {
  const { view, links } = staleWorld();
  assert.deepEqual(view.stale_links, []);
  assert.equal(view.canonical('U-A/P1'), view.canonical('U-B/P2'));
  const plan = mergePlan(view, links);
  assert.deepEqual(plan.persons, []);
});

test('RV10C-3: 사번이 바뀌어 맞지 않게 된 자동 연결은 확인 목록(type stale)에 다시 오른다', () => {
  for (const [aEmp, bEmp] of [['V-1001', 'V-2002'], ['V-1001', null]]) {
    const { view, links } = staleWorld({ bEmp });
    assert.deepEqual(view.stale_links, ['I-1']);
    assert.notEqual(view.canonical('U-A/P1'), view.canonical('U-B/P2')); // 합치지 않는 것은 그대로
    assert.deepEqual(view.decided_links, []); // 판정으로 세지 않는다
    const plan = mergePlan(view, links);
    assert.equal(plan.persons.length, 1);
    const item = plan.persons[0];
    assert.deepEqual([item.type, item.kind, item.a, item.b], ['stale', 'person', 'U-A/P1', 'U-B/P2']);
    assert.match(item.title, /사번이 바뀐 연결/);
    assert.match(item.reason, /다시 확인/);
    assert.deepEqual(item.evidence_ids, ['U-A/P1', 'U-B/P2']);
    assert.equal(plan.counts.persons, 1);
    assert.equal(plan.counts.pending, 1);
    assert.ok(aEmp);
  }
});

test('RV10C-3: 같은 쌍이 「사번 없음」 항목으로 두 번 오르지 않고, 혼자 항목도 만들지 않는다', () => {
  const { view, links } = staleWorld({ bEmp: null });
  const plan = mergePlan(view, links);
  assert.deepEqual(plan.persons.map((p) => p.type), ['stale']);
});

test('RV10C-3: 사람이 다시 판정하면(같은 사람/다른 사람) 목록에서 빠진다', () => {
  for (const status of ['confirmed', 'rejected']) {
    const { parent, byId } = staleWorld({ bEmp: 'V-2002' });
    const r = decideIdentity(parent, { a: 'U-A/P1', b: 'U-B/P2', kind: 'person', status, decided_by: '시험' }, { now: T0 });
    assert.equal(r.ok, true);
    byId.set('U-P', r.doc);
    const view = buildView(r.doc, (id) => byId.get(id) || null);
    assert.deepEqual(view.stale_links, []); // human 연결은 사번과 무관
    assert.deepEqual(mergePlan(view, r.doc.identity_links).persons.filter((p) => p.type === 'stale'), []);
    assert.equal(view.canonical('U-A/P1') === view.canonical('U-B/P2'), status === 'confirmed');
  }
});

test('RV10C-3: 숨기거나 지운 사람이 낀 stale 연결은 올리지 않는다', () => {
  const { parent, byId } = staleWorld({ bEmp: 'V-2002' });
  const b = byId.get('U-B');
  const hiddenB = { ...b, nodes: b.nodes.map((n) => (n.id === 'P2' ? { ...n, hidden: true } : n)) };
  byId.set('U-B', hiddenB);
  const view = buildView(parent, (id) => byId.get(id) || null);
  assert.deepEqual(mergePlan(view, parent.identity_links).persons, []);
});
