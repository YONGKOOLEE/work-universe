// CR-13 A(2026-10-18) 앱 안 따라 하기: 시나리오 정의(rules/tour-steps.js)와 「도구 더 보기」 설정 필드(store/local.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLANK_HINT, TOUR_IDS, advance, emptyState, quotedNames, scenarioFor, scenarioOf, teamScenario } from '../app/src/rules/tour-steps.js';
import { loadSettings, saveSettings } from '../app/src/store/local.js';

const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};

test('시나리오는 handover·team 둘(handover·team 모두 5단계), 이야기·문구가 있다', () => {
  assert.deepEqual(TOUR_IDS, ['handover', 'team']);
  for (const id of TOUR_IDS) {
    const sc = scenarioOf(id);
    assert.equal(sc.steps.length, 5, id);
    assert.ok(sc.story.length > 10 && sc.universeId, id);
    for (const st of sc.steps) {
      assert.ok(st.task.length > 5, `${id}/${st.id}`);
      assert.equal(typeof st.target, 'function');
      assert.ok(st.next ? !st.done : typeof st.done === 'function', `${id}/${st.id}: 읽기 단계는 done이 없고, 나머지는 done이 있어야 한다`);
    }
  }
  assert.equal(scenarioOf('nope'), null);
  assert.equal(scenarioOf('toString'), null); // 프로토타입 이름을 시나리오로 읽지 않는다
});

test('단계 문구에 「」 화면 이름이 있고, 실제 화면의 단추·칸 이름과 같은 글자다', () => {
  const known = new Set(['대사 확인', '미해결', '다음', '인수인계 초안 만들기', '초안 만들기', '근거:', '노드 찾기', '주변만 보기', '전체 보기', '인사이트 보기', '인수인계 위험', '수정', '저장', '편집 되감기', '혼자만 아는 일 …', '자세히', '반복 비효율']); // 2회차 FU-33: 위험 요약 먼저 판의 1단계가 위험 요약 줄의 「자세히」. R11-11: 기본(D-29) 판의 마지막 단계가 「반복 비효율」 탭
  for (const id of TOUR_IDS) {
    const names = scenarioOf(id).steps.flatMap((st) => quotedNames(st.task));
    assert.ok(names.length >= 4, id);
    for (const n of names) assert.ok(known.has(n), `${id}: 「${n}」은 화면에 있는 이름이 아니다`);
  }
  for (const n of teamScenario('risk-first').steps.flatMap((st) => quotedNames(st.task))) assert.ok(known.has(n), `team(risk-first): 「${n}」은 화면에 있는 이름이 아니다`);
  assert.deepEqual(quotedNames('「가」와 「나 다」'), ['가', '나 다']);
  assert.deepEqual(quotedNames('없음'), []);
});

test('handover 완료 조건: 대사 확인 선택 → (읽기, 다음) → 초안 결과 → 근거 칩 → 되감기 모드', () => {
  const sc = scenarioOf('handover');
  const [pick, read, draft, evid, rew] = sc.steps;
  const s = emptyState('U-A1');
  assert.equal(pick.done(s), false);
  assert.equal(pick.done({ ...s, selected: 'U-A1/N-002' }), false);
  assert.equal(pick.done({ ...s, selected: 'U-A1/N-001' }), true);
  assert.equal(read.done, undefined);
  assert.equal(draft.done({ ...s, draftOpen: true }), false); // 초안 화면만 열린 것은 완료가 아니다
  assert.equal(draft.done({ ...s, draftOpen: true, draftShown: true }), true);
  assert.equal(evid.done({ ...s, draftShown: true }), false);
  assert.equal(evid.done({ ...s, evidenceUsed: true }), true);
  assert.deepEqual(draft.preset, { target: '월말 정산 점검', from: '윤바다', to: '서하늘' });
  // 5단계(R9-1 나): 고쳐 저장하는 것만으로는 완료가 아니고, 되감기 모드가 켜져야 완료. 읽기 전용이면 고칠 수 없으므로 건너뛴다
  assert.equal(rew.id, 'edit-rewind');
  assert.equal(rew.done(s), false);
  assert.equal(rew.done({ ...s, saved: true, editing: false }), false);
  assert.equal(rew.done({ ...s, rewinding: true }), true);
  assert.equal(rew.done({ ...s, readOnly: true }), true);
  assert.equal(rew.next, undefined);
});

