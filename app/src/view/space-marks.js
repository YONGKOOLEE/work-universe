// 공간별 그래프 강조(CR-22 G2): 어느 공간이냐에 따라 그래프에서 또렷하게 보일 항목을 정한다. 순수 함수 — 화면(DOM)·라이브러리를 쓰지 않는다.
//  기록 = 미해결이 있는 업무(노랑 테두리) / 매주 점검 = 혼자만 아는 일(빨강 겹테두리) / 인수인계 = 지금 담당이 있는 업무와 담당자(나머지 업무·사람은 흐리게)
//  나머지 공간(지도 보기·지도 관리)은 강조 없음. 새 판정을 만들지 않고 기존 계산(rules/issues.js·rules/insight-risk.js·view/describe.js)을 그대로 부른다.

import { openMemos, memoTarget } from '../rules/issues.js';
import { knowledgeConcentration } from '../rules/insight-risk.js';
import { isCurrentEdge } from './describe.js';

// 바꾸기 쉬운 값은 한 곳에: 클래스 이름·색·범례 글
export const SPACE_MARK = {
  record: { cls: 'mk-issue', key: 'issue', color: '#ffd84d', ring: 'solid', label: '노랑 테두리 = 미해결이 있는 업무' },
  check: { cls: 'mk-solo', key: 'solo', color: '#ff6b6b', ring: true, label: '빨강 겹테두리 = 혼자만 아는 일' },
  handover: { cls: 'mk-current', key: 'current', color: '#e6ecdf', ring: 'solid', label: '또렷한 항목 = 지금 담당이 있는 업무와 담당자(나머지는 흐리게)' },
};
export const SPACE_MARK_CLASSES = Object.values(SPACE_MARK).map((m) => m.cls);

const live = (n) => !!n && !n.hidden && !n.deleted;

/** 미해결(이슈·진행 중) 메모가 걸린 업무의 gid들 */
export function issueWorks(view) {
  const out = new Set();
  for (const ev of openMemos(view)) {
    const t = memoTarget(view, ev);
    const n = t ? view.getNode(t) : null;
    if (live(n) && n.core_type === 'work') out.add(n.gid);
  }
  return out;
}

/** 혼자만 아는 일(인수인계 위험 ①과 같은 계산)의 업무 gid들 */
export function soloWorks(view, asOf) {
  const c = knowledgeConcentration(view, { asOf });
  return new Set(c.insufficient ? [] : c.items.map((x) => x.work.gid));
}

/** 기준일에 지금 담당(수행 연결)이 있는 업무와 그 담당자의 gid들 */
export function currentOwnerNodes(view, asOf) {
  const out = new Set();
  for (const e of view.edges) {
    if (e.hidden || e.core_type !== 'performs' || !isCurrentEdge(view, e, asOf)) continue;
    const w = view.getNode(view.canonical(e.target));
    const p = view.getNode(view.canonical(e.source));
    if (!live(w) || w.core_type !== 'work' || !live(p) || p.core_type !== 'person') continue;
    out.add(w.gid);
    out.add(p.gid);
  }
  return out;
}

/**
 * 지금 공간의 그래프 강조.
 * @param {string} space 공간 key(map·record·handover·check·edit)
 * @param {object} view 합성 뷰
 * @param {{asOf:string, shown:Set<string>|null, note?:boolean}} o shown: 지금 그래프에 그려진 항목 gid(없으면 모두 보인다고 봄). note: 접힌 팀 안 개수를 범례 글에 붙일지
 * @returns {{cls:string|null, gids:string[], hidden:number, marks:{key:string,label:string,color:string,ring?:any}[]}} gids: 강조할 항목(그려진 것만), hidden: 접힌 팀 안에 있어 안 보이는 수
 */
export function spaceMarks(space, view, { asOf, shown = null, note = true } = {}) {
  const spec = SPACE_MARK[space];
  if (!spec) return { cls: null, gids: [], hidden: 0, marks: [] };
  const all = space === 'record' ? issueWorks(view) : space === 'check' ? soloWorks(view, asOf) : currentOwnerNodes(view, asOf);
  const gids = [...all].filter((g) => !shown || shown.has(g));
  // 인수인계는 업무와 담당자를 함께 세므로 접힌 안의 개수도 업무만 센다
  const countable = (g) => space !== 'handover' || view.getNode(g)?.core_type === 'work';
  const hidden = shown && note ? [...all].filter((g) => !shown.has(g) && countable(g)).length : 0;
  const label = spec.label + (hidden > 0 ? `(접힌 팀 안 ${hidden}개 포함)` : '');
  return { cls: spec.cls, gids, hidden, marks: [{ key: spec.key, label, color: spec.color, ring: spec.ring }] };
}
