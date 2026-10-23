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
    insufficient: !soloOk && !denseOk,
  };
}

/** 한 줄 글의 세 조각. 숫자가 0이면 「혼자만 아는 일 없음」처럼, 한 가지만 못 세면 「… 기록 부족」, 모두 못 세면 한 문장 */
export function teamRiskParts(s) {
  if (s.insufficient) return ['담당(수행) 기록이 부족해 아직 셀 수 없음'];
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
