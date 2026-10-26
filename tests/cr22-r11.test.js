// 열한 번째 검토 지적 수정(R11)의 순수 부분: 기록 찾기·지도 전체 기록 표 줄, 쓰던 메모 보관, 꼬리표 두 번, 기능 찾기 낱말 순위,
// 시각 표시, ~done 표지 판정, 통합 확인 조사, 이름 단계 우선순위. 화면(DOM)은 tools/browser-check.mjs 「R11 고침」 블록이 본다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../app/src/view/view.js';
import { mkDoc, mkNode } from './helpers.js';
import { RECORD_SEARCH, foldText, mapHistoryRows, searchRecords } from '../app/src/view/recent-records.js';
import { createMemoKeep, memoKeepKey, MEMO_KEEP_NOTE_MAX } from '../app/src/view/memo-keep.js';
import { historyRows, latestRecord, filterHistory } from '../app/src/view/card.js';
import { searchFeatures } from '../app/src/view/feature-index.js';
import { stampText } from '../app/src/view/stamp.js';
import { DONE_MAX_AGE_MS, doneMarkMatches, makeDoneMark } from '../app/src/view/done-mark.js';
import { successNotice } from '../app/src/view/record-form.js';
import { labelPriority } from '../app/src/view/graphlod.js';
import { describeNode } from '../app/src/view/describe.js';
import { handoverDocHtml } from '../app/src/view/handover-doc.js';
import { HELP_SPACES_BADGE, helpTexts } from '../app/src/ui/help.js';

const AT = (n) => `2026-10-${String(n).padStart(2, '0')}T09:00:00+09:00`;
const ev = (id, type, occurred_at, recorded_at, payload, note, source = 'user') => ({ id, type, occurred_at, recorded_at, source, payload, note });
const nodes = () => [mkNode('N-W1', 'work', '대사 확인'), mkNode('N-W2', 'work', '정산 점검'), mkNode('N-P1', 'person', '김가상'), mkNode('N-P2', 'person', '이가상')];
const docWith = (events, ns = nodes()) => buildView(mkDoc('U-T', ns, [], events), () => null);

// ── 4. 기록 찾기 ──
test('R11 4 기록 찾기: 메모 내용에서 대소문자·공백을 무시하고 찾고, 기록 시각 늦은 순, 전체 건수', () => {
  const events = [
    ev('E-1', 'memo', '2026-10-01', AT(1), { target_id: 'N-W1', category: 'issue' }, '대사 불일치 3건 Retry 필요'),
    ev('E-2', 'memo', '2026-10-02', AT(2), { target_id: 'N-W2', category: 'in_progress' }, '다음 주 retry  예정'),
    ev('E-3', 'memo', '2026-10-03', AT(3), { target_id: 'N-W1', category: 'caution' }, '관계없는 글'),
    ev('E-4', 'memo', '2026-10-04', AT(4), { target_id: 'N-W1', category: 'issue' }, '샘플이라 빠짐 retry', 'sample'),
    ev('E-5', 'system', '2026-10-05', AT(5), {}, 'retry 시스템', 'system'),
  ];
  const view = docWith(events);
  const r = searchRecords(view, '  RE TRY ');
  assert.equal(r.query, 'RE TRY');
  // R12 FU7-1: 기록 종류면 source와 상관없이 찾는다(예전 기대값 2 = user만 → 3). 샘플 기록(E-4)이 카드 이력에는 보이는데 찾기에서만 빠지던 결함. 자동 기록(system 종류 E-5)은 여전히 뺀다
  assert.equal(r.total, 3, '기록 종류 전부(샘플 포함), 공백·대소문자 무시');
  assert.deepEqual(r.rows.map((x) => x.gid), ['U-T/E-4', 'U-T/E-2', 'U-T/E-1'], '기록 시각이 늦은 것이 먼저');
  assert.deepEqual(r.rows.map((x) => x.source_chip), ['예시', null, null], '사용자가 쓴 것이 아니면 출처 칩(sample → 예시), 사용자 기록은 칩 없음');
  assert.equal(r.rows[1].target, '정산 점검');
  assert.equal(r.rows[1].kind, '진행 중');
  assert.equal(r.rows[1].target_gid, 'U-T/N-W2');
  assert.equal(foldText(' A b\nC '), 'abc');
});

