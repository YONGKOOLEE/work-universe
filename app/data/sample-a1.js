// 가상 데이터 v1: 사례 1 — A팀 "월말 정산 점검" 업무 유니버스 U-A1 (02-design 4절, 반복·주기형 업무).
// 모든 이름·사번·조직명은 가상이다(R-06). 사번은 V- + 숫자 4자리. 12.2 형식이고, 12.1에 따라 JS로 감싸 넣는다(P-1).
// 12.6 예시의 ID(N-000, N-001, N-010, N-011, N-020, N-030, L-001~003, E-001·E-002)를 그대로 쓴다.
//
// STAMP(기록 시각)는 반드시 "지금보다 과거"여야 한다. 미래이면 같은 날짜에 사용자가 입력한 이력이 샘플 이력보다 앞에 정렬된다(tests/data.test.js).
// 업무 속성은 02-design 5.6의 약속을 따른다: 업무(절차, 사용 시스템, 주기, 마감, 주의사항), 산출물(위치), 사람(연락처),
// 메모(payload.category). 내용은 실제 업무를 모르는 사람이 읽어도 이해되는 수준의 가상 내용이다.
// 이 파일을 고쳐 내장 샘플이 바뀌면 universe.created_at을 새 값으로 바꾼다.
// 앱은 그 값이 저장된 것과 다르면 샘플을 새로 넣는다(app/src/app/app.js).