test('handover 이야기(2회차 FU-27): 샘플 데이터 시점(9월 30일 구두 인수인계, 10월 1일 서하늘 시작)에 맞춘다', () => {
  assert.equal(scenarioOf('handover').story, '윤바다가 9월 말 서하늘에게 월말 정산을 넘겼습니다. 서하늘이 받을 인수인계 초안을 기록에서 만들어 봅니다.');
  assert.doesNotMatch(scenarioOf('handover').story, /다음 달/);
});

test('handover 3단계(R9-4): 동작은 「인수인계 초안 만들기」 → 「초안 만들기」 둘이고, 사람 고르기는 보조 문구로', () => {
  const draft = scenarioOf('handover').steps[2];
  assert.deepEqual(quotedNames(draft.task), ['인수인계 초안 만들기', '초안 만들기']);
  assert.doesNotMatch(draft.task, /윤바다|서하늘/); // 사람 이름은 본문에서 뺐다
  // 2회차 FU-26: 「빈 곳을 누르고」를 뺐다
  assert.equal(draft.task, '오른쪽의 「인수인계 초안 만들기」를 누른 뒤 「초안 만들기」를 누르세요.');
  const SUB = '대상(월말 정산 점검 전체)과 보내는·받는 사람은 이미 골라져 있어요';
  assert.equal(draft.sub(emptyState()), SUB);
  assert.equal(draft.sub({ ...emptyState(), draftOpen: true }), SUB);
  // FU-2: 대상(지도 전체=꼭지)도 미리 골라 둔다 — 사전 생성 문장이 있는 조합(U-A1/N-000, 윤바다 → 서하늘)
  assert.deepEqual(draft.preset, { target: '월말 정산 점검', from: '윤바다', to: '서하늘' });
});

test('handover 5단계(R9-1 나) 문구·보조 문구·짚기: 대사 확인 → 수정 → 저장 → 빈 곳 → 편집 되감기', () => {
  const rew = scenarioOf('handover').steps[4];
  // 3회차: 본문(task)은 한두 줄로 — 하려는 일만 두고, 세부 순서(수정·글자 하나·저장·빈 곳)는 보조 문구(sub)로 옮겼다
  assert.deepEqual(quotedNames(rew.task), ['대사 확인', '편집 되감기']);
  assert.ok(rew.task.length <= 80, `본문이 길다: ${rew.task.length}자`);
  assert.match(rew.task, /^\(연습, 건너뛰어도 됩니다\) /); // 2회차 FU-28 → 3회차
  const base = emptyState('U-A1');
  assert.deepEqual(quotedNames(rew.sub(base)), ['대사 확인', '수정', '저장', '편집 되감기']);
  assert.match(rew.sub(base), /글자 하나/);
  assert.match(rew.sub(base), /언제든 되돌릴 수 있어요/);
  assert.match(rew.sub({ ...base, saved: true }), /^고쳐서 저장했어요/);
  assert.match(rew.sub({ ...base, saved: true }), /편집 되감기/);
  // 아직 고치지 않음: 고른 게 없으면 노드를, 고르면 「수정」 단추를, 양식이 열려 있으면 저장 단추를 짚는다
  assert.equal(rew.target(base)[0].cy, 'node[label = "대사 확인"]');
  assert.equal(rew.target({ ...base, selected: 'U-A1/N-001' })[0].sel, '[data-testid=btn-edit]');
  assert.equal(rew.target({ ...base, selected: 'U-A1/N-001', draftOpen: true })[0].cy, 'node[label = "대사 확인"]'); // 초안이 열려 있으면 노드를 다시 눌러야 수정 단추가 보인다
  assert.match(rew.target({ ...base, selected: 'U-A1/N-001', editing: true })[0].sel, /node-form-edit.*submit/);
  // 저장 뒤: 노드가 골라져 있으면 빈 곳(표지), 개요면 「편집 되감기」 단추(안 보이면 빈 곳)
  const saved = { ...base, saved: true };
  assert.deepEqual(rew.target({ ...saved, selected: 'U-A1/N-001' }), [{ sel: '#graph', hint: BLANK_HINT }]);
  assert.deepEqual(rew.target({ ...saved, draftOpen: true }), [{ sel: '#graph', hint: BLANK_HINT }]);
  assert.equal(rew.target(saved)[0].sel, '[data-testid=btn-rewind]');
  assert.equal(rew.target(saved)[1].hint, BLANK_HINT);
});