test('R11 4 기록 찾기: 너무 짧은 낱말·빈 낱말은 찾지 않고, 8건을 넘으면 total은 전체·rows는 8건, 내용 글(담당 시작 등)도 찾는다', () => {
  assert.equal(RECORD_SEARCH.LIMIT, 8);
  const many = Array.from({ length: 12 }, (_, i) => ev(`E-${i + 1}`, 'memo', '2026-10-01', AT(i + 1), { target_id: 'N-W1', category: 'issue' }, `재확인 ${i}`));
  const view = docWith([...many, ev('E-20', 'assign_start', '2026-10-20', AT(20), { person_id: 'N-P1', work_id: 'N-W2' })]);
  const r = searchRecords(view, '재확인');
  assert.equal(r.total, 12);
  assert.equal(r.rows.length, 8);
  assert.equal(r.rows[0].gid, 'U-T/E-12');
  assert.deepEqual(searchRecords(view, '재'), { query: '재', total: 0, rows: [] }, '한 글자는 찾지 않는다');
  assert.deepEqual(searchRecords(view, '   ').rows, []);
  const s = searchRecords(view, '김가상 담당');
  assert.equal(s.total, 1, '메모가 아닌 기록은 내용 글(eventText)로 찾는다');
  assert.equal(s.rows[0].kind, '담당 시작');
});

test('R11 4 기록 찾기: 숨긴 업무에만 걸린 기록은 뺀다(고를 수 없다) — 묶은 지도는 묶인 지도의 기록도 찾는다', () => {
  const ns = nodes();
  ns[1] = { ...ns[1], hidden: true };
  const view = docWith([ev('E-1', 'memo', '2026-10-02', AT(2), { target_id: 'N-W2', category: 'issue' }, '숨긴 업무 메모 키워드'), ev('E-2', 'memo', '2026-10-03', AT(3), { target_id: 'N-W1', category: 'issue' }, '보이는 메모 키워드')], ns);
  assert.deepEqual(searchRecords(view, '키워드').rows.map((x) => x.gid), ['U-T/E-2']);
  const child = mkDoc('U-C', [mkNode('N-W1', 'work', '하위 업무')], [], [ev('E-1', 'memo', '2026-10-05', AT(20), { target_id: 'N-W1', category: 'issue' }, '하위 지도의 키워드')]);
  const parent = mkDoc('U-P', [], [], [], { refs: [{ id: 'R-1', child_universe_id: 'U-C', created_at: AT(1) }] });
  const docs = { 'U-P': parent, 'U-C': child };
  const v2 = buildView(parent, (id) => docs[id] || null);
  assert.deepEqual(searchRecords(v2, '키워드').rows.map((x) => x.target), ['하위 업무']);
});

