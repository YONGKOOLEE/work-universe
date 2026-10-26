// 처음 사용 점검 9회차 P 묶음(FU9-1·3·8·16·24·25·26·27·28, RV13-4·6·7) 단위 검증. 화면 동작은 tools/browser-check.mjs 「FU9 P」가 본다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkDoc, mkNode } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { newRowsToOps, parseTable, parseTypeCell } from '../app/src/model/table.js';
import { extractFromText } from '../app/src/rules/text-extract.js';
import { COMMON_FEATURES, searchFeatures } from '../app/src/view/feature-index.js';
import { searchRecords } from '../app/src/view/recent-records.js';
import { successNotice } from '../app/src/view/record-form.js';
import { HELP_MISTAKES, helpTexts } from '../app/src/ui/help.js';
import { messageFor } from '../app/src/ui/messages.js';

const top = (q, n = 3) => searchFeatures(q, {}, { limit: n }).map((r) => r.id);

test('FU9-1 표 유형 칸: 문서·파일·보고서도 산출물로 받는다(저장 유형은 artifact 그대로)', () => {
  for (const t of ['문서', '파일', '보고서', '자료', '서류', '산출물', 'artifact']) assert.equal(parseTypeCell(t), 'artifact', t);
  assert.equal(parseTypeCell('업무'), 'work');
  assert.equal(parseTypeCell('아무말'), null);
  const t = parseTable('유형\t이름\n문서\t월말 보고서\n업무\t대사 확인');
  const ops = newRowsToOps(t.rows);
  assert.deepEqual(ops.map((o) => o.op), ['addNode', 'addNode']);
  assert.equal(ops[0].input.core_type, 'artifact');
  assert.match(messageFor({ code: 'E-SCHEMA', field: 'core_type', unknown_type: '이상한' }), /문서\(산출물\)/);
});

const shape = (text) => {
  const p = extractFromText(text, null);
  return { nodes: p.nodes.map((n) => `${n.type}:${n.label}`), edges: p.edges.map((e) => `${e.type}:${p.nodes.find((n) => n.key === e.from).label}>${p.nodes.find((n) => n.key === e.to).label}`), unread: p.unread };
};

test('FU9-3 글로 추가: 「A는 X가 맡는다·담당한다」 대상이 앞인 모양', () => {
  assert.deepEqual(shape('예산 조정 요청 처리는 노을빛이 맡는다.'), { nodes: ['person:노을빛', 'work:예산 조정 요청 처리'], edges: ['performs:노을빛>예산 조정 요청 처리'], unread: [] });
  assert.deepEqual(shape('대사 확인은 서하늘이 담당한다.').edges, ['performs:서하늘>대사 확인']);
  // 지난 일·예정·부정은 예전처럼 읽지 않는다
  assert.deepEqual(shape('예산 조정 요청 처리는 노을빛이 맡았다.').edges, []);
  assert.deepEqual(shape('예산 조정 요청 처리는 노을빛이 맡지 않는다.').edges, []);
  // 예전 모양은 그대로
  assert.deepEqual(shape('서하늘이 대사 확인을 맡는다.').edges, ['performs:서하늘>대사 확인']);
});

test('FU9-3 글로 추가: 「A에서 B를 참고한다」는 업무가 문서를 참조한다', () => {
  const s = shape('분기 예산 점검에서 예산 편성 지침을 참고한다.');
  assert.deepEqual(s.edges, ['references:분기 예산 점검>예산 편성 지침']);
  assert.ok(s.nodes.includes('artifact:예산 편성 지침') && s.nodes.includes('work:분기 예산 점검'));
  assert.deepEqual(shape('분기 예산 점검에서 예산 편성 지침을 참고했다.').edges, [], '현재형만');
  assert.deepEqual(shape('분기 예산 점검에서 그것을 참고한다.').edges, [], '문서 이름이 아니면 읽지 않는다');
});

