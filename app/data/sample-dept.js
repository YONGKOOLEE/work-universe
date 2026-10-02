// 가상 부서 유니버스 U-D1: 결제운영팀(U-T1, 업무 유니버스 둘을 묶음), 행사팀(U-B), 교육팀(U-C, T-13)을 묶었다.
// 교육팀의 윤바다라(V-1002)는 윤바다와 사번이 같고 이름이 달라 자동으로 잇지 않는다(사번 충돌, R-11 ③). 임가온은 사번이 없다. 부서 → 팀 → 업무의 여러 단계 묶기 시연.
// 두 팀에 있는 윤바다(V-1002)는 사번 자동으로 같은 사람으로 이었다(D-03). 이 연결이 있어야 유사 경험자 계산이 팀을 넘어 동작한다(T-08).
// 고치면 STAMP를 바꾼다.

const STAMP = '2026-10-01T10:20:00+09:00';

export const SAMPLE_DEPT = {
  schema_version: '1.0',
  universe: {
    id: 'U-D1',
    name: '가상 운영부',
    level: '부서',
    owner: '가상 운영부',
    description: '결제운영팀·행사팀·교육팀을 묶은 부서 유니버스. 여러 단계로 묶은 사례.',
    root_node_id: 'N-000',
    subtypes: [],
    is_sample: true,
    created_at: STAMP,
  },
  nodes: [{ id: 'N-000', core_type: 'root', label: '가상 운영부', hidden: false, created_at: STAMP, updated_at: STAMP }],
  edges: [],
  events: [
    { id: 'E-001', type: 'created', occurred_at: '2026-10-01', recorded_at: STAMP, source: 'sample', payload: { target_kind: 'ref', target_id: 'U-T1' } },
    { id: 'E-002', type: 'created', occurred_at: '2026-10-01', recorded_at: STAMP, source: 'sample', payload: { target_kind: 'ref', target_id: 'U-B' } },
    { id: 'E-003', type: 'created', occurred_at: '2026-10-01', recorded_at: STAMP, source: 'sample', payload: { target_kind: 'ref', target_id: 'U-C' } },
  ],
  refs: [
    { child_universe_id: 'U-T1', added_at: STAMP },
    { child_universe_id: 'U-B', added_at: STAMP },
    { child_universe_id: 'U-C', added_at: STAMP },
  ],
  identity_links: [
    { id: 'I-001', a: 'U-A1/N-011', b: 'U-B/N-202', kind: 'person', method: 'emp_no_auto', status: 'confirmed', reason: '사번 V-1002, 이름 윤바다가 같음' },
  ],
};
