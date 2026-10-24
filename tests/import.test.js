// T-17 가져오기(미리 보기 → 사람이 가져오기)·내보내기(D-06)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { parseImportText, previewImport } from '../app/src/model/import.js';
import { convertDocument } from '../app/src/rules/doc-convert.js';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { DOC_EXAMPLE } from '../app/data/doc-example.js';
import { exportFileName } from '../app/src/ui/import.js';
import { clone } from './helpers.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const now = () => '2026-10-03T12:00:00+09:00';
const open = (storage, currentId) => createApp({ store: createStore(storage), samples: SAMPLES, currentId, now });
const converted = (owner = '가상 시스템분석팀') => {
  const { doc } = convertDocument(DOC_EXAMPLE.text, { now: now(), random: () => 0.25 });
  doc.universe.owner = owner;
  return doc;
};

test('JSON 읽기: 빈 글·깨진 JSON·배열·너무 큰 글은 원인과 함께 거부', () => {
  assert.equal(parseImportText('').error.reason, 'empty');
  assert.equal(parseImportText('{"a":').error.reason, 'json');
  assert.equal(parseImportText('[1,2]').error.reason, 'shape');
  assert.equal(parseImportText(' '.repeat(10) + 'x'.repeat(5000001)).error.reason, 'too_big');
  const ok = parseImportText('﻿' + JSON.stringify(SAMPLE_A1));
  assert.equal(ok.ok, true, 'BOM이 붙은 파일도 읽는다');
});

test('미리 보기: 문서 변환 결과의 구성·원문 근거·표시 보존·사번 없음 경고', () => {
  const p = previewImport(converted(), { existing: [] });
  assert.equal(p.ok, true);
  assert.equal(p.node_total, 18);
  assert.deepEqual(p.counts.map((c) => `${c.label} ${c.count}`), ['지도 중심 1', '사람 5', '업무 5', '산출물 3', '주제 4']); // CR-18-2
  assert.equal(p.memo_total, 8);
  assert.deepEqual(p.source, { with: 18, total: 18, missing: [] });
  assert.deepEqual(p.marks, { 가정: 2, 미확인: 2 });
  assert.equal(p.warnings.filter((w) => w.code === 'W-NO-EMPNO').length, 5);
  assert.equal(p.conflict, null);
});

test('미리 보기: 작성 주체가 비면 가져올 수 없다(AC ①), 원문 근거가 빠진 노드는 경고', () => {
  const d = converted('');
  const p = previewImport(d);
  assert.equal(p.ok, false);
  assert.deepEqual(p.errors.map((e) => e.path), ['universe.owner']);
  const d2 = converted();
  delete d2.nodes[3].attrs.원문;
  const w = previewImport(d2).warnings.find((x) => x.code === 'W-NO-SOURCE');
  assert.deepEqual(w.ids, [d2.nodes[3].id]);
});

test('미리 보기: 스키마 버전이 다르면 가져오지 않는다, 같은 ID는 충돌로 알린다, 없는 하위 유니버스는 경고', () => {
  const old = clone(SAMPLE_A1);
  old.schema_version = '0.9';
  const p = previewImport(old);
  assert.equal(p.ok, false);
  assert.equal(p.version_mismatch, true);
  const c = previewImport(clone(SAMPLE_A1), { existing: [{ id: 'U-A1', name: '월말 정산 점검' }] });
  assert.equal(c.ok, true);
  assert.equal(c.conflict.id, 'U-A1');
  assert.equal(c.source, null, '원문 근거를 쓰지 않는 유니버스는 근거 검사를 하지 않는다');
  const team = SAMPLES.find((s) => s.universe.id === 'U-T1');
  assert.deepEqual(previewImport(clone(team), { existing: [] }).warnings.find((w) => w.code === 'W-MISSING-CHILD').ids, ['U-A1', 'U-K1']);
});

test('가져오기: 문서 변환 결과를 저장하고 다시 열면 그대로 탐색된다(새로고침 뒤 유지)', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const d = converted();
  const before = clone(d);
  const r = app.importUniverse(d);
  assert.equal(r.ok, true);
  assert.deepEqual(d, before, '넘긴 문서를 바꾸지 않는다');
  const again = open(storage, d.universe.id);
  assert.equal(again.doc.universe.id, d.universe.id);
  assert.equal(again.view.nodes.length, 18);
  assert.ok(again.universes().some((u) => u.id === d.universe.id && !u.is_sample));
  // 가져온 뒤 편집할 수 있다(사번 입력 등)
  assert.equal(again.addNode({ core_type: 'person', label: '가상 담당자', emp_no: 'V-4101' }).ok, true);
});

