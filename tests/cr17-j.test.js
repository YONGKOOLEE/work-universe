// CR-17 J ⑩(승인 전 준비): 인수인계 초안 「산출물·문서 위치」가 업무에서 「참조」(references)로 이은 산출물도 읽는다.
// 업무정의서 변환(CR-17 J ③ relatedDocLink)이 「관련 문서」를 업무 → 산출물 「참조」로 잇기 때문이다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../app/src/view/view.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { convertDocument } from '../app/src/rules/doc-convert.js';
import { fillHintOf } from '../app/src/ui/draft-hints.js';
import { mkDoc, mkEdge, mkNode } from './helpers.js';

const ASOF = '2026-10-24';
const U = 'U-CR17J';
const gid = (n) => `${U}/${n}`;
const view = (doc) => buildView(doc, () => null);
const draft = (doc, target, from = 'N-101', to = 'N-102') => buildHandoverDraft(view(doc), { target: gid(target), from: gid(from), to: gid(to), asOf: ASOF });
const item = (r, key) => r.draft.items.find((i) => i.key === key);
const texts = (r) => item(r, '산출물_문서').sentences.map((s) => s.text);

function docWith(extraEdges = [], extraNodes = []) {
  const nodes = [
    mkNode('N-001', 'work', '대사 확인'),
    mkNode('N-002', 'work', '보고 작성'),
    mkNode('N-101', 'person', '가상인1'),
    mkNode('N-102', 'person', '가상인2'),
    mkNode('N-210', 'artifact', '대사표', { attrs: { 위치: '공유 드라이브 > 재무' } }),
    mkNode('N-211', 'artifact', '지침서'),
    ...extraNodes,
  ];
  return mkDoc(U, nodes, [mkEdge('N-000', 'N-001', 'contains'), mkEdge('N-000', 'N-002', 'contains'), ...extraEdges]);
}

test('J ⑩: 업무 → 산출물 「참조」도 「산출물·문서 위치」에 나온다(위치 속성 포함, 「에서 참조」), 근거는 산출물 노드', () => {
  const r = draft(docWith([mkEdge('N-001', 'N-210', 'references')]), 'N-000');
  assert.equal(item(r, '산출물_문서').insufficient, false);
  assert.deepEqual(texts(r), ['대사표, 위치: 공유 드라이브 > 재무 — 대사 확인에서 참조']);
  assert.deepEqual(item(r, '산출물_문서').sentences[0].evidence_ids, [gid('N-210')]);
});

test('J ⑩: 「산출」(만듦)이 먼저, 「참조」가 그 뒤 — 기존 「산출」 문장은 그대로', () => {
  const r = draft(docWith([mkEdge('N-001', 'N-211', 'references'), mkEdge('N-001', 'N-210', 'produces')]), 'N-001');
  assert.deepEqual(texts(r), ['대사표, 위치: 공유 드라이브 > 재무 — 대사 확인에서 만듦', '지침서 — 대사 확인에서 참조']);
});

test('J ⑩: 같은 업무가 같은 산출물을 만들고 참조도 하면 만듦 한 줄만', () => {
  const r = draft(docWith([mkEdge('N-001', 'N-210', 'produces'), mkEdge('N-001', 'N-210', 'references')]), 'N-001');
  assert.deepEqual(texts(r), ['대사표, 위치: 공유 드라이브 > 재무 — 대사 확인에서 만듦']);
});

test('J ⑩: 산출물이 아닌 노드(주제·사람) 참조, 숨긴 산출물·숨긴 연결, 범위 밖 업무의 참조는 세지 않는다', () => {
  const doc = docWith(
    [
      mkEdge('N-001', 'N-300', 'references'), // 주제
      mkEdge('N-001', 'N-101', 'references'), // 사람
      mkEdge('N-001', 'N-301', 'references'), // 숨긴 산출물
      mkEdge('N-001', 'N-211', 'references', { hidden: true }), // 숨긴 연결
      mkEdge('N-400', 'N-210', 'references'), // 범위 밖 업무
      mkEdge('N-211', 'N-001', 'references'), // 방향이 반대(산출물 → 업무)
    ],
    [mkNode('N-300', 'topic', '가상 주제'), mkNode('N-301', 'artifact', '숨은 문서', { hidden: true }), mkNode('N-400', 'work', '다른 업무')],
  );
  const r = draft(doc, 'N-001'); // 대상이 업무: 범위는 그 업무뿐
  assert.equal(item(r, '산출물_문서').insufficient, true);
});

test('J ⑩: 참조도 산출도 없으면 지금처럼 이력 부족', () => {
  assert.equal(item(draft(docWith(), 'N-000'), '산출물_문서').insufficient, true);
});

test('J ⑩: 업무정의서 변환 결과(관련 문서 → 업무 참조)로 만든 초안에 「산출물·문서 위치」가 채워진다', () => {
  const text = '# 가상 업무정의서\n- 작성 부서: 가상팀\n## 업무 범위\n- 가상 접수\n## 관련 문서\n- 가상 계산표(공유 드라이브 > 재무)\n';
  const conv = convertDocument(text, { now: '2026-10-24T10:00:00+09:00', random: () => 0.5 });
  assert.equal(conv.ok, true);
  const doc = conv.doc;
  doc.nodes.push(mkNode('N-901', 'person', '가상인1'), mkNode('N-902', 'person', '가상인2'));
  const v = buildView(doc, () => null);
  const uid = doc.universe.id;
  const work = doc.nodes.find((n) => n.core_type === 'work');
  const art = doc.nodes.find((n) => n.core_type === 'artifact');
  const r = buildHandoverDraft(v, { target: `${uid}/${doc.universe.root_node_id}`, from: `${uid}/N-901`, to: `${uid}/N-902`, asOf: ASOF });
  assert.ok(work);
  const it = r.draft.items.find((i) => i.key === '산출물_문서');
  assert.equal(it.insufficient, false);
  assert.match(it.sentences[0].text, /^가상 계산표, 위치: 공유 드라이브 > 재무 — 가상 접수에서 참조$/);
  assert.deepEqual(it.sentences[0].evidence_ids, [`${uid}/${art.id}`]);
});

test('J ⑩: 「채우려면」 문구가 「산출」(만든 문서)과 「참조」(참고한 문서)를 모두 말한다', () => {
  const t = fillHintOf('산출물_문서');
  assert.match(t, /「산출」\(만든 문서\)/);
  assert.match(t, /「참조」\(참고한 문서\)/);
  assert.match(t, /「위치」/);
});