test('FU9-24 찾기: 지우기·삭제·지워·없애기는 항목 숨기기·삭제가 1위, 초기화는 초기화 말에만', () => {
  for (const q of ['지우기', '삭제', '지워', '없애기', '항목 지우기', '항목 삭제']) assert.equal(top(q)[0], 'hide', q);
  assert.ok(!top('지우기', 3).includes('reset'));
  assert.ok(!top('항목 지우기', 3).includes('reset'));
  assert.ok(!top('되돌리기', 3).includes('reset'));
  for (const q of ['초기화', '가상 데이터 초기화', '전부 지우기', '모두 지우기', '다 지우기', '처음 상태', '샘플 지우기']) assert.equal(top(q)[0], 'reset', q);
  assert.deepEqual(top('되돌리기', 2).sort(), ['hidden', 'rewind']);
  const reset = searchFeatures('초기화')[0];
  assert.match(reset.where, /전부 지웁니다/);
  assert.equal(reset.go, 'dlg:import:doc');
});

test('FU9-25·26 찾기: 다른 PC·옮기기·이사는 JSON 내보내기·가져오기, 다시 묻기는 통합 확인', () => {
  for (const q of ['다른 PC로 옮기기', '다른 컴퓨터', '옮기기', '이사']) assert.deepEqual(top(q, 2).sort(), ['json-export', 'json-import'], q);
  assert.equal(top('다시 묻기')[0], 'merge');
  assert.equal(top('삭제')[0], 'hide');
  assert.ok(top('숨기고 싶어').includes('hidden') && top('숨기고 싶어').includes('hide'));
});

test('RV13-4 찾기: 「업무」·「사람」 한 낱말만 쳐도 「사람·업무·문서 추가」가 1위', () => {
  assert.equal(top('업무')[0], 'add');
  assert.equal(top('사람')[0], 'add');
});

test('RV13-6 자주 하는 일: 「이번 주 점검」은 매주 점검 공간으로 간다', () => {
  const c = COMMON_FEATURES.find((x) => x.label === '이번 주 점검');
  assert.equal(c.id, 'weekly-check');
});

test('FU9-24 항목 숨기기 기능: 항목을 먼저 골라야 하고 쓰기 기능이다', () => {
  const r = searchFeatures('숨기기')[0];
  assert.equal(r.id, 'hide');
  assert.equal(r.needs, 'node');
  assert.equal(r.go, 'node:hide');
  assert.equal(searchFeatures('숨기기', { readOnly: true })[0].blocked, '읽기 전용');
});

const AT = (n) => `2026-10-${String(n).padStart(2, '0')}T09:00:00+09:00`;
const docOf = (events) => buildView(mkDoc('U-T', [mkNode('N-W1', 'work', '대사 확인'), mkNode('N-P1', 'person', '김가상')], [], events), () => null);

test('RV13-7 「내가 쓴 메모」: 직접 쓴 기록이 0건이면 안내 표지와 함께 그 말이 든 기록을 낱말로 찾는다', () => {
  const sys = { id: 'E-1', type: 'memo', occurred_at: '2026-10-01', recorded_at: AT(1), source: 'sample', payload: { target_id: 'N-W1', category: 'issue' }, note: '내가 쓴 메모 형식 확인' };
  const none = searchRecords(docOf([]), '내가 쓴 메모');
  assert.equal(none.mineNone, true);
  assert.equal(none.mine, undefined);
  assert.equal(none.total, 0);
  const withWord = searchRecords(docOf([sys]), '내가 쓴 메모');
  assert.equal(withWord.mineNone, true);
  assert.equal(withWord.total, 1, '본문에 그 말이 든 기록은 낱말 찾기로 보인다');
  const mine = searchRecords(docOf([{ ...sys, source: 'user' }]), '내가 쓴 메모');
  assert.equal(mine.mine, true);
  assert.equal(mine.mineNone, undefined);
});

