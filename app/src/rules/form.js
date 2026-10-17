// 표준 양식 점검(T-20, R-16, D-16). 업무 노드에 인수인계에 필요한 항목이 비어 있는지 알린다. 막지 않는다.
// 권장 항목은 조력자 의견(2026-10-12)과 사용자 결정("전부 추천으로 진행")으로 정했다: 절차·주기·마감·주의사항·관련 문서·담당(수행 연결)·설명.
// 이 모듈은 DOM·저장소를 쓰지 않는다. 데이터 틀(스키마)은 바꾸지 않고 속성 이름 약속만 쓴다(R-07).

import { hasCautionMemo } from './handover.js';

/** 권장 항목 한 곳. 바꾸려면 여기만 고친다 */
export const STANDARD_FORM = {
  /** 업무 노드의 attrs에서 값을 찾는 권장 속성(이 순서로 알린다) */
  workAttrs: ['절차', '주기', '마감', '주의사항'],
  /** 관련 문서: 이 속성이 있거나, 업무에 이어진 산출물(산출·참조 연결)이 있으면 채운 것으로 본다 */
  relatedDocAttr: '관련 문서',
  /** 설명(description)도 권장 */
  description: '설명',
  /** 담당: 사람 → 업무 수행 연결이 한 번이라도 있으면 채운 것(지금 담당이 없는 것은 공백 인사이트가 다룬다) */
  performer: '담당',
  /** 한 유니버스의 노드(꼭지 제외)가 이 수를 넘으면 「나눠 보세요」를 안내한다. 02 5.6.2 쪼개는 단위(업무당 10~20개)에 여유를 둔 값. 바꾸려면 여기만 */
  splitAbove: 25,
};

const nonEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * 업무 하나의 빈 권장 항목 이름 목록.
 * @param {object} view buildView 결과
 * @param {string} workGid
 * @returns {string[]|null} 업무가 아니거나 숨김이면 null. 다 채웠으면 빈 배열
 */
export function workFormMissing(view, workGid) {
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
export function formReport(view) {
  const works = [];
  let total = 0;
  for (const n of view.nodes) {
    if (n.core_type !== 'work' || n.hidden) continue;
    total += 1;
    const missing = workFormMissing(view, n.gid);
    if (missing && missing.length) works.push({ gid: n.gid, label: n.label, universe_name: n.universe_name, missing });
  }
  return { total, incomplete: works.length, works };
}

/**
 * 큰 유니버스에 「업무별로 나누세요」 안내가 필요한지(조력자 의견 2026-10-17 "업무가 커지면 그림이 난잡해진다").
 * 이 유니버스 문서 자신의 숨기지 않은 노드(꼭지 제외)만 센다. 하위 유니버스 노드는 묶은 화면에서 이미 접혀 보이므로 세지 않는다.
 * @returns {{count:number, limit:number}|null}
 */
export function splitHint(doc) {
  const count = (doc.nodes || []).filter((n) => !n.hidden && n.core_type !== 'root').length;
  return count > STANDARD_FORM.splitAbove ? { count, limit: STANDARD_FORM.splitAbove } : null;
}
