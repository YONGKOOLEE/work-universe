// 가상 데이터 v2(T-13, 03-plan 7.2 기본안): 사례 3 — 조직관리 유니버스 U-O (02-design 4절, 1.6).
// 사람·조직이 이 유니버스의 "업무 데이터"다. 소속은 기간이 있는 소속 연결과 소속 변경 이벤트로 남긴다.
// 조직개편 2회: 2025-07(운영팀 2명 → 행사팀), 2026-01(가상운영팀 폐지 → 가상정산팀·가상교육팀 신설, 소속 변경 12건).
// 2026-03 이후 입력이 없다(입력 중단 예외): 그 뒤 인력 분포는 "데이터 부족(마지막 입력 2026-03)"이어야 한다(R-05 ②).
// 업무 유니버스의 사람과는 통합할 때 사번으로만 대응한다(1.6). 모든 이름·사번·조직명은 가상이다(R-06). 고치면 STAMP를 바꾼다.

const STAMP = '2026-10-04T00:10:00+09:00'; // 검토5 V-5: 부서 유니버스(U-D1)와 같은 이름

const node = (id, core_type, label, rest = {}) => ({ id, core_type, label, ...rest, hidden: false, created_at: STAMP, updated_at: STAMP });
let seq = 0;
const edge = (source, target, core_type, rest = {}) => {
  seq += 1;
  return { id: `L-${String(seq).padStart(3, '0')}`, source, target, core_type, ...rest, hidden: false, created_at: STAMP };
};
let eseq = 0;
const event = (type, occurred_at, payload, note) => {
  eseq += 1;
  return { id: `E-${String(eseq).padStart(3, '0')}`, type, occurred_at, recorded_at: STAMP, source: 'sample', payload, ...(note ? { note } : {}) };
};

// 사람: [노드 ID, 이름, 사번, 처음 소속, (바뀐 날짜, 바뀐 소속)]
const OPS = 'N-002'; // 가상운영팀(2025-12-31 폐지)
const SETTLE = 'N-003'; // 가상정산팀(2026-01-01 신설)
const EVENT = 'N-004'; // 가상행사팀
const EDU = 'N-005'; // 가상교육팀(2026-01-01 신설)
const PEOPLE = [
  ['N-101', '한가람', 'V-1001', OPS, '2026-01-01', SETTLE],
  ['N-102', '윤바다', 'V-1002', OPS, '2026-01-01', SETTLE],
  ['N-103', '서하늘', 'V-1003', OPS, '2026-01-01', SETTLE],
  ['N-104', '금빛나', 'V-1004', OPS, '2026-01-01', SETTLE],
  ['N-105', '여울찬', 'V-1005', OPS, '2026-01-01', SETTLE],
  ['N-106', '단비아', 'V-1006', OPS, '2026-01-01', SETTLE],
  ['N-107', '새론결', 'V-1007', OPS, '2026-01-01', SETTLE],
  ['N-108', '해솔음', 'V-1008', OPS, '2026-01-01', SETTLE],
  ['N-201', '도하람', 'V-2001', EVENT],
  ['N-202', '별하윤', 'V-2002', EVENT],
  ['N-203', '온새미', 'V-2003', EVENT],
  ['N-204', '늘봄이', 'V-2004', OPS, '2025-07-01', EVENT],
  ['N-205', '초롱결', 'V-2005', OPS, '2025-07-01', EVENT],
  ['N-301', '나래솔', 'V-3001', OPS, '2026-01-01', EDU],
  ['N-302', '이든빛', 'V-3002', OPS, '2026-01-01', EDU],
  ['N-303', '마루한', 'V-3003', OPS, '2026-01-01', EDU],
  ['N-304', '주솔미', 'V-3004', OPS, '2026-01-01', EDU],
];
const START = '2025-01-01';
const dayBefore = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

const nodes = [
  node('N-000', 'root', '가상 운영부 조직관리', { description: '가상 운영부의 조직과 사람, 소속 이력을 관리한다' }),
  node('N-001', 'org', '가상 운영부'),
  node(OPS, 'org', '가상운영팀', { period: { start: START, end: '2025-12-31' }, description: '2026-01 조직개편으로 폐지(정산·교육 기능 분리)' }),
  node(SETTLE, 'org', '가상정산팀', { period: { start: '2026-01-01' }, description: '2026-01 신설. 정산·대사 업무' }),
  node(EVENT, 'org', '가상행사팀', { period: { start: START } }),
  node(EDU, 'org', '가상교육팀', { period: { start: '2026-01-01' }, description: '2026-01 신설. 신입·직무 교육' }),
  ...PEOPLE.map(([id, name, emp]) => node(id, 'person', name, { emp_no: emp })),
  node('N-401', 'person', '표다온', { emp_no: 'V-3005' }),
];

const edges = [
  ...[OPS, SETTLE, EVENT, EDU].map((o) => edge(o, 'N-001', 'belongs_to')),
  edge('N-000', 'N-001', 'contains'),
];
const events = [];
for (const [id, , , first, changed, to] of PEOPLE) {
  edges.push(edge(id, first, 'belongs_to', { period: changed ? { start: START, end: dayBefore(changed) } : { start: START } }));
  if (changed) edges.push(edge(id, to, 'belongs_to', { period: { start: changed } }));
}
// 1차 조직개편(2025-07): 운영팀 2명을 행사팀으로
for (const [id, , , first, changed, to] of PEOPLE) {
  if (changed === '2025-07-01') events.push(event('affiliation_change', changed, { person_id: id, from_org_id: first, to_org_id: to }, '1차 조직개편: 행사 인력 보강'));
}
// 2차 조직개편(2026-01): 가상운영팀 폐지 → 가상정산팀·가상교육팀(12건)
for (const [id, , , first, changed, to] of PEOPLE) {
  if (changed === '2026-01-01') events.push(event('affiliation_change', changed, { person_id: id, from_org_id: first, to_org_id: to }, '2차 조직개편: 가상운영팀 폐지'));
}
// 2026-03 신규 입사 1명, 정리 메모. 이후 입력 없음
edges.push(edge('N-401', EDU, 'belongs_to', { period: { start: '2026-03-02' } }));
events.push(event('affiliation_change', '2026-03-02', { person_id: 'N-401', to_org_id: EDU }, '신규 입사'));
events.push(event('memo', '2026-03-10', { target_id: 'N-001', category: 'resolved' }, '2차 조직개편 후 소속 정리 완료. 이후 변동은 다음 정기 갱신 때 반영 예정'));

export const SAMPLE_ORG = {
  schema_version: '1.0',
  universe: {
    id: 'U-O',
    name: '가상 운영부 조직관리',
    level: '본부',
    owner: '가상 인사담당',
    description: '가상 운영부의 조직·사람·소속 이력. 2026-03 이후 입력이 끊긴 사례(입력 중단).',
    root_node_id: 'N-000',
    subtypes: [],
    is_sample: true,
    created_at: STAMP,
  },
  nodes,
  edges,
  events,
  refs: [],
  identity_links: [],
};