const STAMP = '2026-10-12T20:00:00+09:00'; // 검토6 P-2: 자료 수집·보고의 담당 이력 추가(앞서 검토5 V-5: 작성 주체를 조직관리(U-O)의 현재 팀으로)

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
    owner: '가상정산팀',
    description: '매월 말 정산 결과를 모아 대사(대조)하고 보고하는 반복 업무(가상)',
    root_node_id: 'N-000',
    subtypes: [{ core_type: 'artifact', name: '인수인계서' }],
    is_sample: true,
    created_at: STAMP,
  },
  nodes: [
    node('N-000', 'root', '월말 정산 점검', { description: '매월 말 정산 결과를 모아 대사(대조)하고 보고하는 반복 업무(가상)' }),
    node('N-001', 'work', '대사 확인', {
      description: '정산 결과를 원천 자료와 대조해 불일치를 찾는다',
      attrs: {
        주기: '매월',
        마감: '월 마감 후 3영업일 이내',
        절차: '① 점검표의 정산 합계와 원천 합계를 대조 ② 차이가 나는 건을 건별로 찾음 ③ 환불·재처리 건의 반영 여부 확인 ④ 차이 사유를 점검표에 기록',
        '사용 시스템': '가상정산시스템, 가상원천조회, 점검표 양식',
        주의사항: '환불 건이 다음 달에 반영되는 경우가 있어 월 경계 건은 따로 표시한다',
      },
    }),
    node('N-002', 'work', '자료 수집', {
      description: '점검에 쓸 정산 자료를 모은다',
      attrs: {
        주기: '매월',
        마감: '월 마감 후 1영업일 이내',
        절차: '① 가상정산시스템에서 전월 마감 자료를 내려받음 ② 원천 자료와 건수를 맞춤 ③ 점검표 양식에 붙여 넣음',
        '사용 시스템': '가상정산시스템, 가상원천조회',
        주의사항: '월 마감 직후에는 자료가 덜 올라올 수 있으니 오전 10시 이후에 내려받는다',
      },
    }),
    node('N-003', 'work', '보고', {
      description: '점검 결과를 정리해 보고한다',
      attrs: {
        주기: '매월',
        마감: '월 마감 후 5영업일 이내',
        절차: '① 점검표 결과를 한 장으로 요약 ② 불일치 건과 조치 계획을 기재 ③ 팀장 검토 후 공유',
        주의사항: '불일치 건은 원인이 확인되기 전에도 건수와 금액을 먼저 보고한다',
        '관련 문서': '월별 점검 결과 보고서(가상, 공용 문서함 > 정산 > 보고)',
      },
    }),
    node('N-010', 'person', '한가람', { emp_no: 'V-1001', attrs: { 연락처: '내선 1001(가상)' } }),
    node('N-011', 'person', '윤바다', { emp_no: 'V-1002', attrs: { 연락처: '내선 1002(가상)' } }),
    node('N-012', 'person', '서하늘', { emp_no: 'V-1003', attrs: { 연락처: '내선 1003(가상)' } }),
    node('N-020', 'artifact', '2026-06 인수인계서', { subtype: '인수인계서', description: '한가람이 윤바다에게 남긴 인수인계 문서(가상)', attrs: { 위치: '공용 문서함 > 정산 > 인수인계(가상 경로)' } }),
    node('N-021', 'artifact', '점검표 양식', { description: '월말 점검에 쓰는 표 양식(가상)', attrs: { 위치: '공용 문서함 > 정산 > 점검표(가상 경로)' } }),
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
    // 윤바다는 대사 확인과 함께 자료 수집·보고도 맡았다. 9월 말 구두 인수인계는 대사 확인만 다뤄 두 업무는 담당이 비었다(공백의 이야기, 검토6 P-2)
    edge('L-012', 'N-011', 'N-002', 'performs', { period: { start: '2026-06-01', end: '2026-09-30' } }),
    edge('L-013', 'N-011', 'N-003', 'performs', { period: { start: '2026-06-01', end: '2026-09-30' } }),
    // 조력자 의견(2026-10-12): 점검표 양식은 자료 수집의 산출물이면서 인수인계서가 근거로 삼는 자료이기도 하다
    edge('L-014', 'N-020', 'N-021', 'references', { note: '인수인계서가 근거로 삼는 점검표 양식' }),
  ],
  events: [
    event('E-003', 'assign_start', '2025-03-01', { person_id: 'N-010', work_id: 'N-001' }, '한가람이 대사 확인을 맡기 시작'),
    event('E-001', 'affiliation_change', '2026-01-01', { person_id: 'N-010', from_org_id: null, to_org_id: null },
      '조직개편: 가상운영팀 → 가상정산팀 (조직 노드는 U-O에 있음)'),
    event('E-004', 'assign_end', '2026-05-31', { person_id: 'N-010', work_id: 'N-001' }),
    event('E-005', 'assign_start', '2026-06-01', { person_id: 'N-011', work_id: 'N-001' }),
    event('E-002', 'handover', '2026-06-01',
      { work_id: 'N-001', from_person_id: 'N-010', to_person_id: 'N-011', artifact_id: 'N-020' }, '문서로 인수인계'),
    event('E-010', 'memo', '2026-06-20', { target_id: 'N-001', topic_ids: ['N-030'], category: 'in_progress' }, '6월 불일치 2건을 원천 시스템 담당에 재조회 요청 중'),
    event('E-011', 'memo', '2026-06-25', { target_id: 'N-001', topic_ids: ['N-030'], category: 'resolved' }, '6월 불일치 2건 원인 확인 및 정정 완료'),
    event('E-012', 'memo', '2026-07-10', { target_id: 'N-002', category: 'issue' }, '7월 점검표 양식의 항목 순서가 바뀌어 자료 붙여넣기가 어긋남 → 양식을 수정함'),
    event('E-013', 'memo', '2026-08-20', { target_id: 'N-001', topic_ids: ['N-030'], category: 'caution' }, '원천 시스템은 매월 첫 영업일 새벽에 점검으로 조회가 안 되니 그 시간대에는 대조를 시작하지 않는다'),
    event('E-006', 'memo', '2026-09-15', { target_id: 'N-001', topic_ids: ['N-030'], category: 'issue' }, '대사 불일치 3건 재발'),
    event('E-014', 'memo', '2026-09-28', { target_id: 'N-001', topic_ids: ['N-030'], category: 'in_progress' }, '9월 불일치 3건 중 2건은 원인 확인 완료, 1건은 원천 시스템 담당에 재조회 요청 중(회신 대기)'),
    event('E-015', 'memo', '2026-09-29', { target_id: 'N-003', category: 'in_progress' }, '9월 보고서는 불일치 1건이 확인될 때까지 잠정본으로 공유, 확정본은 회신 후 갱신 예정'),
    event('E-007', 'handover', '2026-09-30', { work_id: 'N-001', from_person_id: 'N-011', to_person_id: 'N-012' },
      '구두로 인수인계. 인수인계서 없음, 이전 인수인계서 참조 안 함'),
    event('E-008', 'assign_end', '2026-09-30', { person_id: 'N-011', work_id: 'N-001' }),
    event('E-016', 'assign_start', '2026-06-01', { person_id: 'N-011', work_id: 'N-002' }, '윤바다가 자료 수집도 맡기 시작'),
    event('E-017', 'assign_start', '2026-06-01', { person_id: 'N-011', work_id: 'N-003' }, '윤바다가 보고도 맡기 시작'),
    event('E-018', 'assign_end', '2026-09-30', { person_id: 'N-011', work_id: 'N-002' }, '윤바다가 떠나면서 종료. 후임은 아직 정해지지 않음(구두 인수인계에 포함되지 않음)'),
    event('E-019', 'assign_end', '2026-09-30', { person_id: 'N-011', work_id: 'N-003' }, '윤바다가 떠나면서 종료. 후임은 아직 정해지지 않음(구두 인수인계에 포함되지 않음)'),
    event('E-009', 'assign_start', '2026-10-01', { person_id: 'N-012', work_id: 'N-001' }),
  ],
  refs: [],
  identity_links: [],
};