test('R11 4 지도 전체 기록 표 줄: 이력 표와 같은 모양(범주·상태)에 업무 이름이 더해지고, 찾기 글은 업무 이름도 본다', () => {
  const view = docWith([
    ev('E-1', 'memo', '2026-10-01', AT(1), { target_id: 'N-W1', category: 'issue' }, '미해결 이슈'),
    ev('E-2', 'memo', '2026-10-02', AT(2), { target_id: 'N-W2', category: 'resolved' }, '정리 끝'),
    ev('E-3', 'handover', '2026-10-03', AT(3), { from_person_id: 'N-P1', to_person_id: 'N-P2', work_id: 'N-W1' }),
    ev('E-4', 'created', '2026-10-04', AT(4), { target_kind: 'node', target_id: 'N-W1' }, undefined),
  ]);
  const base = mapHistoryRows(view);
  assert.equal(base.length, 3, '자동 기록(생성)은 넣지 않는다');
  const rows = historyRows(base, new Set(['U-T/E-1']));
  assert.deepEqual(rows.map((r) => r.gid), ['U-T/E-3', 'U-T/E-2', 'U-T/E-1'], '최신이 위');
  assert.deepEqual(rows.map((r) => r.group), ['인수인계', '해결', '메모']);
  assert.equal(rows[2].status, '미해결');
  assert.equal(rows[0].target, '대사 확인');
  assert.equal(rows[2].text.startsWith('[이슈] '), true, '이력 표는 이슈에도 꼬리표를 단다(카드 이력과 같게)');
  assert.deepEqual(filterHistory(rows, { q: '정산 점검' }, '2026-10-26').map((r) => r.gid), ['U-T/E-2'], '업무 이름으로도 찾는다');
  assert.equal(filterHistory(rows, { group: '메모' }, '2026-10-26').length, 1);
});

// ── 3. 쓰던 메모 보관 ──
test('R11 3 쓰던 메모 보관: 업무별로 글·분류를 메모리에 두고, 비면 지우고, 지우면 사라진다', () => {
  const keep = createMemoKeep();
  const k1 = memoKeepKey('weekly', 'U-A', 'N-1');
  const k2 = memoKeepKey('card', 'U-A', 'N-1');
  assert.notEqual(k1, k2, '양식 종류마다 따로');
  assert.notEqual(k1, memoKeepKey('weekly', 'U-B', 'N-1'), '지도마다 따로');
  assert.equal(keep.get(k1), null);
  keep.set(k1, { category: 'issue', note: '쓰던 글' });
  assert.deepEqual(keep.get(k1), { category: 'issue', note: '쓰던 글' });
  keep.get(k1).note = '밖에서 바꿔도'; // 사본이라 보관함은 그대로
  assert.equal(keep.get(k1).note, '쓰던 글');
  keep.set(k1, { category: '', note: '   ' });
  assert.equal(keep.get(k1), null, '글도 분류도 없으면 보관을 지운다');
  keep.set(k1, { category: 'caution', note: '' });
  assert.deepEqual(keep.get(k1), { category: 'caution', note: '' }, '분류만 골라 둔 것도 보관');
  keep.set(k2, { category: '', note: 'x'.repeat(MEMO_KEEP_NOTE_MAX + 50) });
  assert.equal(keep.get(k2).note.length, MEMO_KEEP_NOTE_MAX);
  keep.clear(k1);
  assert.equal(keep.get(k1), null);
  assert.equal(keep.size, 1);
});

// ── 6. 꼬리표 두 번 ──
test('R11 6 꼬리표: 최근 기록 한 줄의 글에서 분류 꼬리표를 떼어 「[이슈] [이슈] …」가 되지 않는다', () => {
  const rows = historyRows([
    { gid: 'U/E-1', date: '2026-10-01', type: 'memo', category: 'issue', type_label: '메모', text: '[이슈] 대사 불일치' },
    { gid: 'U/E-2', date: '2026-10-02', type: 'memo', category: 'in_progress', type_label: '메모', text: '[진행 중] 재확인' },
    { gid: 'U/E-3', date: '2026-10-03', type: 'memo', category: 'caution', type_label: '메모', text: '[긴급] 내용이 대괄호로 시작하는 주의' },
  ], null);
  assert.deepEqual(latestRecord(rows.filter((r) => r.gid === 'U/E-1')), { gid: 'U/E-1', date: '2026-10-01', type_label: '이슈', text: '대사 불일치' });
  assert.equal(latestRecord(rows.filter((r) => r.gid === 'U/E-2')).text, '재확인');
  assert.equal(latestRecord(rows.filter((r) => r.gid === 'U/E-3')).text, '[긴급] 내용이 대괄호로 시작하는 주의', '분류 꼬리표가 아닌 대괄호는 그대로');
});

