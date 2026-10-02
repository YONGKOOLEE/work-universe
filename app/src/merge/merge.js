// 통합(R-11, D-03, 12.7 merge, T-10). 순수 함수이며 view만 입력으로 받는다(DOM·저장소 없음).
// 하위 유니버스들을 참조한 통합 유니버스의 view에서
//   ① 사번 자동 연결 대상(사번·이름이 같은 사람, R-11 ①)
//   ② 사람 확인 목록: 사번 충돌(같은 사번·다른 이름), 사번 없음(R-11 ③) — 자동으로 판단하지 않는다
//   ③ 업무 후보: 다른 유니버스의 업무 쌍을 규칙으로 점수 매긴 목록(R-11 ②). 이유 문장은 역할 (c)의 규칙 기반 문장
// 을 만든다. 사람이 이미 판정한 쌍(확정·거부)과 이미 합쳐진 쌍은 다시 내지 않는다(12.2 "거부한 쌍은 다시 제안하지 않는다").

import { normalizeLabel } from '../model/schema.js';
import { GENERIC_ARTIFACT_TYPES } from '../rules/insight.js';

// 업무 후보 점수: 주제 3, 산출물 유형 2, 라벨 낱말 1(유사 경험자 D-08과 같은 비중)
export const MERGE_WEIGHTS = { topic: 3, artifactType: 2, token: 1 };
export const WORK_CANDIDATE_LIMIT = 12;
const STOP_TOKENS = new Set(['업무', '관리', '처리', '확인']);
const normEmp = (v) => String(v || '').trim().toUpperCase();
const pairKey = (a, b) => [a, b].sort().join('|');
const tokensOf = (label) => new Set(normalizeLabel(label).split(/[\s·,.()/\-_]+/).filter((t) => t.length >= 2 && !STOP_TOKENS.has(t)));

/**
 * @param {object} view 통합 유니버스의 buildView 결과
 * @param {object[]} links 통합 유니버스 문서의 identity_links(판정 기록)
 * @returns {{auto:object[], persons:object[], works:object[], counts:{auto:number, persons:number, works:number, pending:number}}}
 */
export function mergePlan(view, links = []) {
  // 판정·중복은 대표 노드(합쳐진 노드) 기준으로 본다 — 같은 사람이 여러 유니버스에 있어도 한 번만 묻는다
  const canon = (g) => view.canonical(g);
  const decided = new Map(links.filter((l) => l.status !== 'pending').map((l) => [pairKey(canon(l.a), canon(l.b)), l.status]));
  const isDecided = (a, b) => decided.has(pairKey(canon(a), canon(b)));
  const asked = new Set();
  const once = (a, b) => { const k = pairKey(canon(a), canon(b)); if (asked.has(k)) return false; asked.add(k); return true; };
  const sameNow = (a, b) => view.canonical(a) === view.canonical(b);
  const raw = (view.raw_nodes || []).filter((n) => !n.hidden && n.universe_id !== view.universe_id);
  const uname = (n) => n.universe_name;

  // ── 사람 ──
  const persons = raw.filter((n) => n.core_type === 'person' && n.subtype !== '역할');
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
          auto.push({ kind: 'person', a: x.gid, b: y.gid, method: 'emp_no_auto', status: 'confirmed', reason: `사번 ${emp}, 이름 ${x.label}이(가) 같음` });
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
  for (const p of persons.filter((x) => !x.emp_no)) {
    const same = persons.filter((q) => q !== p && q.universe_id !== p.universe_id && normalizeLabel(q.label) === normalizeLabel(p.label) && !sameNow(p.gid, q.gid) && !isDecided(p.gid, q.gid) && once(p.gid, q.gid));
    if (same.length) {
      for (const q of same) {
        personItems.push({ type: 'no_empno', kind: 'person', a: p.gid, b: q.gid, title: `사번 없음: ${p.label}`, reason: `${p.label}(${uname(p)})은 사번이 없습니다. 이름이 같은 ${q.label}(${uname(q)}${q.emp_no ? `, ${q.emp_no}` : ''})과 같은 사람인지 확인이 필요합니다.`, evidence_ids: [p.gid, q.gid] });
      }
    } else if (!links.some((l) => l.a === p.gid || l.b === p.gid)) {
      personItems.push({ type: 'no_empno', kind: 'person', a: p.gid, b: null, title: `사번 없음: ${p.label}`, reason: `${p.label}(${uname(p)})은 사번이 없어 다른 유니버스의 사람과 자동으로 잇지 않았습니다. 같은 사람이 있다면 사번을 넣거나 직접 연결해 주세요.`, evidence_ids: [p.gid] });
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
      const score = MERGE_WEIGHTS.topic * topics.length + MERGE_WEIGHTS.artifactType * types.length + MERGE_WEIGHTS.token * tokens.length;
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
