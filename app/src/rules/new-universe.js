// 「내 업무 지도 만들기」(CR-13 A 재검증 N-3, 2026-10-18): 처음 쓰는 사람이 업무 이름만 넣어도 유니버스를 만들 수 있게,
// 비어 있는 이름·단위·작성 주체를 자동으로 채운다. R-12(세 값 필수)는 그대로 지킨다 — 채운 값으로 통과한다.
// DOM·저장소를 쓰지 않는다(rules). 바꾸기 쉽게 기본값은 아래 상수 한 곳에 둔다.

export const MINE_DEFAULTS = {
  NAME_SUFFIX: ' 업무 지도', // 이름 ← "{업무 이름} 업무 지도"
  LEVEL: '업무',
  OWNER_WITH_AUTHOR: (author) => `${author}의 팀`, // 설정의 작성자 이름이 있을 때
  OWNER_FALLBACK: '내 팀',
  NAME_MAX: 100, // model의 LABEL_MAX와 같은 한도(넘으면 업무 이름 부분을 줄인다)
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * 「내 업무」 모드의 입력을 채운다.
 * @param {{name?:string, level?:string, owner?:string, description?:string, starter?:{work?:string}}} raw 화면 입력(이름·단위·작성 주체는 비어 있을 수 있음)
 * @param {string|undefined} authorName 설정의 작성자 이름(없으면 undefined)
 * @returns {{ok:true, input:object, filled:string[]} | {ok:false, field:'starter_work', code:'mine-work-required'}}
 *   filled: 자동으로 채운 칸 이름(name|level|owner)
 */
export function fillMineDefaults(raw, authorName) {
  const work = text(raw && raw.starter && raw.starter.work);
  if (!work) return { ok: false, field: 'starter_work', code: 'mine-work-required' };
  const filled = [];
  const input = { ...raw };
  if (!text(raw.name)) {
    const room = MINE_DEFAULTS.NAME_MAX - MINE_DEFAULTS.NAME_SUFFIX.length;
    input.name = `${work.length > room ? work.slice(0, room).trim() : work}${MINE_DEFAULTS.NAME_SUFFIX}`;
    filled.push('name');
  }
  if (!text(raw.level)) {
    input.level = MINE_DEFAULTS.LEVEL;
    filled.push('level');
  }
  if (!text(raw.owner)) {
    const author = text(authorName);
    input.owner = author ? MINE_DEFAULTS.OWNER_WITH_AUTHOR(author) : MINE_DEFAULTS.OWNER_FALLBACK;
    filled.push('owner');
  }
  return { ok: true, input, filled };
}

// 만들기 오류의 field → 대화상자 칸 id (어느 모드든 오류가 나면 그 칸으로 초점을 옮긴다)
const FIELD_IDS = {
  name: 'create-name',
  level: 'create-level',
  owner: 'create-owner',
  description: 'create-description',
  starter_work: 'create-start-work',
  starter_person: 'create-start-person',
  starter_artifact: 'create-start-artifact',
  starter_cycle: 'create-start-cycle',
  starter_due: 'create-start-due',
};

/** 오류의 field 이름 → 칸 id. 모르는 이름이면 null(초점을 옮기지 않는다). 상속 속성(constructor 등)은 칸이 아니다 */
export function createFieldId(field) {
  return typeof field === 'string' && Object.prototype.hasOwnProperty.call(FIELD_IDS, field) ? FIELD_IDS[field] : null;
}