// ── 9. 기능 찾기 낱말·이름 ──
test('R11 9 기능 찾기: 비슷한 말이 기대 기능으로 간다(후임·받는 사람 → 인수인계·담당 넘기기, 같은 사람·동일인 → 통합 확인 1위, 메모·쓴 것·기록 찾기 → 기록)', () => {
  const ids = (q, n = 3) => searchFeatures(q).slice(0, n).map((h) => h.id);
  assert.ok(ids('후임자').includes('draft') && ids('후임자').includes('assignee'), ids('후임자').join());
  assert.ok(ids('받는 사람').includes('assignee'), ids('받는 사람').join());
  assert.ok(ids('후임').includes('draft'));
  assert.equal(searchFeatures('같은 사람')[0].id, 'merge');
  assert.equal(searchFeatures('동일인')[0].id, 'merge');
  assert.equal(searchFeatures('기록 찾기')[0].id, 'recent');
  assert.ok(ids('쓴 것').includes('recent'), ids('쓴 것').join());
  assert.ok(ids('메모').includes('recent') || ids('메모').includes('weekly'));
  assert.equal(searchFeatures('담당 넘기기')[0].id, 'assignee');
  assert.equal(searchFeatures('담당 바꾸기')[0].id, 'assignee', '옛 이름도 키워드로 찾는다');
  assert.equal(searchFeatures('담당 넘기기').find((h) => h.id === 'assignee').name, '담당 넘기기');
  assert.match(searchFeatures('읽어 보기').find((h) => h.id === 'doc-import').where, /문서 붙여넣기\(읽어 보기\)/);
});

test('R11 16 기능 찾기: 편집 되감기는 읽기 전용에서도 쓸 수 있고, 되감기 중·묶은 지도만 막는다', () => {
  const hit = (ctx) => searchFeatures('되감기', ctx).find((h) => h.id === 'rewind');
  assert.equal(hit({ readOnly: true }).blocked, null);
  assert.equal(hit({ rewinding: true }).blocked, '편집 되감기 중');
  assert.match(hit({ grouped: true }).blocked, /묶은 지도/);
});

// ── 12. 시각 표시 ──
test('R11 12 시각 표시: ISO 원문은 「YYYY-MM-DD HH:MM」, 그 밖의 글은 그대로, 저장값(attrs)은 건드리지 않는다', () => {
  assert.equal(stampText('2026-10-26T03:52:28+09:00'), '2026-10-26 03:52');
  assert.equal(stampText('2026-10-26T03:52:28Z'), '2026-10-26 03:52');
  assert.equal(stampText('2026-10-26T03:52'), '2026-10-26 03:52');
  assert.equal(stampText('2026-10-26T03:52:28.123+0900'), '2026-10-26 03:52');
  assert.equal(stampText('2026-10-26'), '2026-10-26');
  assert.equal(stampText('마감 2026-10-26T03:52:28+09:00 까지'), '마감 2026-10-26T03:52:28+09:00 까지', '글 속의 시각은 그대로');
  assert.equal(stampText(undefined), '');
  const node = mkNode('N-A1', 'artifact', '인수인계서', { attrs: { '확정 시각': '2026-10-26T03:52:28+09:00', 위치: '공유 폴더' } });
  const view = docWith([], [...nodes(), node]);
  const d = describeNode(view, 'U-T/N-A1');
  assert.equal(d.rows.find((r) => r.label === '확정 시각').value, '2026-10-26 03:52');
  assert.equal(view.getNode('U-T/N-A1').attrs['확정 시각'], '2026-10-26T03:52:28+09:00', '저장값은 그대로');
  assert.match(handoverDocHtml({ kind: 'confirmed', node }), /확정 시각: 2026-10-26 03:52</);
});