// 2회차 FU-33: 첫 단계가 위험 요약 「자세히」(insight → risk)로 바뀌어 순서가 risk, expand, find, neighborhood, full
// R11-11: 기본 순서는 D-29 판으로 되돌렸다(기본 판은 tests/w10-screen.test.js). 이 시험은 위험 요약 먼저 판(teamScenario('risk-first'), CR-17 K 승인 시 기본이 될 수 있음)을 그대로 고정한다
test('team(risk-first) 완료 조건: 「자세히」로 인수인계 위험 열기 → 펼침 → 찾기로 선택 → 주변만 보기 → 전체 보기로 돌아옴', () => {
  const [ins, exp, find, nb, full] = teamScenario('risk-first').steps;
  assert.deepEqual(teamScenario('risk-first').steps.map((x) => x.id), ['risk', 'expand', 'find', 'neighborhood', 'full']);
  const s = emptyState('U-D1');
  assert.equal(exp.done(s), false);
  assert.equal(exp.done({ ...s, expandedCount: 1 }), true);
  assert.equal(find.done(s), false);
  assert.equal(find.done({ ...s, foundGid: 'U-A1/N-001' }), true);
  assert.equal(find.done({ ...s, selected: 'U-A1/N-001' }), false); // 눌러서 고른 것만으로는 찾기가 아니다
  assert.equal(nb.done(s), false);
  assert.equal(nb.done({ ...s, nbhd: true }), true);
  assert.equal(full.done({ ...s, nbhd: true }), false); // 주변만 보기 중이면 아직
  assert.equal(full.done(s), true); // 주변만 보기를 풀면 완료
  assert.equal(ins.done(s), false);
  assert.equal(ins.done({ ...s, insightOpen: true, insightKind: 'risk' }), true); // 「자세히」는 인수인계 위험 탭으로 연다
  assert.equal(ins.done({ ...s, insightOpen: true, insightKind: 'similar' }), false); // 다른 탭이 열린 것은 완료가 아니다
  assert.match(ins.task, /한 사람만 해 봤고 인수인계 기록이 없는 일이 나옵니다/);
  assert.deepEqual(quotedNames(ins.task), ['혼자만 아는 일 …', '자세히']);
  assert.equal(ins.target(s)[0].sel, '[data-testid=btn-team-risk-more]');
  assert.equal(ins.target(s).length, 1); // 선택이 없으면 단추만
  assert.deepEqual(ins.target({ ...s, selected: 'U-A1/N-001' })[1], { sel: '#graph', hint: BLANK_HINT }); // 선택이 남아 있으면 요약이 가려지므로 빈 곳 표지도
});

test('team(risk-first) advance: 「자세히」로 인수인계 위험을 열기 전에는 첫 단계에서 멈추고, 주변만 보기를 누른 직후에는 「전체 보기」 단계에서 멈추며, 풀면 끝', () => {
  const sc = teamScenario('risk-first');
  const base = { ...emptyState('U-D1'), expandedCount: 1, foundGid: 'U-A1/N-001' };
  assert.equal(advance(sc, 0, { ...base, nbhd: true }), 0); // 위험 요약을 아직 열지 않았다
  assert.equal(advance(sc, 0, { ...emptyState('U-D1'), insightOpen: true, insightKind: 'similar' }), 0); // 다른 탭
  assert.equal(advance(sc, 0, { ...emptyState('U-D1'), insightOpen: true, insightKind: 'risk' }), 1); // 펼치기 단계
  assert.equal(advance(sc, 1, { ...emptyState('U-D1'), expandedCount: 1 }), 2); // 찾기 단계
  const opened = { ...base, insightOpen: true, insightKind: 'risk' };
  assert.equal(advance(sc, 0, { ...opened, nbhd: true }), 4);
  assert.equal(advance(sc, 0, { ...opened, nbhd: false }), 3); // 아직 주변만 보기를 누르지 않았다
  assert.equal(advance(sc, 4, { ...opened, nbhd: false }), 5); // 5단계가 끝
});

