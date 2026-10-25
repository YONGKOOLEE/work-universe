// 통합(R-11, D-03, 12.7 merge, T-10). 순수 함수이며 view만 입력으로 받는다(DOM·저장소 없음).
// 하위 유니버스들을 참조한 통합 유니버스의 view에서
//   ① 사번 자동 연결 대상(사번·이름이 같은 사람, R-11 ①)
//   ② 사람 확인 목록: 사번 충돌(같은 사번·다른 이름), 사번 없음(R-11 ③) — 자동으로 판단하지 않는다
//   ③ 업무 후보: 다른 유니버스의 업무 쌍을 규칙으로 점수 매긴 목록(R-11 ②). 이유 문장은 역할 (c)의 규칙 기반 문장
// 을 만든다. 사람이 이미 판정한 쌍(확정·거부)과 이미 합쳐진 쌍은 다시 내지 않는다(12.2 "거부한 쌍은 다시 제안하지 않는다").

import { josa } from '../model/josa.js';
import { SUBTYPE_ROLE, normalizeEmpNo, normalizeLabel, pairKey } from '../model/schema.js';
// 업무 후보 점수(주제 3, 산출물 유형 2, 라벨 낱말 1)·라벨 토큰·일반 산출물 유형은 유사 경험자(D-08)와 같은 것을 쓴다(검토5 C-6)
import { GENERIC_ARTIFACT_TYPES, WEIGHTS, tokensOf } from '../rules/insight.js';
import { edgeIndex } from '../rules/form.js';

export const WORK_CANDIDATE_LIMIT = 12;
// 사번 비교는 뷰·중복 검사와 같은 정규화(공백 제거·대문자)를 쓴다(여섯 번째 검토 C-10)
const normEmp = (v) => normalizeEmpNo(v);

/**
 * @param {object} view 통합 유니버스의 buildView 결과
 * @param {object[]} links 통합 유니버스 문서의 identity_links(판정 기록)
 * @returns {{auto:object[], persons:object[], works:object[], counts:{auto:number, persons:number, works:number, pending:number}}}
 */
