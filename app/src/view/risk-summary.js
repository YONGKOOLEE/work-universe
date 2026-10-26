// 위험 요약(처음 사용 점검 FU-10·FU-12): 묶은 지도 상세의 한 줄과 사람 상세의 「이 사람만 아는 일」.
// 새 규칙을 만들지 않는다 — 인사이트 탭이 쓰는 계산(rules/insight-risk.js의 knowledgeConcentration, rules/insight.js의 densityGaps)을
// 같은 기준일(asOf)·같은 밀집 기준(n)으로 부르고 숫자만 모은다. 그래서 탭의 숫자와 늘 같다. 화면(DOM)은 쓰지 않는다.

import { knowledgeConcentration } from '../rules/insight-risk.js';
import { densityGaps } from '../rules/insight.js';

/**
 * 묶은 지도 위험 요약의 숫자.
 * solo: 혼자만 아는 일(= 인수인계 위험 탭의 「혼자 해 본 업무」 수, 높음+주의), null이면 세지 못함(담당 기록 부족)
 * dense: 일 몰린 사람 수, gaps: 담당자 빈 일 수 (null이면 세지 못함 — 밀집·공백 탭의 「데이터 부족」과 같다)
 * @returns {{solo:number|null, solo_high:number|null, dense:number|null, gaps:number|null, insufficient:boolean}}
 */
export function teamRiskSummary(view, { asOf, n }) {
  const c = knowledgeConcentration(view, { asOf });
  const d = densityGaps(view, { asOf, n });
  const soloOk = !c.insufficient;
  const denseOk = d.status !== 'insufficient';
  return {
    solo: soloOk ? c.counts.one : null,
    solo_high: soloOk ? c.counts.high : null,
    dense: denseOk ? d.dense.length : null,
    gaps: denseOk ? d.gaps.length : null,
    works: c.counts.works, // 분모: 기준일에 진행 중인 업무 수(FU9-17). 혼자만 아는 일의 「업무 n개 중」
    insufficient: !soloOk && !denseOk,
  };
}

/** 한 줄 글의 세 조각. 숫자가 0이면 「혼자만 아는 일 없음」처럼, 한 가지만 못 세면 「… 기록 부족」, 모두 못 세면 한 문장 */
export function teamRiskParts(s) {
  if (s.insufficient) return ['담당 기록이 부족해 아직 셀 수 없음'];
  const part = (n, name, unit) => (n === null ? `${name} 기록 부족` : n === 0 ? `${name} 없음` : `${name} ${n}${unit}`);
  return [part(s.solo, '혼자만 아는 일', '개'), part(s.dense, '일 몰린 사람', '명'), part(s.gaps, '담당자 빈 일', '개')];
}

/**
 * 사람 한 명만 해 본 업무(인수인계 위험 탭 ① 목록 중 그 사람의 것). 높음이 먼저(탭과 같은 순서).
 * @returns {{gid:string,label:string,level:string}[]} 사람이 아니거나 해당이 없으면 []
 */
export function soloWorksOf(view, personGid, asOf) {
  const g = view.canonical(personGid);
  const c = knowledgeConcentration(view, { asOf });
  return c.items.filter((x) => x.person.gid === g).map((x) => ({ gid: x.work.gid, label: x.work.label, level: x.level }));
}

/** 사람 상세 한 줄: 「이 사람만 아는 일 3개: 「가」, 「나」, 「다」」 (많으면 앞 5개 + 「외 n개」). 0개면 '' */
export const SOLO_SHOW = 5;
export function soloWorksText(works) {
  if (!works.length) return '';
  const shown = works.slice(0, SOLO_SHOW).map((w) => `「${w.label}」`).join(', ');
  return `이 사람만 아는 일 ${works.length}개: ${shown}${works.length > SOLO_SHOW ? ` 외 ${works.length - SOLO_SHOW}개` : ''}`;
}

/**
 * 점검 요약(CR-18 D-4)에 넣을 숫자와 상위 항목. teamRiskSummary와 같은 계산(같은 기준일·같은 밀집 기준)이라 화면의 숫자와 늘 같다.
 * 숫자를 못 세면 null이고 목록은 비어 있다. 목록은 탭과 같은 순서(혼자만 아는 일은 높음이 먼저)이며 모두 담는다(자르기는 글 만드는 쪽).
 * @returns {{mapName:string, asOf:string, solo:number|null, dense:number|null, gaps:number|null, soloItems:{work:string,person:string,level:string}[], denseItems:{person:string,count:number}[], gapItems:{work:string}[]}}
 */
export function inspectionInput(view, { asOf, n, mapName }) {
  const s = teamRiskSummary(view, { asOf, n });
  const c = knowledgeConcentration(view, { asOf });
  const d = densityGaps(view, { asOf, n });
  return {
    mapName,
    asOf,
    solo: s.solo,
    dense: s.dense,
    gaps: s.gaps,
    works: s.works,
    soloItems: c.insufficient ? [] : c.items.map((x) => ({ work: x.work.label, person: x.person.label, level: x.level })),
    denseItems: d.status === 'insufficient' ? [] : d.dense.map((p) => ({ person: p.label, count: p.count })),
    gapItems: d.status === 'insufficient' ? [] : d.gaps.map((g) => ({ work: g.label })),
  };
}

