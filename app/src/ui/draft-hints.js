// 인수인계 초안 화면의 순수 보조 함수(DOM 없음, Node 단위 테스트로 검증): 「이력 부족」 채우는 법, 따라 하기 예시 고르기,
// 마지막으로 고른 보내는·받는 사람 기억(처음 사용 점검 2026-10-24 FU-2·FU-8·FU-17).
// 규칙(rules/handover.js)이 실제로 세는 것에 맞춘 문구다. 규칙이 바뀌면 이 표도 함께 본다(tests/first-use-w1.test.js가 항목 key를 모두 덮는지 점검).

/**
 * 「이력 부족」 항목마다 "채우려면" 한 줄. 키는 HANDOVER_ITEMS의 key.
 * 근거(rules/handover.js buildHandoverDraft):
 *  업무_개요 = 대상(꼭지·업무)의 설명 / 세부_업무_절차 = 범위 업무의 설명·「절차」·「사용 시스템」(대상 업무 자신은 둘 중 하나가 있을 때만) /
 *  일정_마감 = 업무 속성 「주기」·「마감」 / 주의사항 = 업무 속성 「주의사항」 + 메모 분류 「주의사항」 / 진행_중 = 메모 분류 「진행 중」(이후 「해결됨」이 없는 것) /
 *  산출물_문서 = 범위 업무에서 「산출」로 이은 산출물 / 관계자_연락처 = 범위 업무에 「수행」으로 이은 사람(보내는·받는 사람 제외) + 보내는 사람의 속성 「연락처」 /
 *  최근_이슈 = 메모 분류 「이슈」 / 이전_인수인계 = 인수인계 이력 / 유사_경험자 = 대상 업무가 이은 주제(「관련」)·산출물(「산출」)이 다른 업무와 겹치는 사람
 */
export const FILL_HINTS = {
  업무_개요: '대상(꼭지나 업무)을 골라 「수정」에서 「설명」을 적으세요.',
  세부_업무_절차: '업무의 「수정」에서 속성 「절차」나 「사용 시스템」을 적거나, 이 아래에 하위 업무를 넣고 「포함」으로 이으세요(대상 업무 자신은 이 둘 중 하나가 있을 때만 나옵니다).',
  일정_마감: '업무의 「수정」에서 속성 「주기」나 「마감」을 적으세요.',
  주의사항: '업무의 속성 「주의사항」을 적거나, 「이력 추가」에서 종류 「메모」·분류 「주의사항」으로 남기세요.',
  진행_중: '업무에 「이력 추가」로 종류 「메모」·분류 「진행 중」 메모를 남기세요(같은 업무에 나중에 「해결됨」 메모가 달리면 빠집니다).',
  산출물_문서: '산출물을 「노드 추가」로 넣고 업무에서 「산출」(업무 → 산출물)로 이으세요. 문서 위치는 산출물의 속성 「위치」에 적습니다.',
  관계자_연락처: '보내는·받는 사람 말고 이 업무를 해 온 사람을 「수행」(사람 → 업무)으로 이으세요. 조직이나 「관련」·「참조」 연결은 세지 않습니다. 보내는 사람의 속성 「연락처」를 적어도 채워집니다.',
  최근_이슈: '「이력 추가」에서 종류 「메모」·분류 「이슈」로 남기세요.',
  이전_인수인계: '지난 인수인계는 「이력 추가」의 종류 「인수인계」로 기록하세요. 이 초안을 확정하면 이번 인수인계가 기록으로 남습니다.',
  유사_경험자: '대상 업무에 주제(「관련」으로 이음)나 산출물(「산출」로 이음)을 이으세요. 다른 업무가 같은 주제나 산출물 유형을 가져야 비교할 수 있습니다.',
};

/** 「이력 부족」 항목의 "채우려면: …" 문구. 표에 없는 키면 null(문구를 지어내지 않는다) */
export function fillHintOf(key) {
  return Object.prototype.hasOwnProperty.call(FILL_HINTS, key) ? `채우려면: ${FILL_HINTS[key]}` : null;
}

/** 받는 사람 자리에 도움말(＋ 사람 추가)이 필요한가: 사람이 둘 미만이거나, 보내는 사람을 뺀 후보가 없을 때 */
export function needsPersonHelp(people, fromGid) {
  return people.length < 2 || people.every((p) => p.gid === fromGid);
}

/** 따라 하기 예시의 대상 찾기: 이름(label) 또는 전역 참조(gid)가 같은 후보. 없으면 null */
export function findPresetTarget(targets, ref) {
  if (!ref) return null;
  return targets.find((t) => t.gid === ref) || targets.find((t) => t.label === ref) || null;
}

/**
 * 초안 화면을 열 때 보내는·받는 사람을 정한다. 우선순위: 따라 하기 예시(이름) > 마지막으로 고른 사람 > 비움(null).
 * 기억한 사람이 지금 목록에 없으면 쓰지 않는다. 보내는 사람과 받는 사람이 같게 되면 받는 사람은 비운다.
 * @returns {{from: string|null, to: string|null}} gid
 */
export function choosePeople({ people, preset, remembered }) {
  const byLabel = (label) => (people.find((p) => p.label === label) || {}).gid || null;
  const has = (gid) => (gid && people.some((p) => p.gid === gid) ? gid : null);
  let from = (preset && byLabel(preset.from)) || has(remembered && remembered.from);
  let to = (preset && byLabel(preset.to)) || has(remembered && remembered.to);
  if (from && from === to) to = null;
  return { from: from || null, to: to || null };
}

/** 기억 저장소(모듈 수준 Map) 접근: 유니버스 ID별 마지막 보내는·받는 사람. 저장소(localStorage)에는 쓰지 않는다 */
export function remember(memory, universeId, from, to) {
  if (!universeId || !from || !to) return;
  memory.set(universeId, { from, to });
}
export function recall(memory, universeId) {
  return memory.get(universeId) || null;
}
