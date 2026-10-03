// 인사이트 규칙(D-08, R-05). 순수 함수이며 view(합성 뷰)만 입력으로 받는다(12.7 rules). LLM 없이 계산한다.
// T-08: 유사 경험자. 선택한 업무와 주제·산출물 유형·라벨 토큰을 공유하는 "다른 업무"를 찾아 점수화하고,
// 그 업무를 수행한 사람을 점수순으로 돌려준다. 현재 담당자는 제외한다. 근거 ID(공유 주제·업무 노드)를 함께 돌려준다.

import { periodStatus, periodText } from '../view/describe.js';
import { refGid } from '../view/view.js';
import { SUBTYPE_HANDOVER_DOC, normalizeLabel, memoCategoryOf } from '../model/schema.js';
import { lastInput } from './flow.js';

// 점수 가중치(D-08에 수치가 없어 정함): 주제 3, 산출물 유형 2, 라벨 토큰 1
export const WEIGHTS = { topic: 3, artifactType: 2, token: 1 };
const STOP_TOKENS = new Set(['업무', '관리', '처리', '확인']);
// 어떤 업무든 인계할 때 생기는 산출물 유형은 업무가 비슷하다는 근거가 아니다(T-13에서 발견, 결정 D3-3: 뺌)
export const GENERIC_ARTIFACT_TYPES = new Set([SUBTYPE_HANDOVER_DOC]);

const live = (e) => !e.hidden;

// 라벨 토큰: 공백·구두점으로 나눈 2자 이상 낱말(흔한 낱말 제외). 통합 업무 후보(merge)도 같은 토큰·가중치를 쓴다(검토5 C-6)
export function tokensOf(label) {
  return new Set(
    normalizeLabel(label)
      .split(/[\s·,.()/\-_]+/)
      .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t)),
  );
}

/** 이 날짜에 담당 중인가: 시작 전이 아니고, 끝이 없거나 끝이 그날 이후 */
export function isCurrent(period, asOf) {
  return periodStatus(period, asOf) === 'current';
}

// 업무 하나의 비교 기준: 주제(대표 노드·이름), 산출물 유형(하위 유형 이름), 라벨 토큰
function profileOf(view, work) {
  const topics = [];
  const artifactTypes = new Map(); // 하위 유형 이름 → 산출물 노드 gid들
  let hasLink = false;
  for (const e of view.edges) {
    if (!live(e) || e.source !== work.gid) continue;
    const t = view.getNode(e.target);
    if (!t || t.hidden) continue;
    if (e.core_type === 'relates_to' && t.core_type === 'topic') {
      topics.push(t);
      hasLink = true;
    } else if (e.core_type === 'produces' && t.core_type === 'artifact') {
      hasLink = true;
      if (t.subtype && !GENERIC_ARTIFACT_TYPES.has(t.subtype)) {
        if (!artifactTypes.has(t.subtype)) artifactTypes.set(t.subtype, []);
        artifactTypes.get(t.subtype).push(t.gid);
      }
    }
  }
  return { work, topics, artifactTypes, tokens: tokensOf(work.label), hasLink };
}

/**
 * @param {object} view buildView 결과
 * @param {{works: string[], asOf: string, exclude?: string[]}} opts
 *   works: 기준 업무(전역 참조, 여러 개면 합쳐서 비교). asOf: 오늘 날짜(YYYY-MM-DD). exclude: 추가로 뺄 사람
 * @returns {{status:'ok'|'none'|'insufficient', reason:string, people:object[], excluded:object[], basis:object}}
 *   insufficient: 기준 업무에 주제·산출물 연결이 없어 비교할 수 없음(데이터 부족)
 *   none: 비교는 했지만 비슷한 업무를 수행한 사람이 없음
 */
