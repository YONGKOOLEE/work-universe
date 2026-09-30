// 02-design 12.6 예시(사례 1 일부, 가상)를 그대로 옮긴 것. 문서의 JSON이 바뀌면 함께 고친다.
export const EXAMPLE_12_6 = {
  schema_version: '1.0',
  universe: { id: 'U-A1', name: '월말 정산 점검', level: '업무', owner: '가상운영팀',
              root_node_id: 'N-000', subtypes: [{ core_type: 'artifact', name: '인수인계서' }],
              is_sample: true, created_at: '2026-10-01T09:00:00+09:00' },
  nodes: [
    { id: 'N-000', core_type: 'root', label: '월말 정산 점검', hidden: false },
    { id: 'N-001', core_type: 'work', label: '대사 확인', attrs: { 주기: '매월' }, hidden: false },
    { id: 'N-010', core_type: 'person', label: '한가람', emp_no: 'V-1001', hidden: false },
    { id: 'N-011', core_type: 'person', label: '윤바다', emp_no: 'V-1002', hidden: false },
    { id: 'N-020', core_type: 'artifact', subtype: '인수인계서', label: '2026-06 인수인계서', hidden: false },
    { id: 'N-030', core_type: 'topic', label: '대사 불일치', hidden: false },
  ],
  edges: [
    { id: 'L-001', source: 'N-000', target: 'N-001', core_type: 'contains', hidden: false },
    { id: 'L-002', source: 'N-011', target: 'N-001', core_type: 'performs',
      period: { start: '2026-06-01' }, hidden: false },
    { id: 'L-003', source: 'N-001', target: 'N-030', core_type: 'relates_to', hidden: false },
  ],
  events: [
    { id: 'E-001', type: 'affiliation_change', occurred_at: '2026-01-01', source: 'sample',
      payload: { person_id: 'N-010', from_org_id: null, to_org_id: null },
      note: '조직개편: 가상운영팀 → 가상정산팀 (조직 노드는 U-O에 있음)' },
    { id: 'E-002', type: 'handover', occurred_at: '2026-06-01', source: 'sample',
      payload: { work_id: 'N-001', from_person_id: 'N-010', to_person_id: 'N-011', artifact_id: 'N-020' } },
  ],
  refs: [],
  identity_links: [],
};