// ── 팀(바로 아래 하위 지도)별 묶음(처음 사용 9회차 FU9-17·22) ──
// 새 판정은 없다. 위의 knowledgeConcentration·densityGaps 결과(전체 지도 하나를 한 번 계산한 것)의 항목을 항목이 속한 지도 → 그 지도가 속한 팀으로 나눠 셀 뿐이다.
// 그래서 팀 숫자를 모두 더하면(사람은 여러 팀에 걸칠 수 있어 일 몰린 사람만 빼고) 위 전체 숫자와 같다.

/** universe id → 묶은 지도의 바로 아래 하위 지도 id(팀). 묶은 지도 자신이면 그 id, 묶음에 속하지 않으면 자기 자신 */
export function teamOfFn(view) {
  const parentOf = new Map((view.ref_links || []).map((l) => [l.child, l.parent]));
  const root = view.universe_id;
  return (uid) => {
    if (uid === root) return root;
    let u = uid;
    for (let guard = 0; guard < 50; guard += 1) {
      const p = parentOf.get(u);
      if (!p || p === root) return u;
      u = p;
    }
    return uid;
  };
}

/**
 * 팀별 숫자. works: 기준일 진행 중 업무 수(밀집·공백 탭의 조직별 「업무」와 같은 값을 팀으로 더함), solo·gaps: 팀 안 업무 수, dense: 팀 안 업무를 지금 맡은 일 몰린 사람 수(같은 사람은 한 번).
 * 숫자를 못 세면 해당 칸은 null. 업무가 없는 팀은 뺀다. 묶은 지도가 아니면(팀이 하나뿐이면) 빈 배열.
 * @returns {{id:string, name:string, works:number|null, solo:number|null, dense:number|null, gaps:number|null}[]}
 */
export function teamRiskRows(view, { asOf, n }) {
  const teamOf = teamOfFn(view);
  const c = knowledgeConcentration(view, { asOf });
  const d = densityGaps(view, { asOf, n });
  const rows = new Map();
  const row = (uid) => {
    const id = teamOf(uid);
    if (!rows.has(id)) rows.set(id, { id, name: (view.universes.get(id) || { name: id }).name, works: 0, solo: c.insufficient ? null : 0, dense: d.status === 'insufficient' ? null : new Set(), gaps: d.status === 'insufficient' ? null : 0 });
    return rows.get(id);
  };
  for (const g of d.groups || []) row(g.universe_id).works += g.works;
  if (!c.insufficient) for (const x of c.items) { const w = view.getNode(x.work.gid); if (w) row(w.universe_id).solo += 1; }
  if (d.status !== 'insufficient') {
    for (const g of d.gaps) row(g.universe_id).gaps += 1;
    for (const p of d.dense) for (const w of p.works) { const node = view.getNode(w.gid); if (node) row(node.universe_id).dense.add(p.gid); }
  }
  const out = [...rows.values()].filter((r) => r.works > 0 || r.solo).map((r) => ({ ...r, works: d.status === 'insufficient' ? null : r.works, dense: r.dense === null ? null : r.dense.size }));
  return out.length > 1 ? out : [];
}

/** 팀 한 줄: 「가상정산팀 — 업무 47개 중 혼자만 5 · 일 몰린 1명 · 빈 일 2개」 (세지 못한 칸은 「?」) */
export function teamRowText(r) {
  const v = (x) => (x === null ? '?' : String(x));
  return `${r.name} — 업무 ${v(r.works)}개 중 혼자만 ${v(r.solo)}개 · 일 몰린 ${v(r.dense)}명 · 빈 일 ${v(r.gaps)}개`;
}

/**
 * 밀집·공백 표(인사이트 「밀집·공백」 탭)의 조직별 줄에 팀 합계 줄을 끼운다. 한 팀 안에 지도가 둘 이상일 때만(팀 하나가 지도 하나면 그 줄이 곧 팀 줄).
 * @param {{universe_id:string,name:string,works:number,people:number,gaps:number,dense:number,insufficient:boolean}[]} groups densityGaps 결과의 groups
 * @param {{gid:string, works:{gid:string}[]}[]} denseList densityGaps 결과의 dense(같은 사람을 팀에서 한 번만 세려고)
 * @returns {{kind:'team'|'map', name:string, works:number, gaps:number, dense:number, insufficient?:boolean, people?:number, universe_id?:string}[]}
 */
export function groupRowsWithTeams(view, groups, denseList = []) {
  const teamOf = teamOfFn(view);
  const order = [];
  const by = new Map();
  for (const g of groups) {
    const t = teamOf(g.universe_id);
    if (!by.has(t)) { by.set(t, []); order.push(t); }
    by.get(t).push(g);
  }
  const out = [];
  for (const t of order) {
    const members = by.get(t);
    if (members.length > 1 && t !== view.universe_id) {
      const ok = members.filter((g) => !g.insufficient);
      const ids = new Set(members.map((g) => g.universe_id));
      const dense = denseList.filter((p) => p.works.some((w) => { const nd = view.getNode(w.gid); return nd && ids.has(nd.universe_id); })).length;
      out.push({ kind: 'team', name: (view.universes.get(t) || { name: t }).name, works: members.reduce((a, g) => a + g.works, 0), gaps: ok.reduce((a, g) => a + g.gaps, 0), dense, insufficient: ok.length === 0 });
    }
    for (const g of members) out.push({ kind: 'map', ...g });
  }
  return out;
}