export function similarExperts(view, { works, asOf, exclude = [] }) {
  const selected = [...new Set(works.map((g) => view.canonical(g)))]
    .map((g) => view.getNode(g))
    .filter((n) => n && n.core_type === 'work' && !n.hidden);
  if (selected.length === 0) return { status: 'insufficient', reason: '비교할 업무가 없습니다', people: [], excluded: [], basis: {} };
  const selectedIds = new Set(selected.map((w) => w.gid));
  const profiles = selected.map((w) => profileOf(view, w));

  // 기준: 선택한 업무들의 주제·산출물 유형·토큰 합집합
  const basisTopics = new Map(); // 정규화 이름 → {label, gids}
  const basisTypes = new Set();
  const basisTokens = new Set();
  for (const p of profiles) {
    for (const t of p.topics) {
      const key = normalizeLabel(t.label);
      if (!basisTopics.has(key)) basisTopics.set(key, { label: t.label, gids: new Set() });
      basisTopics.get(key).gids.add(t.gid);
    }
    for (const k of p.artifactTypes.keys()) basisTypes.add(k);
    for (const k of p.tokens) basisTokens.add(k);
  }
  const basis = { topics: [...basisTopics.values()].map((t) => t.label), artifactTypes: [...basisTypes], tokens: [...basisTokens] };
  if (!profiles.some((p) => p.hasLink)) {
    return { status: 'insufficient', reason: '주제나 산출물에 연결된 정보가 없어 비슷한 업무를 찾을 수 없습니다', people: [], excluded: [], basis };
  }

  // 현재 담당자(제외 대상): 기준 업무를 지금 수행 중인 사람
  const excludedGids = new Set(exclude.map((g) => view.canonical(g)));
  const excluded = [];
  for (const e of view.edges) {
    if (!live(e) || e.core_type !== 'performs' || !selectedIds.has(e.target) || !isCurrent(e.period, asOf)) continue;
    excludedGids.add(e.source);
  }
  for (const g of excludedGids) {
    const n = view.getNode(g);
    if (n) excluded.push({ gid: n.gid, label: n.label });
  }

  // 후보 업무: 기준 업무가 아닌 업무 중 주제 또는 산출물 유형을 공유하는 것
  const people = new Map();
  for (const cand of view.nodes) {
    if (cand.core_type !== 'work' || cand.hidden || selectedIds.has(cand.gid)) continue;
    const cp = profileOf(view, cand);
    // 같은 이름의 주제가 여러 노드로 붙어 있어도(연결된 것과 이름만 같은 것) 한 번만 센다. 연결 확인된 노드를 우선한다
    const byName = new Map();
    for (const t of cp.topics.filter((x) => basisTopics.has(normalizeLabel(x.label)))) {
      const key = normalizeLabel(t.label);
      const linked = basisTopics.get(key).gids.has(t.gid);
      if (!byName.has(key) || (linked && !basisTopics.get(key).gids.has(byName.get(key).gid))) byName.set(key, t);
    }
    const sharedTopics = [...byName.values()];
    const sharedTypes = [...cp.artifactTypes.keys()].filter((k) => basisTypes.has(k));
    if (sharedTopics.length === 0 && sharedTypes.length === 0) continue;
    const sharedTokens = [...cp.tokens].filter((t) => basisTokens.has(t));
    const score = WEIGHTS.topic * sharedTopics.length + WEIGHTS.artifactType * sharedTypes.length + WEIGHTS.token * sharedTokens.length;

    // 공유한 이유와 근거 ID. 이름만 같은 주제(유니버스가 달라 연결 확인 전)는 그렇다고 밝힌다
    const reasons = [];
    const evidence = [cand.gid];
    for (const t of sharedTopics) {
      const entry = basisTopics.get(normalizeLabel(t.label));
      const sameNode = entry.gids.has(t.gid);
      reasons.push(`같은 주제 「${t.label}」${sameNode ? '' : '(이름이 같은 주제, 연결 확인 전)'}`);
      evidence.push(t.gid, ...entry.gids);
    }
    for (const k of sharedTypes) {
      reasons.push(`같은 산출물 유형 「${k}」`);
      evidence.push(...cp.artifactTypes.get(k));
    }
    if (sharedTokens.length) reasons.push(`라벨에 같은 낱말 「${sharedTokens.join('·')}」`);

    for (const e of view.edges) {
      if (!live(e) || e.core_type !== 'performs' || e.target !== cand.gid || excludedGids.has(e.source)) continue;
      if (periodStatus(e.period, asOf) === 'scheduled') continue; // 아직 시작하지 않은 담당은 경험이 아니다
      const person = view.getNode(e.source);
      if (!person || person.hidden || person.core_type !== 'person') continue;
      if (!people.has(person.gid)) people.set(person.gid, { gid: person.gid, label: person.label, emp_no: person.emp_no, score: 0, works: [] });
      const entry = people.get(person.gid);
      if (entry.works.some((w) => w.gid === cand.gid)) continue; // 같은 업무를 여러 기간 맡아도 한 번만 센다
      entry.score += score;
      entry.works.push({
        gid: cand.gid,
        label: cand.label,
        universe_name: cand.universe_name,
        period: periodText(e.period, asOf),
        current: isCurrent(e.period, asOf),
        score,
        reasons,
        evidence_ids: [...new Set(evidence)],
      });
    }
  }

  const list = [...people.values()]
    .map((p) => ({ ...p, evidence_ids: [...new Set([p.gid, ...p.works.flatMap((w) => w.evidence_ids)])] }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  if (list.length === 0) {
    return { status: 'none', reason: '비슷한 업무를 수행한 사람이 없습니다', people: [], excluded, basis };
  }
  return { status: 'ok', reason: '', people: list, excluded, basis };
}

/** 결과를 문장 목록으로(인수인계 초안의 "유사 경험자" 항목, LLM 설명의 입력). 문장마다 근거 ID가 붙는다. */
export function similarSentences(result) {
  return result.people.map((p) => {
    const w = p.works[0];
    const more = p.works.length > 1 ? ` 외 ${p.works.length - 1}건` : '';
    return {
      text: `${p.label}${p.emp_no ? `(${p.emp_no})` : ''} — 「${w.label}」${w.period ? ` ${w.period}` : ''}${more} 수행. ${w.reasons.join(', ')}`,
      evidence_ids: p.evidence_ids,
    };
  });
}

// ── 반복 비효율(D-08, R-05 ⑤) ─────────────────────────────────────────────
// ① 같은 업무에서 인수인계가 2회 이상인데 이후 인수인계가 이전 인수인계서를 이어받지(참조하지) 않음
// ② 같은 주제의 메모·인수인계가 서로 다른 업무 2곳 이상에서 반복됨
// 데이터 부족: 인수인계·메모 이벤트가 2건 미만. 모든 결과에 근거 이벤트·노드 ID가 붙는다.

const eventGidIn = (ev, id) => refGid(ev.universe_id, id);
const fmtDate = (d) => d;

/**
 * 이후 인수인계가 바로 앞 인수인계를 이어받았는가(D2-6 가, 사용자 결정 2026-10-03: 바로 앞만 인정).
 * - previous_handover_id가 바로 앞 인수인계를 가리키면 이어받음
 * - 인수인계서는 가장 최근 인수인계서(바로 앞이 문서 없이 했으면 그 전의 가장 최근 문서)와 같거나 그것을 참조해야 이어받음.
 *   그보다 오래된 문서만 쓰면 중간에 쌓인 내용이 빠진 것으로 본다
 */
function continuesPrevious(view, later, earlier) {
  const prev = earlier[earlier.length - 1];
  const ref = later.payload.previous_handover_id;
  if (ref && eventGidIn(later, ref) === prev.gid) return true;
  const art = later.payload.artifact_id ? view.canonical(eventGidIn(later, later.payload.artifact_id)) : null;
  if (!art) return false;
  const lastDoc = [...earlier].reverse().find((e) => e.payload.artifact_id);
  if (!lastDoc) return false;
  const lastArt = view.canonical(eventGidIn(lastDoc, lastDoc.payload.artifact_id));
  if (art === lastArt) return true; // 같은 인수인계서를 이어서 씀
  return view.edges.some((e) => !e.hidden && e.core_type === 'references' && e.source === art && e.target === lastArt);
}

/**
 * @param {object} view buildView 결과
 * @returns {{status:'ok'|'none'|'insufficient', reason:string, last_input:string|null, patterns:object[]}}
 */
export function repeatInefficiency(view, { asOf = null } = {}) {
  // 기준일(시간 보기)이 있으면 그날까지의 기록만 본다(검토3 RULES-2)
  const relevant = view.events.filter((e) => (e.type === 'handover' || e.type === 'memo') && (!asOf || e.occurred_at <= asOf));
  const last = lastInput(view, asOf);
  if (relevant.length < 2) {
    return { status: 'insufficient', reason: '인수인계·메모 기록이 2건 미만이라 반복을 찾을 수 없습니다', last_input: last, patterns: [] };
  }
  const patterns = [];
  const workOf = (ev, id) => {
    const n = view.getNode(eventGidIn(ev, id));
    return n && n.core_type === 'work' && !n.hidden ? n : null;
  };

  // ① 인수인계가 이어지지 않는 업무
  const byWork = new Map();
  for (const ev of relevant.filter((e) => e.type === 'handover')) {
    const w = workOf(ev, ev.payload.work_id);
    if (!w) continue;
    if (!byWork.has(w.gid)) byWork.set(w.gid, { work: w, list: [] });
    byWork.get(w.gid).list.push(ev);
  }
  for (const { work, list } of byWork.values()) {
    if (list.length < 2) continue;
    const steps = list.map((ev, i) => {
      const referenced = i === 0 ? null : continuesPrevious(view, ev, list.slice(0, i));
      const art = ev.payload.artifact_id ? view.getNode(eventGidIn(ev, ev.payload.artifact_id)) : null;
      const nm = (id) => (id && view.getNode(eventGidIn(ev, id))?.label) || '(찾을 수 없는 노드)';
      const who = `${nm(ev.payload.from_person_id)} → ${nm(ev.payload.to_person_id)}`;
      const note = i === 0 ? '' : referenced ? ' — 이전 인수인계서를 이어받음' : ' — 이전 인수인계서를 이어받지 않음';
      return { event_gid: ev.gid, date: fmtDate(ev.occurred_at), referenced, text: `${ev.occurred_at} ${who}${art ? ` (인수인계서: ${art.label})` : ' (인수인계서 없음)'}${note}` };
    });
    const missed = steps.filter((s) => s.referenced === false).length;
    if (missed === 0) continue;
    patterns.push({
      kind: 'handover_chain',
      work: { gid: work.gid, label: work.label },
      total: list.length,
      missed,
      steps,
      summary: `「${work.label}」: 인수인계 ${list.length}회 중 ${missed}회가 이전 인수인계서를 이어받지 않아, 담당자가 바뀔 때마다 처음부터 다시 설명하는 패턴입니다`,
      evidence_ids: list.map((e) => e.gid),
    });
  }

  // ② 같은 주제가 여러 업무에서 반복
  const byTopic = new Map(); // 정규화 주제 이름 → {label, topics:Set, works: Map(gid → {work, events:Set})}
  const addTo = (topic, work, evGid) => {
    const key = normalizeLabel(topic.label);
    if (!byTopic.has(key)) byTopic.set(key, { label: topic.label, topics: new Set(), works: new Map() });
    const t = byTopic.get(key);
    t.topics.add(topic.gid);
    if (!t.works.has(work.gid)) t.works.set(work.gid, { work, events: new Set() });
    t.works.get(work.gid).events.add(evGid);
  };
  // 포함(contains)으로 이어진 상위–하위 업무는 한 업무로 묶어 센다(D3-32 a): 하위 업무의 기록은 상위 업무로 올린다
  // 상위가 "업무"인 포함 연결만 본다(꼭지 → 업무 연결은 묶는 근거가 아니다). 상위 업무가 여럿이면 ID순 첫째(연결 순서에 좌우되지 않게, 재검증 7)
  const parentOf = new Map();
  for (const e of view.edges) {
    if (!live(e) || e.core_type !== 'contains') continue;
    const p = view.getNode(e.source);
    if (!p || p.core_type !== 'work' || p.hidden) continue;
    if (!parentOf.has(e.target) || p.gid < parentOf.get(e.target)) parentOf.set(e.target, p.gid);
  }
  const topWork = (w) => {
    let cur = w;
    const seen = new Set([cur.gid]);
    while (parentOf.has(cur.gid)) {
      const p = view.getNode(parentOf.get(cur.gid));
      if (seen.has(p.gid)) return w; // 순환(A ⊃ B ⊃ A): 묶지 않고 원래 업무로 센다
      seen.add(p.gid);
      cur = p;
    }
    return cur;
  };
  for (const ev of relevant) {
    if (ev.type === 'memo') {
      // 주의사항·해결됨 메모는 "되풀이되는 문제"의 근거가 아니다(D3-32 b)
      if (['caution', 'resolved'].includes(memoCategoryOf(ev.payload))) continue;
      const w0 = ev.payload.target_id ? workOf(ev, ev.payload.target_id) : null;
      const w = w0 ? topWork(w0) : null;
      if (!w) continue;
      for (const id of ev.payload.topic_ids || []) {
        const t = view.getNode(eventGidIn(ev, id));
        if (t && t.core_type === 'topic' && !t.hidden) addTo(t, w, ev.gid);
      }
    } else {
      const w0 = workOf(ev, ev.payload.work_id);
      const w = w0 ? topWork(w0) : null;
      if (!w) continue;
      for (const e of view.edges) {
        if (live(e) && e.core_type === 'relates_to' && e.source === w0.gid) {
          const t = view.getNode(e.target);
          if (t && t.core_type === 'topic' && !t.hidden) addTo(t, w, ev.gid);
        }
      }
    }
  }
  for (const t of byTopic.values()) {
    if (t.works.size < 2) continue;
    const works = [...t.works.values()].map(({ work, events }) => ({ gid: work.gid, label: work.label, evidence_ids: [...events] }));
    const shown = works.slice(0, 5).map((w) => `「${w.label}」`).join(', ');
    patterns.push({
      kind: 'topic_repeat',
      topic: { label: t.label, gids: [...t.topics] },
      works,
      summary: `주제 「${t.label}」이(가) ${works.length}개 업무에서 반복됩니다: ${shown}${works.length > 5 ? ` 외 ${works.length - 5}개` : ''}`,
      evidence_ids: [...new Set([...works.flatMap((w) => w.evidence_ids), ...t.topics])],
    });
  }

  if (patterns.length === 0) {
    return { status: 'none', reason: '반복되는 패턴을 찾지 못했습니다', last_input: last, patterns: [] };
  }
  return { status: 'ok', reason: '', last_input: last, patterns };
}

// ── 밀집/공백(D-08, R-05) ────────────────────────────────────────────────
// 조직(하위 유니버스)별로 업무 수·현재 수행 인원·공백 수를 집계한다.
// 공백: 기준일에 담당자가 없는 업무. "담당 기록 없음"과 "이전 담당자만 있음"(끝난 업무일 수도 있음)을 나눠 보여 주고 판단은 사람이 한다.
// 밀집: 기준일에 한 사람이 N개 이상 업무를 맡음. N은 화면에서 조정한다(기본값 3은 사용자 결정 D-N).
// 데이터 부족: 수행 연결이 하나도 없는 유니버스(조직별로도 같은 기준).

/** 밀집 기준 N의 기본값. 결정: 3(decisions-pending D-N, 2026-10-03). 화면에서 바꿀 수 있다 */
export const DENSE_DEFAULT_N = 3;

/** 밀집 기준 N을 1 이상 정수로 맞춘다. 숫자가 아니거나 0이면 기본값 */
export const denseLimit = (n) => Math.max(1, Math.floor(Number(n) || DENSE_DEFAULT_N));

/**
 * 업무 하나의 담당 상태(업무 상세의 한 줄, 밀집·공백의 공백 판정에 같이 쓴다).
 * kind: covered(현재 담당 있음) | scheduled(시작 예정 담당자만) | ended(이전 담당자만) | never(담당 기록 없음)
 * @returns {{kind:string, current:object[], last_person:object|null, last_end:string|null, next_person:object|null, next_start:string|null, work_ended:boolean, work_scheduled:boolean, work_start:string|null}|null}
 */
export function workLoad(view, workGid, { asOf }) {
  const work = view.getNode(view.canonical(workGid));
  if (!work || work.core_type !== 'work' || work.hidden) return null;
  const edges = view.edges.filter((e) => live(e) && e.core_type === 'performs' && e.target === work.gid && view.getNode(e.source)?.core_type === 'person' && !view.getNode(e.source).hidden);
  const pick = (status) => edges.filter((e) => periodStatus(e.period, asOf) === status);
  const current = [];
  for (const e of pick('current')) {
    const p = view.getNode(e.source);
    if (!current.some((x) => x.gid === p.gid)) current.push({ gid: p.gid, label: p.label });
  }
  const past = pick('ended').sort((a, b) => (a.period.end < b.period.end ? 1 : -1));
  const next = pick('scheduled').sort((a, b) => (a.period.start > b.period.start ? 1 : -1));
  const person = (e) => (e ? { gid: view.getNode(e.source).gid, label: view.getNode(e.source).label } : null);
  return {
    kind: current.length ? 'covered' : next.length ? 'scheduled' : past.length ? 'ended' : 'never',
    current,
    last_person: person(past[0]),
    last_end: past[0]?.period.end || null,
    next_person: person(next[0]),
    next_start: next[0]?.period.start || null,
    work_ended: periodStatus(work.period, asOf) === 'ended',
    work_scheduled: periodStatus(work.period, asOf) === 'scheduled',
    work_start: work.period?.start || null,
  };
}

/** 이 노드(업무·주제)가 들어 있는 반복 비효율 패턴(상세의 한 줄용) */
export function repeatPatternsFor(view, gid, asOf = null) {
  const g = view.canonical(gid);
  return repeatInefficiency(view, { asOf }).patterns.filter((p) => p.work?.gid === g || (p.works || []).some((w) => w.gid === g) || (p.topic?.gids || []).some((t) => view.canonical(t) === g));
}

/**
 * 한 사람이 기준일에 맡은 업무(사람 상세의 한 줄용). densityGaps의 밀집 판정과 같은 기준이다.
 * @returns {{count:number, n:number, dense:boolean, works:{gid:string,label:string}[]}|null} 사람이 아니면 null
 */
export function personLoad(view, personGid, { asOf, n = DENSE_DEFAULT_N }) {
  const person = view.getNode(view.canonical(personGid));
  if (!person || person.core_type !== 'person' || person.hidden) return null;
  const works = [];
  for (const e of view.edges) {
    if (!live(e) || e.core_type !== 'performs' || e.source !== person.gid || !isCurrent(e.period, asOf)) continue;
    const w = view.getNode(e.target);
    if (!w || w.core_type !== 'work' || w.hidden || periodStatus(w.period, asOf) !== 'current' || works.some((x) => x.gid === w.gid)) continue;
    works.push({ gid: w.gid, label: w.label });
  }
  const limit = denseLimit(n);
  return { count: works.length, n: limit, dense: works.length >= limit, works };
}

/**
 * @param {object} view buildView 결과
 * @param {{asOf: string, n?: number}} opts asOf: 기준일(YYYY-MM-DD). n: 밀집 기준(1 이상 정수)
 * @returns {{status:'ok'|'none'|'insufficient', reason:string, n:number, last_input:string|null, groups:object[], gaps:object[], dense:object[], ended_works:object[], scheduled_works:object[]}}
 */
export function densityGaps(view, { asOf, n = DENSE_DEFAULT_N }) {
  const limit = denseLimit(n);
  const last = lastInput(view, asOf);
  // 활성 업무: 숨기지 않았고, 업무 자체의 기간(12.2 node.period)이 기준일 전에 끝나지 않은 업무
  const allWorks = view.nodes.filter((w) => w.core_type === 'work' && !w.hidden);
  const works = allWorks.filter((w) => periodStatus(w.period, asOf) === 'current');
  const ended = allWorks.filter((w) => periodStatus(w.period, asOf) === 'ended').length;
  const scheduledWorks = allWorks.filter((w) => periodStatus(w.period, asOf) === 'scheduled').length;
  const workIds = new Set(works.map((w) => w.gid));
  const performs = view.edges.filter((e) => live(e) && e.core_type === 'performs' && workIds.has(e.target) && view.getNode(e.source)?.core_type === 'person' && !view.getNode(e.source).hidden);
  const base = { n: limit, last_input: last, ended_works: ended, scheduled_works: scheduledWorks, groups: [], gaps: [], dense: [] };
  if (performs.length === 0) {
    // 수행 연결은 있는데 모두 기간 밖 업무로 가면 사유를 구분한다(검토3 RULES-3)
    const anyPerforms = view.edges.some((e) => live(e) && e.core_type === 'performs');
    return { ...base, status: 'insufficient', reason: anyPerforms ? '담당(수행) 연결이 기간이 끝났거나 시작 전인 업무에만 있어 밀집·공백을 셀 수 없습니다' : '업무에 담당자(수행) 연결이 없어 밀집·공백을 셀 수 없습니다' };
  }

  const byWork = new Map(works.map((w) => [w.gid, []]));
  for (const e of performs) if (byWork.has(e.target)) byWork.get(e.target).push(e);
  const currentOf = (gid) => byWork.get(gid).filter((e) => isCurrent(e.period, asOf));
  const children = new Map();
  for (const e of view.edges) {
    if (!live(e) || e.core_type !== 'contains' || !byWork.has(e.source) || !byWork.has(e.target)) continue;
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source).push(e.target);
  }

  // 공백
  const gaps = [];
  for (const w of works) {
    if (currentOf(w.gid).length) continue;
    const wl = workLoad(view, w.gid, { asOf });
    const kids = children.get(w.gid) || [];
    const covered = kids.filter((k) => currentOf(k).length).length;
    const lastPerson = wl.last_person;
    const nextPerson = wl.next_person;
    gaps.push({
      gid: w.gid,
      label: w.label,
      universe_id: w.universe_id,
      universe_name: w.universe_name,
      kind: wl.kind,
      next_person: nextPerson,
      next_start: wl.next_start,
      last_person: lastPerson,
      last_end: wl.last_end,
      children: kids.length,
      children_covered: covered,
      evidence_ids: [w.gid, ...(nextPerson ? [nextPerson.gid] : []), ...(lastPerson ? [lastPerson.gid] : [])],
    });
  }

  // 밀집: 사람별 현재 맡은 업무(같은 업무는 한 번)
  const load = new Map();
  for (const w of works) {
    for (const e of currentOf(w.gid)) {
      const p = view.getNode(e.source);
      if (!load.has(p.gid)) load.set(p.gid, { gid: p.gid, label: p.label, emp_no: p.emp_no, works: [] });
      const entry = load.get(p.gid);
      if (!entry.works.some((x) => x.gid === w.gid)) entry.works.push({ gid: w.gid, label: w.label, universe_name: w.universe_name });
    }
  }
  const dense = [...load.values()]
    .filter((p) => p.works.length >= limit)
    .map((p) => ({ ...p, count: p.works.length, evidence_ids: [p.gid, ...p.works.map((w) => w.gid)] }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // 조직(유니버스)별 집계. 업무가 있는 유니버스만, 보기 순서대로
  const groups = [];
  for (const [uid, u] of view.universes) {
    const ws = works.filter((w) => w.universe_id === uid);
    if (ws.length === 0) continue;
    const people = new Set(ws.flatMap((w) => currentOf(w.gid).map((e) => e.source)));
    const hasPerforms = ws.some((w) => byWork.get(w.gid).length > 0);
    groups.push({
      universe_id: uid,
      name: u.name,
      insufficient: !hasPerforms,
      works: ws.length,
      people: people.size,
      gaps: gaps.filter((g) => g.universe_id === uid).length,
      dense: dense.filter((p) => p.works.some((w) => ws.some((x) => x.gid === w.gid))).length,
    });
  }

  // 수행 연결이 없는 유니버스의 업무는 공백 목록에서 뺀다(그 유니버스는 "데이터 부족"만 표시, R-05 ②)
  const noData = new Set(groups.filter((g) => g.insufficient).map((g) => g.universe_id));
  const shownGaps = gaps.filter((g) => !noData.has(g.universe_id));
  for (const g of groups) if (g.insufficient) g.gaps = 0;

  if (shownGaps.length === 0 && dense.length === 0) {
    return { ...base, groups, status: 'none', reason: `담당자가 없는 업무도, ${limit}개 이상을 맡은 사람도 없습니다` };
  }
  return { ...base, groups, gaps: shownGaps, dense, status: 'ok', reason: '' };
}