test('FU9-8·12 알림: 숨김 알림은 되살리는 길을 알리고, 표 저장 알림은 개수만 알린다', () => {
  const h = successNotice('hidden-done', { label: '대사 확인' });
  assert.match(h.text, /숨겼습니다/);
  assert.match(h.text, /「숨긴 항목」/);
  assert.deepEqual(h.goto, { type: 'hidden' });
  assert.equal(h.goLabel, '되살리기');
  const t = successNotice('table-saved', { count: 4, summary: '' });
  assert.equal(t.text, '4개를 넣었습니다');
  assert.equal(t.goto, null);
});

test('FU9-28 도움말: 「실수했을 때」 묶음에 되돌리는 길 넷', () => {
  assert.equal(HELP_MISTAKES.length, 4);
  const all = HELP_MISTAKES.map((m) => m.desc).join(' ');
  for (const w of ['숨긴 항목', '편집 되감기', '다시 묻기', '가상 데이터 초기화']) assert.ok(all.includes(w), w);
  assert.ok(helpTexts().includes(HELP_MISTAKES[0].desc));
});

// ── 찾기 화면(DOM 스텁): 출처 표지·직접 쓴 기록 없음 안내 ──
import { installDom, uninstallDom } from './dom-stub.js';
import { featureFind } from '../app/src/ui/feature-find.js';
import { gapBox } from '../app/src/ui/workspace.js';

const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};
const qa = (root, id) => root.querySelectorAll(`[data-testid=${id}]`);

test('FU9-16 찾기: 같은 이름이 지도·기록 두 묶음에 나오면 줄 앞에 출처(지도·기록)가 붙는다', withDom((body) => {
  const box = document.createElement('div');
  body.append(box);
  if (typeof document.addEventListener !== 'function') document.addEventListener = () => {};
  const f = featureFind({
    container: box, search: () => [], onGo() {}, onPick() {}, common: () => [],
    items: () => ({ query: '대사', total: 1, rows: [{ gid: 'U/N-1', label: '대사 확인', type_label: '업무' }] }),
    onItem() {},
    records: () => ({ query: '대사', total: 1, rows: [{ gid: 'U/E-1', date: '2026-10-01', target: '대사 확인', kind: '이슈', text: '대사 불일치', source_chip: null }] }),
    onRecord() {},
  });
  f.input.value = '대사';
  f.input.fire('input');
  assert.deepEqual([...qa(box, 'feature-find-src')].map((e) => e.textContent), ['지도', '기록']);
  // 한 묶음뿐이면 표지가 없다
  const g = featureFind({ container: document.createElement('div'), search: () => [], onGo() {}, onPick() {}, common: () => [], items: () => ({ query: '대사', total: 1, rows: [{ gid: 'U/N-1', label: '대사 확인', type_label: '업무' }] }), onItem() {} });
  g.input.value = '대사';
  g.input.fire('input');
}));

test('RV13-7 찾기: 직접 쓴 기록이 0건이면 안내 한 줄(기록 공간에서 남겨 보세요)', withDom((body) => {
  const box = document.createElement('div');
  body.append(box);
  if (typeof document.addEventListener !== 'function') document.addEventListener = () => {};
  const f = featureFind({ container: box, search: () => [], onGo() {}, onPick() {}, common: () => [], records: () => ({ query: '내 메모', total: 0, rows: [], mineNone: true }), onRecord() {} });
  f.input.value = '내 메모';
  f.input.fire('input');
  assert.match(qa(box, 'feature-find-mine-none')[0].textContent, /아직 직접 쓴 기록이 없습니다 — 「기록」 공간에서 남겨 보세요/);
}));

test('FU9-16 「외 n개」 줄: 누를 수 있는 링크로 해당 인사이트 탭을 연다', withDom(() => {
  let went = 0;
  const box = gapBox({ total: 7, rows: [{ gid: 'U/N-1', label: '업무 A', text: '담당 없음' }], unit: '개' }, () => {}, () => { went += 1; });
  const b = qa(box, 'ws-gaps-more')[0];
  assert.ok(b, '링크 단추');
  assert.match(b.textContent, /밀집·공백/);
  b.fire('click');
  assert.equal(went, 1);
}));
