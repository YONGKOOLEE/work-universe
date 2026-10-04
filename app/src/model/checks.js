// 명령과 문서 검증이 함께 쓰는 검사(1.5). 순수 함수.

import { normalizeEmpNo, normalizeLabel } from './schema.js';

// 연도 범위: 오타(0202, 1026)로 시간 막대가 달 수천 개가 되거나 계산이 멈추는 것을 막는다(여섯 번째 검토 C-1)
export const YEAR_MIN = 1900;
export const YEAR_MAX = 2200;

// YYYY-MM-DD이고 달력에 있는 날짜이며 연도가 YEAR_MIN~YEAR_MAX인지
export function isDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const year = Number(v.slice(0, 4));
  if (year < YEAR_MIN || year > YEAR_MAX) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// 기간 {start?, end?}이 올바르면 null, 아니면 'format'(날짜 형식) 또는 'order'(끝이 시작보다 앞)
export function periodError(period) {
  if (period === undefined || period === null) return null;
  if (typeof period !== 'object' || Array.isArray(period)) return 'format';
  for (const k of ['start', 'end']) {
    if (period[k] !== undefined && !isDate(period[k])) return 'format';
  }
  if (period.start && period.end && period.end < period.start) return 'order';
  return null;
}

// 시작이 없으면 처음부터, 끝이 없으면 계속 진행 중으로 본다
export function periodsOverlap(a, b) {
  const aStart = (a && a.start) || '';
  const aEnd = (a && a.end) || '9999-99-99';
  const bStart = (b && b.start) || '';
  const bEnd = (b && b.end) || '9999-99-99';
  return aStart <= bEnd && bStart <= aEnd;
}

// 사람은 같은 사번, 그 외는 같은 유형 + 같은 정규화 라벨이면 중복(숨긴 노드는 제외). 없으면 undefined
export function findDuplicateNode(nodes, cand, excludeId) {
  if (cand.core_type === 'root') return undefined;
  return nodes.find((n) => {
    if (n.hidden || n.id === excludeId) return false;
    if (cand.core_type === 'person') return !!cand.emp_no && n.core_type === 'person' && !!n.emp_no && normalizeEmpNo(n.emp_no) === normalizeEmpNo(cand.emp_no);
    return n.core_type === cand.core_type && normalizeLabel(n.label) === normalizeLabel(cand.label);
  });
}

// 같은 출발·도착·관계 유형이면서 유효 기간이 겹치면 중복(숨긴 연결은 제외)
export function findDuplicateEdge(edges, cand, excludeId) {
  return edges.find(
    (e) =>
      !e.hidden &&
      e.id !== excludeId &&
      e.source === cand.source &&
      e.target === cand.target &&
      e.core_type === cand.core_type &&
      periodsOverlap(e.period, cand.period),
  );
}

export function subtypeRegistered(doc, coreType, name) {
  // 가져온 JSON의 subtypes가 배열이 아니거나 null이 섞여 있어도 예외 없이 "없음"으로(검증이 오류로 알린다, 여섯 번째 검토 C-3)
  const list = Array.isArray(doc.universe && doc.universe.subtypes) ? doc.universe.subtypes : [];
  return list.some((s) => s && s.core_type === coreType && s.name === name);
}
