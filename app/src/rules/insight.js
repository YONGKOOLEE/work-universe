// 인사이트 규칙(D-08, R-05). 순수 함수이며 view(합성 뷰)만 입력으로 받는다(12.7 rules). LLM 없이 계산한다.
// T-08: 유사 경험자. 선택한 업무와 주제·산출물 유형·라벨 토큰을 공유하는 "다른 업무"를 찾아 점수화하고,
// 그 업무를 수행한 사람을 점수순으로 돌려준다. 현재 담당자는 제외한다. 근거 ID(공유 주제·업무 노드)를 함께 돌려준다.

import { periodText } from '../view/describe.js';
import { normalizeLabel } from '../model/schema.js';

// 점수 가중치(D-08에 수치가 없어 정함): 주제 3, 산출물 유형 2, 라벨 토큰 1
export const WEIGHTS = { topic: 3, artifactType: 2, token: 1 };
const STOP_TOKENS = new Set(['업무', '관리', '처리', '확인']);

const live = (e) => !e.hidden;

// 라벨 토큰: 공백·구두점으로 나눈 2자 이상 낱말(흔한 낱말 제외)
function tokensOf(label) {
  return new Set(
    normalizeLabel(label)
      .split(/[\s·,.()/\-_]+/)
      .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t)),
  );
}

/** 이 날짜에 담당 중인가: 시작 전이 아니고, 끝이 없거나 끝이 그날 이후 */
export function isCurrent(period, asOf) {
  if (!period) return true;
  if (period.start && period.start > asOf) return false;
  return !period.end || period.end >= asOf;
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
      if (t.subtype) {
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
        period: periodText(e.period),
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

const eventGidIn = (ev, id) => (id.includes('/') ? id : `${ev.universe_id}/${id}`);
const fmtDate = (d) => d;

/** 이후 인수인계가 이전 인수인계서를 이어받았는가: 이전 인수인계를 가리키거나, 같은/참조하는 산출물을 쓴다 */
function continuesPrevious(view, later, earlier) {
  const prevIds = new Set(earlier.map((e) => e.gid));
  const ref = later.payload.previous_handover_id;
  if (ref && prevIds.has(eventGidIn(later, ref))) return true;
  const art = later.payload.artifact_id ? view.canonical(eventGidIn(later, later.payload.artifact_id)) : null;
  if (!art) return false;
  const earlierArts = new Set(earlier.filter((e) => e.payload.artifact_id).map((e) => view.canonical(eventGidIn(e, e.payload.artifact_id))));
  if (earlierArts.has(art)) return true; // 같은 인수인계서를 이어서 씀
  return view.edges.some((e) => !e.hidden && e.core_type === 'references' && e.source === art && earlierArts.has(e.target));
}

/**
 * @param {object} view buildView 결과
 * @returns {{status:'ok'|'none'|'insufficient', reason:string, last_input:string|null, patterns:object[]}}
 */
export function repeatInefficiency(view) {
  const relevant = view.events.filter((e) => e.type === 'handover' || e.type === 'memo');
  const last = view.events.length ? view.events[view.events.length - 1].occurred_at : null;
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
  for (const ev of relevant) {
    if (ev.type === 'memo') {
      const w = ev.payload.target_id ? workOf(ev, ev.payload.target_id) : null;
      if (!w) continue;
      for (const id of ev.payload.topic_ids || []) {
        const t = view.getNode(eventGidIn(ev, id));
        if (t && t.core_type === 'topic' && !t.hidden) addTo(t, w, ev.gid);
      }
    } else {
      const w = workOf(ev, ev.payload.work_id);
      if (!w) continue;
      for (const e of view.edges) {
        if (live(e) && e.core_type === 'relates_to' && e.source === w.gid) {
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