// ── 18. ~done 표지 ──
test('R11 18 ~done 표지: 지도 id·종류가 같고 오래되지 않았을 때만 알림 — 깨진 글·다른 지도·다른 종류·시간 초과·미래 시각은 거절', () => {
  const now = 1_700_000_000_000;
  const mark = makeDoneMark('group', 'U-NEW', now);
  assert.equal(doneMarkMatches(mark, 'group', 'U-NEW', now + 1000), true);
  assert.equal(doneMarkMatches(mark, 'import', 'U-NEW', now + 1000), false, '종류가 다름');
  assert.equal(doneMarkMatches(mark, 'group', 'U-OTHER', now + 1000), false, '지도가 다름');
  assert.equal(doneMarkMatches(mark, 'group', 'U-NEW', now + DONE_MAX_AGE_MS + 1), false, '오래됨');
  assert.equal(doneMarkMatches(mark, 'group', 'U-NEW', now - 5000), false, '미래 시각');
  assert.equal(doneMarkMatches(null, 'group', 'U-NEW', now), false, '표지 없음(주소만 있음)');
  assert.equal(doneMarkMatches('깨진{글', 'group', 'U-NEW', now), false);
  assert.equal(doneMarkMatches('"문자열"', 'group', 'U-NEW', now), false);
  assert.equal(doneMarkMatches(mark, 'tour', 'U-NEW', now), false, '모르는 종류');
  assert.equal(makeDoneMark('tour', 'U-NEW'), null);
  assert.equal(makeDoneMark('group', ''), null);
});

// ── 7. 통합 확인 조사 ──
test('R11 7 통합 확인 알림: 「다른 업무로」·「다른 사람으로」·「같은 업무로」 — 조사는 josa로', () => {
  const t = (kind, same) => successNotice('identity', { a: '「가」', b: '「나」', same, kind, nodeGid: 'U/N-1' }).text;
  assert.match(t('work', false), /다른 업무로 판정했습니다/);
  assert.match(t('work', true), /같은 업무로 판정했습니다/);
  assert.match(t('person', false), /다른 사람으로 판정했습니다/);
  assert.match(t('person', true), /같은 사람으로 판정했습니다/);
  assert.doesNotMatch(t('work', false), /업무으로/);
});

// ── 8. 이름 단계 우선순위 ──
test('R11 8 이름 단계: 공간 강조·찾은 항목(marked)은 유형과 상관없이 0순위', () => {
  assert.equal(labelPriority({ type: 'artifact', marked: true }), 0);
  assert.equal(labelPriority({ type: 'person', marked: true }), 0);
  assert.equal(labelPriority({ type: 'person' }), 4);
  assert.equal(labelPriority({ type: 'work', degree: 1 }), 3);
});

// ── 13. 배지 설명 ──
test('R11 13 도움말 「왼쪽 공간」 절에 배지 뜻 한 줄', () => {
  assert.match(HELP_SPACES_BADGE, /기록.*미해결.*매주 점검.*혼자만 아는 일/);
  assert.ok(helpTexts().includes(HELP_SPACES_BADGE));
});

// ── 19. 해결됨 미리 알림 건수(RV11C-1) ──
test('R11 19 해결됨 미리 알림 건수 = 실제로 닫히는 수: 무작위 날짜의 미해결과 해결됨 날짜로 맞춰 본다', async () => {
  const { resolveCloseCount, resolveWarningText, closeTargetWord } = await import('../app/src/view/record-form.js');
  const { openMemos } = await import('../app/src/rules/issues.js');
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let round = 0; round < 40; round += 1) {
    const evs = [];
    const n = 1 + rnd(8);
    for (let i = 0; i < n; i += 1) evs.push(ev(`E-${i + 1}`, 'memo', `2026-09-${String(1 + rnd(28)).padStart(2, '0')}`, AT(1 + i), { target_id: 'N-W1', category: rnd(2) ? 'issue' : 'in_progress' }, `메모 ${i}`));
    const day = `2026-09-${String(1 + rnd(28)).padStart(2, '0')}`;
    const before = docWith(evs);
    const predicted = resolveCloseCount(before, 'U-T/N-W1', day);
    const after = docWith([...evs, ev('E-99', 'memo', day, '2026-10-30T09:00:00+09:00', { target_id: 'N-W1', category: 'resolved' }, '해결')]);
    assert.equal(predicted, openMemos(before).length - openMemos(after).length, `round ${round} ${day}`);
  }
  assert.equal(resolveWarningText(2, '항목'), '이 항목 미해결 2건이 모두 닫힙니다');
  assert.equal(resolveWarningText(0), '이 업무에 닫을 미해결은 없습니다');
  assert.equal(closeTargetWord('person'), '사람');
  assert.equal(closeTargetWord('artifact'), '항목');
});