// 2회차 FU-26·33: handover 3단계는 「빈 곳」 표지를 쓰지 않는다(선택이 있으면 그 노드 상세의 「인수인계 초안 만들기」 단추를 짚음). 표지는 handover 5단계·team 1단계(선택이 남아 있을 때, 단추 뒤 보조 후보)에서만
test('「빈 곳을 누르세요」 표지: handover 3단계는 쓰지 않고(FU-26), team 1단계는 선택이 있을 때 단추 뒤 보조 후보로만 쓴다', () => {
  const sel = { ...emptyState(), selected: 'U-A1/N-001' };
  const draft = scenarioOf('handover').steps[2];
  assert.equal(BLANK_HINT, '여기 빈 곳을 누르세요');
  assert.ok(draft.target(sel).every((x) => !x.hint), 'handover 3단계에는 빈 곳 표지가 없다');
  assert.equal(draft.target(sel)[0].sel, '[data-testid=btn-draft]'); // 선택한 노드 상세의 단추
  assert.match(draft.target(sel)[1].sel, /btn-draft-universe/);
  assert.equal(draft.target(sel)[2].sel, '#detail'); // 사람·산출물을 고른 경우 두 단추가 없으므로 패널만
  const risk = teamScenario('risk-first').steps[0];
  const lastStep = scenarioOf('team').steps[4]; // 기본(D-29) 판의 마지막 단계도 선택이 있으면 빈 곳 표지
  assert.ok(lastStep.target(emptyState()).every((x) => !x.hint));
  assert.equal(lastStep.target(sel)[0].hint, BLANK_HINT);
  assert.ok(risk.target(emptyState()).every((x) => !x.hint), '선택이 없으면 표지 없음');
  // 표지가 있는 대상은 #graph 하나뿐
  for (const sc of [...TOUR_IDS.map((id) => scenarioOf(id)), teamScenario('risk-first')]) for (const st of sc.steps) for (const x of st.target(sel)) if (x.hint) assert.equal(x.sel, '#graph');
});

test('handover 2단계 보조 문구: 「대사 확인」을 고른 상태면 없고, 선택을 풀었으면 다시 누르라고 안내하며 그 노드를 짚는다', () => {
  const read = scenarioOf('handover').steps[1];
  assert.equal(read.sub({ ...emptyState(), selected: 'U-A1/N-001' }), null);
  assert.equal(read.sub(emptyState()), '「대사 확인」을 다시 누르면 이력이 보입니다');
  assert.equal(read.sub({ ...emptyState(), selected: 'U-A1/N-002' }), '「대사 확인」을 다시 누르면 이력이 보입니다');
  assert.ok(read.target({ ...emptyState(), selected: 'U-A1/N-001' })[0].sel);
  assert.equal(read.target(emptyState())[0].cy, 'node[label = "대사 확인"]');
  assert.match(read.task, /오른쪽을 아래로 내려/);
  assert.equal(scenarioOf('handover').steps.filter((s) => s.sub).length, 3); // 2단계(다시 누르기)·3단계(미리 골라 둠)·5단계(저장 뒤 안내)
});