export function mergePlan(view, links = []) {
  // 판정·중복은 대표 노드(합쳐진 노드) 기준으로 본다 — 같은 사람이 여러 유니버스에 있어도 한 번만 묻는다
  const canon = (g) => view.canonical(g);
  // 지금 문서의 판정 + 묶인 아래층 문서의 판정(위층이 다시 묻지 않는다, 여섯 번째 검토 C-4)
  // 사번이 바뀌어 맞지 않게 된 자동 연결은 판정으로 세지 않는다 — 세면 다시 묻지 못한다(RV10C-3). 쌍으로 가려내 문서 간 ID 겹침에 흔들리지 않는다
  const stalePairs = new Set((view.stale_link_items || []).map((x) => pairKey(x.a, x.b)));
  const allLinks = [...links, ...(view.decided_links || [])].filter((l) => !(l.status === 'confirmed' && l.method === 'emp_no_auto' && stalePairs.has(pairKey(l.a, l.b))));
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
  const paired = new Set(); // 이미 쌍 항목에 든 사람은 "혼자" 항목을 또 만들지 않는다(여섯 번째 검토 C-9)
  // 사번 자동 연결이 사번 변경으로 맞지 않게 된 쌍을 다시 확인 목록에 올린다(RV10C-3). 사람이 다시 판정하면 같은 연결이 갱신돼 목록에서 빠진다
  for (const s of view.stale_link_items || []) {
    const [x, y] = [view.rawNode(s.a), view.rawNode(s.b)];
    if (!x || !y || x.hidden || y.hidden || x.deleted || y.deleted || sameNow(x.gid, y.gid) || isDecided(x.gid, y.gid) || !once(x.gid, y.gid)) continue;
    paired.add(x.gid).add(y.gid);
    personItems.push({
      type: 'stale', kind: 'person', a: x.gid, b: y.gid,
      title: `사번이 바뀐 연결: ${x.label}`,
      reason: `사번이 같아 자동으로 이었던 ${x.label}(${uname(x)}, 사번 ${x.emp_no || '없음'})과 ${y.label}(${uname(y)}, 사번 ${y.emp_no || '없음'})은 그 뒤 사번이 바뀌어 지금은 합쳐 보지 않습니다. 같은 사람인지 다시 확인이 필요합니다.`,
      evidence_ids: [x.gid, y.gid],
    });
  }
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
  // 이름(정규화)별 사람 목록 — 사번 없는 사람마다 전체를 훑지 않는다(RV10C-4). 목록 안 순서는 persons의 순서 그대로
  const personsByName = new Map();
  for (const q of persons) {
    const k = normalizeLabel(q.label);
    if (!personsByName.has(k)) personsByName.set(k, []);
    personsByName.get(k).push(q);
  }
  for (const p of persons.filter((x) => !x.emp_no)) {
    const same = personsByName.get(normalizeLabel(p.label)).filter((q) => q !== p && q.universe_id !== p.universe_id && !sameNow(p.gid, q.gid) && !isDecided(p.gid, q.gid) && once(p.gid, q.gid));
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
  const bySource = edgeIndex(view).bySource; // 업무마다 연결 전체를 훑지 않는다(RV10C-4)
  const profile = (w) => {
    const c = view.canonical(w.gid);
    const topics = new Map();
    const types = new Map();
    for (const e of bySource.get(c) || []) {
      if (e.hidden) continue;
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
  // 같은 점수·같은 제목이면 만든 차례(i, j 오름차순)대로. 제목 비교는 localeCompare와 같은 기본 정렬 규칙이다
  const collate = new Intl.Collator().compare;
  const titleOf = (x, y) => `「${x.node.label}」(${x.node.universe_name}) ↔ 「${y.node.label}」(${y.node.universe_name})`;
  const decidedWith = new Map(); // 대표 gid → 판정한 상대 대표 gid들(isDecided와 같은 판정을 쌍마다 문자열을 만들지 않고 본다)
  for (const l of allLinks) {
    if (l.status === 'pending') continue;
    const [ca, cb] = [canon(l.a), canon(l.b)];
    if (!decidedWith.has(ca)) decidedWith.set(ca, new Set());
    if (!decidedWith.has(cb)) decidedWith.set(cb, new Set());
    decidedWith.get(ca).add(cb);
    decidedWith.get(cb).add(ca);
  }
  // 같은 주제·산출물 유형·낱말을 가진 업무 목록(색인). 겹치는 것이 하나도 없는 쌍은 점수가 0이라 볼 필요가 없다
  const posting = (pick) => {
    const m = new Map();
    works.forEach((w, i) => { for (const k of pick(w.prof)) { if (!m.has(k)) m.set(k, []); m.get(k).push(i); } });
    return m;
  };
  const byTopic = posting((p) => p.topics.keys());
  const byType = posting((p) => p.types.keys());
  const byToken = posting((p) => p.tokens);
  // 점수가 높은 순으로 LIMIT개만 간직한다. 나머지는 개수만 센다(후보를 전부 만들어 정렬하던 것을 줄임)
  const best = []; // {i, j, score, title, seq}: 점수 내림차순 → 제목 → 만든 차례
  const before = (a, b) => b.score - a.score || collate(a.title, b.title) || a.seq - b.seq;
  const score = new Int32Array(works.length);
  let total = 0;
  let seq = 0;
  for (let i = 0; i < works.length; i += 1) {
    const x = works[i];
    const touched = [];
    const bump = (list, weight) => {
      if (!list) return;
      for (const j of list) {
        if (j <= i) continue;
        if (score[j] === 0) touched.push(j);
        score[j] += weight;
      }
    };
    for (const k of x.prof.topics.keys()) bump(byTopic.get(k), WEIGHTS.topic);
    for (const k of x.prof.types.keys()) bump(byType.get(k), WEIGHTS.artifactType);
    for (const t of x.prof.tokens) bump(byToken.get(t), WEIGHTS.token);
    touched.sort((p, q) => p - q);
    const ux = universesOf.get(x.gid);
    const dx = decidedWith.get(x.gid);
    for (const j of touched) {
      const sc = score[j];
      score[j] = 0;
      const y = works[j];
      if (sc <= 0) continue;
      if ([...ux].some((u) => universesOf.get(y.gid).has(u)) || (dx && dx.has(y.gid))) continue;
      total += 1;
      const entry = { i, j, score: sc, title: null, seq };
      seq += 1;
      if (best.length >= WORK_CANDIDATE_LIMIT) {
        const worst = best[best.length - 1];
        if (sc < worst.score) continue;
        entry.title = titleOf(x, y);
        if (before(entry, worst) >= 0) continue;
        best.pop();
      } else {
        entry.title = titleOf(x, y);
      }
      let at = best.length;
      while (at > 0 && before(entry, best[at - 1]) < 0) at -= 1;
      best.splice(at, 0, entry);
    }
  }
  const shown = best.map(({ i, j, score: sc }) => {
    const [x, y] = [works[i], works[j]];
    const topics = [...x.prof.topics.keys()].filter((k) => y.prof.topics.has(k));
    const types = [...x.prof.types.keys()].filter((k) => y.prof.types.has(k));
    const tokens = [...x.prof.tokens].filter((t) => y.prof.tokens.has(t));
    const why = [
      ...topics.map((k) => `같은 주제 「${x.prof.topics.get(k).label}」`),
      ...types.map((k) => `같은 산출물 유형 「${k}」`),
      ...(tokens.length ? [`이름에 같은 낱말 「${tokens.join('·')}」`] : []),
    ];
    const evidence = [x.gid, y.gid, ...topics.flatMap((k) => [x.prof.topics.get(k).gid, y.prof.topics.get(k).gid]), ...types.flatMap((k) => [x.prof.types.get(k).gid, y.prof.types.get(k).gid])];
    return {
      type: 'work_candidate', kind: 'work', a: x.gid, b: y.gid, score: sc,
      title: titleOf(x, y),
      reason: `${why.join(', ')}. 같은 업무인지 사람이 확인합니다.`,
      evidence_ids: [...new Set(evidence)],
    };
  });

  return {
    auto,
    persons: personItems,
    works: shown,
    hidden_candidates: total - shown.length,
    counts: { auto: auto.length, persons: personItems.length, works: shown.length, pending: personItems.length + shown.length },
  };
}
