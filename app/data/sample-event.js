// 가상 데이터: 사례 2 — B팀 "연례 행사 운영" 유니버스 U-B (02-design 4절, 프로젝트·일회성, 직접 생성 사용법).
// 팀이 업무를 직접 노드로 가진다. 윤바다(V-1002)는 A팀 사람과 같은 사번이며, 2025 행사 때 정산 대사를 맡았다(유사 경험자 시연).
// 모든 이름·사번·조직명은 가상이다(R-06). 기록 시각은 반드시 과거여야 한다(tests/review.test.js). 고치면 STAMP를 바꾼다.

const STAMP = '2026-10-04T00:10:00+09:00'; // 검토5 V-8: 업무 「장소 섭외」와 주제 이름이 같지 않게

const node = (id, core_type, label, rest = {}) => ({ id, core_type, label, ...rest, hidden: false, created_at: STAMP, updated_at: STAMP });
let seq = 0;
const edge = (source, target, core_type, rest = {}) => {
  seq += 1;
  return { id: `L-${String(seq).padStart(3, '0')}`, source, target, core_type, ...rest, hidden: false, created_at: STAMP };
};

export const SAMPLE_EVENT = {
  schema_version: '1.0',
  universe: {
    id: 'U-B',
    name: '가상행사팀',
    level: '팀',
    owner: '가상행사팀',
    description: '해마다 열리는 가상 행사를 운영하는 팀. 업무를 팀 유니버스 안에 직접 둔다(프로젝트·일회성 업무 사례).',
    root_node_id: 'N-000',
    subtypes: [],
    is_sample: true,
    created_at: STAMP,
  },
  nodes: [
    node('N-000', 'root', '가상행사팀', { description: '해마다 열리는 가상 행사를 준비하고 운영한다' }),
    node('N-101', 'work', '2025 행사', { description: '2025년 행사 운영(참가비 정산 포함)', attrs: { 주기: '연 1회' } }),
    node('N-102', 'work', '2026 행사', { description: '2026년 행사 운영', attrs: { 주기: '연 1회' } }),
    node('N-103', 'work', '장소 섭외', { description: '행사 장소를 알아보고 계약한다' }),
    node('N-104', 'work', '참가자 모집', { description: '참가자를 모집하고 명단을 관리한다' }),
    node('N-201', 'person', '도하람', { emp_no: 'V-2001' }),
    node('N-202', 'person', '윤바다', { emp_no: 'V-1002' }),
    node('N-301', 'topic', '장소 부족'),
    node('N-302', 'topic', '대사 불일치'),
  ],
  edges: [
    ...['N-101', 'N-102', 'N-103', 'N-104'].map((w) => edge('N-000', w, 'contains')),
    edge('N-103', 'N-104', 'precedes'),
    edge('N-102', 'N-101', 'references', { note: '지난 행사 자료 참고' }),
    edge('N-101', 'N-302', 'relates_to'),
    edge('N-103', 'N-301', 'relates_to'),
    edge('N-202', 'N-101', 'performs', { period: { start: '2025-05-01', end: '2025-12-15' } }),
    edge('N-201', 'N-102', 'performs', { period: { start: '2026-03-01' } }),
    edge('N-201', 'N-103', 'performs', { period: { start: '2026-03-01' } }),
    edge('N-201', 'N-104', 'performs', { period: { start: '2026-04-01' } }),
  ],
  events: [
    { id: 'E-001', type: 'assign_start', occurred_at: '2025-05-01', recorded_at: STAMP, source: 'sample', payload: { person_id: 'N-202', work_id: 'N-101' } },
    { id: 'E-002', type: 'memo', occurred_at: '2025-11-20', recorded_at: STAMP, source: 'sample', payload: { target_id: 'N-101', topic_ids: ['N-302'] }, note: '참가비 정산 대사 불일치 2건 발생, 환불 건 누락 확인' },
    { id: 'E-003', type: 'assign_end', occurred_at: '2025-12-15', recorded_at: STAMP, source: 'sample', payload: { person_id: 'N-202', work_id: 'N-101' } },
    { id: 'E-004', type: 'assign_start', occurred_at: '2026-03-01', recorded_at: STAMP, source: 'sample', payload: { person_id: 'N-201', work_id: 'N-102' } },
    // 검토3 DATA-1: 수행 연결마다 담당 시작 이벤트(연결 목록과 이력이 같은 말을 하도록)
    { id: 'E-005', type: 'assign_start', occurred_at: '2026-03-01', recorded_at: STAMP, source: 'sample', payload: { person_id: 'N-201', work_id: 'N-103' } },
    { id: 'E-006', type: 'assign_start', occurred_at: '2026-04-01', recorded_at: STAMP, source: 'sample', payload: { person_id: 'N-201', work_id: 'N-104' } },
  ],
  refs: [],
  identity_links: [],
};
