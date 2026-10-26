// 화면 흐름(main.js)에서 쓰는 순수 도우미 — 처음 사용 점검 3회차 W7. DOM·저장소를 쓰지 않아 Node 단위 테스트로 검증한다.
// 문구는 한 곳에 모아 둔다(바꾸기 쉽게). 데이터·규칙·저장 형식은 건드리지 않는다.

import { normalizeLabel } from '../model/schema.js';

/** 팀 지도 범례의 접힌 팀·요약 연결 설명(점검 3회차: 목적 없는 직원이 한꺼번에 읽기 어렵다고 함) */
export const LEGEND_COLLAPSED_TEXT = '숫자 = 접힌 팀(두 번 누르면 펼침) · 점선 = 팀 사이 요약 연결';

/** 범례의 선 이름 뜻(R13 FU8-3·18). 선 위에 적힌 글자의 관계 이름을 풀어 쓴다 — 관계 이름·저장 값은 그대로 */
export const LEGEND_LINES_TEXT = '선 이름: 선후행 = 앞뒤 순서 · 산출 = 만든 문서 · 참조 = 참고 · 관련 = 연관 · 수행 = 담당';

/** 새 지도 창에서 작성 주체가 비었을 때의 안내(오류 코드는 E-REQUIRED 그대로, R-12 ②) */
export const OWNER_REQUIRED_TEXT = '작성 주체(팀·부서 이름, 예: 가상영업팀)를 적으세요. 모르면 창을 닫고 시작 화면의 「내 업무를 정리해 두고 싶어요」로 시작하면 자동으로 채웁니다.';

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
 * 초안 창이 다시 그려지기 전에 지금 고른 대상·보내는·받는 사람을 preset({target, from, to, from_gid, to_gid}: from·to는 이름, *_gid는 고른 사람의 gid)으로 옮긴다.
 * 고른 것이 없으면(빈 칸) 이전 preset을 그대로 둔다. 노드가 사라졌으면 이름은 빈 문자열.
 * @param {{target?:string,preset?:object}} drafting
 * @param {{target:string, from:string, to:string}} picked 화면 칸의 값(gid, 빈 문자열 가능)
 * @param {(gid:string)=>string} nameOf gid → 이름(없으면 빈 문자열)
 * @returns {{target:string, preset:{target:string,from:string,to:string}}}
 */
export function keepDraftPick(drafting, picked, nameOf) {
  const target = picked.target || drafting.target;
  // gid를 먼저, 이름은 대체(R11-6): 같은 이름의 사람이 둘이어도 고른 사람이 유지된다. 노드가 사라졌으면 gid도 비운다
  const gidOf = (gid) => (nameOf(gid) ? gid : '');
  return {
    target,
    preset: { target, from: nameOf(picked.from) || '', to: nameOf(picked.to) || '', from_gid: gidOf(picked.from), to_gid: gidOf(picked.to) },
  };
}

/**
 * 초안 창을 다시 그려야 하는지 가리는 "판 표지"(R11-5). 기록이 바뀌었을 때만 초안을 다시 만들고 안내 한 줄을 띄우기 위해,
 * 마지막으로 창을 그린 때의 표지(문서 객체 참조·되감기 시점·노드·연결·이력 수)와 지금 것을 비교한다. 값이 모두 === 로 같으면 같은 판이다.
 * @param {object|null} a
 * @param {object|null} b
 */
export function sameMark(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