test('대상 짚기: 상태에 따라 후보가 바뀌고 모두 sel 또는 cy 선택자다', () => {
  for (const id of TOUR_IDS) {
    for (const st of scenarioOf(id).steps) {
      for (const s of [emptyState(), { ...emptyState(), selected: 'U-A1/N-001' }, { ...emptyState(), draftOpen: true }, { ...emptyState(), insightOpen: true }, { ...emptyState(), nbhd: true }, { ...emptyState(), saved: true }, { ...emptyState(), saved: true, selected: 'U-A1/N-001' }, { ...emptyState(), selected: 'U-A1/N-001', editing: true }, { ...emptyState(), rewinding: true }]) {
        const t = st.target(s);
        assert.ok(Array.isArray(t) && t.length > 0, `${id}/${st.id}`);
        for (const x of t) assert.ok(typeof x.sel === 'string' || typeof x.cy === 'string');
      }
    }
  }
  const draft = scenarioOf('handover').steps[2];
  assert.equal(draft.target({ ...emptyState(), selected: 'U-A1/N-001' })[0].sel, '[data-testid=btn-draft]'); // 2회차 FU-26: 고른 노드 상세의 단추 (옛 기대: 빈 곳을 눌러야 함)
  assert.match(draft.target(emptyState())[0].sel, /btn-draft-universe/);
  assert.match(draft.target({ ...emptyState(), draftOpen: true })[0].sel, /draft-form/);
});

test('advance: 완료된 단계는 건너뛰고, 읽기(다음) 단계에서 멈추며, 끝을 넘으면 단계 수', () => {
  const sc = scenarioOf('handover');
  assert.equal(advance(sc, 0, emptyState('U-A1')), 0);
  assert.equal(advance(sc, 0, { ...emptyState('U-A1'), selected: 'U-A1/N-001' }), 1); // 읽기 단계에서 멈춤
  assert.equal(advance(sc, 2, { ...emptyState('U-A1'), draftShown: true }), 3);
  assert.equal(advance(sc, 2, { ...emptyState('U-A1'), draftShown: true, evidenceUsed: true }), 4); // 5단계(되감기)에서 멈춤
  assert.equal(advance(sc, 4, emptyState()), 4);
  assert.equal(advance(sc, 4, { ...emptyState('U-A1'), saved: true }), 4); // 저장만으로는 끝나지 않음
  assert.equal(advance(sc, 4, { ...emptyState('U-A1'), rewinding: true }), 5); // 되감기 모드가 켜지면 끝 카드
  assert.equal(advance(sc, 4, { ...emptyState('U-A1'), readOnly: true }), 5); // 읽기 전용이면 건너뜀
});

test('「?」: U-A1이면 handover, U-D1이면 team, 그 밖이면 고르기(null)', () => {
  assert.equal(scenarioFor('U-A1'), 'handover');
  assert.equal(scenarioFor('U-D1'), 'team');
  assert.equal(scenarioFor('U-K1'), null);
  assert.equal(scenarioFor(''), null);
});

test('설정 moreTools: 기본 접힘, true만 펼침, 깨진 값은 접힘, 저장·읽기 왕복, 저장소 실패는 조용히', () => {
  const KEY = 'wu:v1:settings';
  const d = { provider: 'pregen' };
  assert.equal(loadSettings(memoryStorage(), d).moreTools, undefined);
  assert.equal(loadSettings(null, d).moreTools, undefined);
  for (const bad of ['true', 1, 'yes', null, {}, []]) {
    assert.equal(loadSettings(memoryStorage({ [KEY]: JSON.stringify({ provider: 'pregen', moreTools: bad }) }), d).moreTools, undefined, String(bad));
  }
  assert.equal(loadSettings(memoryStorage({ [KEY]: '{깨진' }), d).moreTools, undefined);
  const st = memoryStorage();
  assert.equal(saveSettings(st, { provider: 'pregen', moreTools: true }), true);
  assert.equal(loadSettings(st, d).moreTools, true);
  assert.equal(saveSettings(st, { provider: 'pregen' }), true); // 접으면 필드를 쓰지 않는다
  assert.equal(JSON.parse(st.map.get(KEY)).moreTools, undefined);
  assert.equal(saveSettings({ setItem() { throw new Error('quota'); } }, { provider: 'pregen', moreTools: true }), false);
  assert.equal(saveSettings(null, { provider: 'pregen', moreTools: true }), false);
});
