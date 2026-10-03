// 테스트 공용 헬퍼(검토 C-9·C-10). 테스트 파일에서만 쓴다.
import { SAMPLES } from '../app/data/index.js';
import { buildView } from '../app/src/view/view.js';

/** 객체·배열을 안쪽까지 동결한다(같은 객체를 돌려준다). */
export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj)) deepFreeze(v);
  return obj;
}

/** JSON 깊은 복사. 공용 샘플을 바꿔야 하는 테스트는 먼저 이것으로 복사한다. */
export const clone = (x) => JSON.parse(JSON.stringify(x));

// 내장 샘플 전체(id → 문서). 한 번만 만들고 깊게 동결한다 — 공용 샘플을 직접 바꾸는 테스트는 바로 TypeError로 드러난다.
const ALL = deepFreeze(Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d])));

/** 내장 샘플 맵(id → 문서, 동결됨). */
export const allSamples = () => ALL;

/** 샘플 id의 전체 뷰. override에 { id: 문서 }를 주면 그 문서로 바꿔 본다. */
export const viewOf = (id, override = {}) => buildView(override[id] || ALL[id], (x) => override[x] || ALL[x] || null);

// ── 작은 가상 문서 만들기(review3·review4 공용) ──
export const FIXTURE_TS = '2026-09-01T00:00:00+09:00';

export const mkNode = (id, t, l, r = {}) => ({ id, core_type: t, label: l, hidden: false, created_at: FIXTURE_TS, updated_at: FIXTURE_TS, ...r });

let edgeSeq = 0; // 테스트 파일마다 프로세스가 따로라 파일별로 1부터 센다
export const mkEdge = (s, t, c, r = {}) => ({ id: `L-${++edgeSeq}`, source: s, target: t, core_type: c, hidden: false, created_at: FIXTURE_TS, ...r });

export const mkDoc = (id, nodes, edges, events = [], extra = {}) => ({
  schema_version: '1.0',
  universe: { id, name: id, level: '팀', root_node_id: 'N-000', subtypes: [], created_at: FIXTURE_TS },
  nodes: [mkNode('N-000', 'root', id), ...nodes], edges, events, refs: [], identity_links: [], ...extra,
});