test('가져오기: 검증 오류·버전 불일치는 저장하지 않는다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const bad = converted('');
  const r = app.importUniverse(bad);
  assert.equal(r.ok, false);
  assert.equal(r.error.reason, 'invalid');
  assert.ok(!app.universes().some((u) => u.id === bad.universe.id));
  const old = converted();
  old.schema_version = '2.0';
  assert.equal(app.importUniverse(old).error.reason, 'version');
  assert.ok(!app.universes().some((u) => u.id === old.universe.id));
});

test('가져오기: 같은 ID가 있으면 덮어쓰기를 확인받은 뒤에만 덮어쓴다', () => {
  const storage = memoryStorage();
  const app = open(storage, 'U-K1');
  const edited = clone(SAMPLE_CARD);
  edited.universe.description = '가져온 판';
  const first = app.importUniverse(edited);
  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'E-DUP');
  assert.notEqual(open(storage, 'U-K1').doc.universe.description, '가져온 판');
  assert.equal(app.importUniverse(edited, { overwrite: true }).ok, true);
  assert.equal(open(storage, 'U-K1').doc.universe.description, '가져온 판');
  assert.equal(app.doc.universe.description, '가져온 판', '지금 연 유니버스를 덮어쓰면 화면 상태도 바뀐다');
});

test('가져오기: 저장소가 없으면(읽기 전용) 막는다', () => {
  const app = createApp({ store: null, samples: SAMPLES, now });
  assert.equal(app.importUniverse(converted()).error.code, 'W-STORAGE');
});

test('가져오기: 저장이 실패하면(용량) 알리고 목록에 남기지 않는다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const d = converted();
  storage.setItem = () => {
    const e = new Error('full');
    e.name = 'QuotaExceededError';
    throw e;
  };
  const r = app.importUniverse(d);
  assert.equal(r.ok, false);
  assert.equal(r.error.reason, 'quota');
});

test('내보내기 → 가져오기: 내보낸 JSON을 다른 저장소에 가져오면 같은 문서다(D-06 다른 PC로 옮기기)', () => {
  const a = open(memoryStorage());
  a.addNode({ core_type: 'artifact', label: '내보내기 시험 문서' });
  const text = a.exportJson();
  const parsed = parseImportText(text);
  assert.equal(parsed.ok, true);
  const b = open(memoryStorage(), 'U-K1');
  const r = b.importUniverse(parsed.doc, { overwrite: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc, a.doc);
  assert.equal(exportFileName(a.doc.universe), '월말_정산_점검-U-A1.json');
  assert.equal(exportFileName({ name: 'a/b:c*?', id: 'U-X' }), 'a_b_c_-U-X.json');
});

// N-2(2026-10-03): 같은 문서를 두 번 가져오면 ID가 달라 충돌로 안 걸린다 → 이름·단위가 같으면 알린다(막지는 않음)
test('미리 보기: 이름·단위가 같은 유니버스가 있으면 W-SAME-NAME으로 알리고, 이름을 바꾸면 사라진다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  assert.equal(app.importUniverse(converted()).ok, true);
  const again = convertDocument(DOC_EXAMPLE.text, { now: now(), random: () => 0.75 }).doc;
  again.universe.owner = '가상 시스템분석팀';
  const p = app.previewImport(again);
  assert.equal(p.ok, true);
  assert.equal(p.conflict, null);
  assert.equal(p.same_name.name, '대형가맹점 A 카드승인 전문 송수신 신규 업무');
  assert.ok(p.warnings.some((w) => w.code === 'W-SAME-NAME'));
  again.universe.name = '대형가맹점 A 카드승인(2차)';
  assert.equal(app.previewImport(again).same_name, null);
  // 단위가 다르면 다른 유니버스로 본다
  const team = clone(again);
  team.universe.name = '대형가맹점 A 카드승인 전문 송수신 신규 업무';
  team.universe.level = '팀';
  assert.equal(app.previewImport(team).same_name, null);
});
