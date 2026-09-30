// T-01 최소 샘플: 노드 3개, 연결 2개. 02-design 12.2 형식(가상 데이터, 사번 V- 접두어).
// 12.1: 샘플은 JS로 감싸서 넣는다(file://에서 fetch를 쓰지 않기 위해, P-1).
// 사례 1(12.6)의 일부를 그대로 쓴다. T-04에서 가상 데이터 v1로 교체한다.

export const SAMPLE_T01 = {
  schema_version: '1.0',
  universe: {
    id: 'U-A1',
    name: '월말 정산 점검',
    level: '업무',
    owner: '가상운영팀',
    root_node_id: 'N-000',
    subtypes: [],
    is_sample: true,
    created_at: '2026-10-01T09:00:00+09:00',
  },
  nodes: [
    { id: 'N-000', core_type: 'root', label: '월말 정산 점검', hidden: false,
      created_at: '2026-10-01T09:00:00+09:00', updated_at: '2026-10-01T09:00:00+09:00' },
    { id: 'N-001', core_type: 'work', label: '대사 확인', attrs: { 주기: '매월' }, hidden: false,
      created_at: '2026-10-01T09:00:00+09:00', updated_at: '2026-10-01T09:00:00+09:00' },
    { id: 'N-011', core_type: 'person', label: '윤바다', emp_no: 'V-1002', hidden: false,
      created_at: '2026-10-01T09:00:00+09:00', updated_at: '2026-10-01T09:00:00+09:00' },
  ],
  edges: [
    { id: 'L-001', source: 'N-000', target: 'N-001', core_type: 'contains', hidden: false,
      created_at: '2026-10-01T09:00:00+09:00' },
    { id: 'L-002', source: 'N-011', target: 'N-001', core_type: 'performs',
      period: { start: '2026-06-01' }, hidden: false, created_at: '2026-10-01T09:00:00+09:00' },
  ],
  events: [],
  refs: [],
  identity_links: [],
};
