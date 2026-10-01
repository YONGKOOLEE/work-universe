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
    const sharedTopics = cp.topics.filter((t) => basisTopics.has(normalizeLabel(t.label)));
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
