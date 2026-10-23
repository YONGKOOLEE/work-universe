// 화면 흐름(main.js)에서 쓰는 순수 도우미 — 처음 사용 점검 3회차 W7. DOM·저장소를 쓰지 않아 Node 단위 테스트로 검증한다.
// 문구는 한 곳에 모아 둔다(바꾸기 쉽게). 데이터·규칙·저장 형식은 건드리지 않는다.

import { normalizeLabel } from '../model/schema.js';

/** 팀 지도 범례의 접힌 팀·요약 연결 설명(점검 3회차: 목적 없는 직원이 한꺼번에 읽기 어렵다고 함) */
export const LEGEND_COLLAPSED_TEXT = '숫자 = 접힌 팀(두 번 누르면 펼침) · 점선 = 팀 사이 요약 연결';

/** 새 지도 창에서 작성 주체가 비었을 때의 안내(오류 코드는 E-REQUIRED 그대로, R-12 ②) */
export const OWNER_REQUIRED_TEXT = '작성 주체(팀·부서 이름)를 적으세요. 모르면 「내 업무를 정리해 두고 싶어요」로 시작하면 자동으로 채웁니다.';

/** 새 지도 창의 칸 제목 옆 안내 */
export const OWNER_LABEL_HINT = '(이 지도를 책임질 팀·부서 이름, 예: 가상영업팀)';
export const LEVEL_LABEL_HINT = '(업무 하나면 「업무」 그대로)';

/** 묶은 지도 개요의 통합 확인 줄: 대기 건수가 있으면 "같은 사람·업무인지 확인할 것 n건(사람 a, 업무 후보 b)" */
export function mergePendingText(counts) {
  if (!counts || !counts.pending) return '통합 확인할 항목이 없습니다. ';
  return `같은 사람·업무인지 확인할 것 ${counts.pending}건(사람 ${counts.persons}, 업무 후보 ${counts.works}) `;
}

/**
 * 권장 항목 「담당」 칸의 이름 넣기를 applyBatch 명령으로 바꾼다.
 * 같은 이름의 사람이 이 지도에 있으면 그 사람을, 없으면 새 사람을 만들어 이 업무에 「수행」(assign) 연결한다.
 * 시작일은 명령의 기본값(오늘)을 따른다 — 표의 담당자 칸과 같은 경로다.
 * @param {{id:string,label:string}[]} persons 이 지도의 사람 노드(숨김 제외)
 * @param {string} name 입력한 이름
 * @param {string} workId 업무 노드 id(이 유니버스 안)
 * @returns {{ok:true, ops:object[], existing:boolean}|{ok:false, reason:'empty'|'ambiguous'}}
 */
export function assignOps(persons, name, workId) {
  const label = String(name ?? '').trim();
  if (!label) return { ok: false, reason: 'empty' };
  const key = normalizeLabel(label);
  const hits = persons.filter((p) => normalizeLabel(p.label) === key);
  if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
  if (hits.length === 1) return { ok: true, existing: true, ops: [{ op: 'assign', row: 1, input: { person_id: hits[0].id, work_id: workId } }] };
  return {
    ok: true,
    existing: false,
    ops: [
      { op: 'addNode', row: 1, input: { core_type: 'person', label }, attachRoot: false },
      { op: 'assign', row: 2, input: { person_id: '@1', work_id: workId } },
    ],
  };
}

/**
 * 초안 창이 다시 그려지기 전에 지금 고른 대상·보내는·받는 사람을 preset({target, from, to}: from·to는 이름)으로 옮긴다.
 * 고른 것이 없으면(빈 칸) 이전 preset을 그대로 둔다. 노드가 사라졌으면 이름은 빈 문자열.
 * @param {{target?:string,preset?:object}} drafting
 * @param {{target:string, from:string, to:string}} picked 화면 칸의 값(gid, 빈 문자열 가능)
 * @param {(gid:string)=>string} nameOf gid → 이름(없으면 빈 문자열)
 * @returns {{target:string, preset:{target:string,from:string,to:string}}}
 */
export function keepDraftPick(drafting, picked, nameOf) {
  const target = picked.target || drafting.target;
  return {
    target,
    preset: { target, from: nameOf(picked.from) || '', to: nameOf(picked.to) || '' },
  };
}
