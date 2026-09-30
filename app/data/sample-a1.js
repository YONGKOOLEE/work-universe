// 가상 데이터 v1: 사례 1 — A팀 "월말 정산 점검" 업무 유니버스 U-A1 (02-design 4절, 반복·주기형 업무).
// 모든 이름·사번·조직명은 가상이다(R-06). 사번은 V- + 숫자 4자리. 12.2 형식이고, 12.1에 따라 JS로 감싸 넣는다(P-1).
// 12.6 예시의 ID(N-000, N-001, N-010, N-011, N-020, N-030, L-001~003, E-001·E-002)를 그대로 쓴다.
//
// 이 파일을 고쳐 내장 샘플이 바뀌면 universe.created_at을 새 값으로 바꾼다.
// 앱은 그 값이 저장된 것과 다르면 샘플을 새로 넣는다(app/src/app/app.js).

const STAMP = '2026-10-01T18:00:00+09:00';

const node = (id, core_type, label, rest = {}) => ({
  id, core_type, label, ...rest, hidden: false, created_at: STAMP, updated_at: STAMP,
});
const edge = (id, source, target, core_type, rest = {}) => ({
  id, source, target, core_type, ...rest, hidden: false, created_at: STAMP,
});
const event = (id, type, occurred_at, payload, note) => ({
  id, type, occurred_at, recorded_at: STAMP, source: 'sample', payload, ...(note ? { note } : {}),
});

export const SAMPLE_A1 = {
  schema_version: '1.0',
  universe: {
    id: 'U-A1',
    name: '월말 정산 점검',
    level: '업무',
    owner: '가상운영팀',
    description: '매월 말 정산 결과를 모아 대사(대조)하고 보고하는 반복 업무(가상)',
    root_node_id: 'N-000',
    subtypes: [{ core_type: 'artifact', name: '인수인계서' }],
    is_sample: true,
    created_at: STAMP,
  },
  nodes: [
    node('N-000', 'root', '월말 정산 점검', { description: '매월 말 정산 결과를 모아 대사(대조)하고 보고하는 반복 업무(가상)' }),
    node('N-001', 'work', '대사 확인', { description: '정산 결과를 원천 자료와 대조해 불일치를 찾는다', attrs: { 주기: '매월' } }),
    node('N-002', 'work', '자료 수집', { description: '점검에 쓸 정산 자료를 모은다', attrs: { 주기: '매월' } }),
    node('N-003', 'work', '보고', { description: '점검 결과를 정리해 보고한다', attrs: { 주기: '매월' } }),
    node('N-010', 'person', '한가람', { emp_no: 'V-1001' }),
    node('N-011', 'person', '윤바다', { emp_no: 'V-1002' }),
    node('N-012', 'person', '서하늘', { emp_no: 'V-1003' }),
    node('N-020', 'artifact', '2026-06 인수인계서', { subtype: '인수인계서', description: '한가람이 윤바다에게 남긴 인수인계 문서(가상)' }),
    node('N-021', 'artifact', '점검표 양식', { description: '월말 점검에 쓰는 표 양식(가상)' }),
    node('N-030', 'topic', '대사 불일치'),
  ],
  edges: [
    edge('L-001', 'N-000', 'N-001', 'contains'),
    edge('L-002', 'N-011', 'N-001', 'performs', { period: { start: '2026-06-01', end: '2026-09-30' } }),
    edge('L-003', 'N-001', 'N-030', 'relates_to'),
    edge('L-004', 'N-000', 'N-002', 'contains'),
    edge('L-005', 'N-000', 'N-003', 'contains'),
    edge('L-006', 'N-010', 'N-001', 'performs', { period: { start: '2025-03-01', end: '2026-05-31' } }),
    edge('L-007', 'N-012', 'N-001', 'performs', { period: { start: '2026-10-01' } }),
    edge('L-008', 'N-002', 'N-001', 'precedes'),
    edge('L-009', 'N-001', 'N-003', 'precedes'),
    edge('L-010', 'N-002', 'N-021', 'produces'),
    edge('L-011', 'N-001', 'N-020', 'produces'),
  ],
  events: [
    event('E-003', 'assign_start', '2025-03-01', { person_id: 'N-010', work_id: 'N-001' }, '한가람이 대사 확인을 맡기 시작'),
    event('E-001', 'affiliation_change', '2026-01-01', { person_id: 'N-010', from_org_id: null, to_org_id: null },
      '조직개편: 가상운영팀 → 가상정산팀 (조직 노드는 U-O에 있음)'),
    event('E-004', 'assign_end', '2026-05-31', { person_id: 'N-010', work_id: 'N-001' }),
    event('E-005', 'assign_start', '2026-06-01', { person_id: 'N-011', work_id: 'N-001' }),
    event('E-002', 'handover', '2026-06-01',
      { work_id: 'N-001', from_person_id: 'N-010', to_person_id: 'N-011', artifact_id: 'N-020' }, '문서로 인수인계'),
    event('E-006', 'memo', '2026-09-15', { target_id: 'N-001', topic_ids: ['N-030'] }, '대사 불일치 3건 재발'),
    event('E-007', 'handover', '2026-09-30', { work_id: 'N-001', from_person_id: 'N-011', to_person_id: 'N-012' },
      '구두로 인수인계. 인수인계서 없음, 이전 인수인계서 참조 안 함'),
    event('E-008', 'assign_end', '2026-09-30', { person_id: 'N-011', work_id: 'N-001' }),
    event('E-009', 'assign_start', '2026-10-01', { person_id: 'N-012', work_id: 'N-001' }),
  ],
  refs: [],
  identity_links: [],
};