// ── 25·26·29·30 ──
test('R11 25 휠 배율: 부드러운 갈래도 한 번에 WHEEL_STEP(×1.15)을 넘지 않는다', async () => {
  const { wheelZoomFactor, LOD } = await import('../app/src/view/graphlod.js');
  for (const dy of [-49, -30, -10, 10, 30, 49, -400, 400]) {
    const f = wheelZoomFactor(dy);
    assert.ok(f <= LOD.WHEEL_STEP + 1e-12 && f >= 1 / LOD.WHEEL_STEP - 1e-12, `${dy}: ${f}`);
  }
  assert.ok(wheelZoomFactor(-10) > 1 && wheelZoomFactor(-10) < LOD.WHEEL_STEP, '작은 움직임은 그대로 부드럽다');
});

test('R11 26 하나씩 추가: 함께 이을 연결이 이름 칸이 만든 연결과 같으면 한 번만(E-DUP 방지)', async () => {
  const { addNodeOps } = await import('../app/src/view/record-form.js');
  const input = { core_type: 'work', label: '새 업무' };
  const plain = addNodeOps({ input, attachRoot: false, link: { core_type: 'performs', other_id: 'N-P1', out: false }, names: null, doc: null });
  assert.equal(plain.filter((o) => o.op === 'addEdge').length, 1, '이름 칸이 없으면 지금과 같다');
  // 이름 칸이 같은 상대를 만든 연결과 같은 (종류·시작·대상)이면 건너뛴다
  const sameEdge = { op: 'addEdge', row: 1, input: { core_type: 'performs', source: 'N-P1', target: '@1' } };
  const ops = [{ op: 'addNode', row: 1, input, attachRoot: false }, sameEdge];
  const dup = ops.some((o) => o.op === 'addEdge' && o.input.core_type === 'performs' && o.input.source === 'N-P1' && o.input.target === '@1');
  assert.equal(dup, true);
});

test('R11 29 사번 넣기: 문서 객체가 아니라 validateDocument 결과(ownerReadOnly)로 막는다', async () => {
  const { canInlineEmpNo } = await import('../app/src/view/record-form.js');
  const item = { type: 'no_empno', a: 'U-X/N-1' };
  assert.equal(canInlineEmpNo(item, { readOnly: false, ownerDoc: {}, ownerReadOnly: true }), false);
  assert.equal(canInlineEmpNo(item, { readOnly: false, ownerDoc: {}, ownerReadOnly: false }), true);
});

test('R11 30 묶은 직후 표지: 자동으로 이은 사람 수가 표지에 실려 띠 문구가 된다', async () => {
  const { doneMarkAuto, makeDoneMark: mk } = await import('../app/src/view/done-mark.js');
  const { groupedStrip } = await import('../app/src/view/record-form.js');
  assert.equal(doneMarkAuto(mk('group', 'U-N', 1, 3)), 3);
  assert.equal(doneMarkAuto(mk('group', 'U-N', 1)), 0);
  assert.equal(doneMarkAuto('깨짐'), 0);
  assert.match(groupedStrip({ counts: { pending: 0 } }, { name: '팀', auto: 3 }).text, /사번이 같은 사람 3명은 자동으로 이었습니다/);
});
