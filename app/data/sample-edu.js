// 가상 데이터 v2(T-13, 03-plan 7.2 기본안): C팀 "가상교육팀" 유니버스 U-C (02-design 4절 예외 사례의 C팀).
// 직접 생성 사용법(D-02 B). 교육 운영은 2025년까지 가상운영팀이 맡다가 2026-01 조직개편으로 신설된 가상교육팀으로 옮겨 왔다(U-O 참고).
// 예외 사례(02-design 4절)를 이 데이터에 둔다:
//   - 사번 없음: 임가온(사번 없음) → 통합할 때 확인 목록(R-11 ③)
//   - 사번 충돌: 윤바다라(V-1002) — A팀 윤바다와 사번이 같고 이름이 다름 → 자동으로 합치지 않음
//   - 이력 부족: 「신규 교육 과정」(이벤트 0건, 담당 없음) → 인수인계 초안 대부분이 "이력 부족"(R-03 ②)
// 모든 이름·사번·조직명은 가상이다(R-06). 기록 시각은 반드시 과거여야 한다. 고치면 STAMP를 바꾼다.

const STAMP = '2026-10-01T10:00:00+09:00';

const node = (id, core_type, label, rest = {}) => ({ id, core_type, label, ...rest, hidden: false, created_at: STAMP, updated_at: STAMP });
let seq = 0;
const edge = (source, target, core_type, rest = {}) => {
  seq += 1;
  return { id: `L-${String(seq).padStart(3, '0')}`, source, target, core_type, ...rest, hidden: false, created_at: STAMP };
};
const event = (id, type, occurred_at, payload, note) => ({ id, type, occurred_at, recorded_at: STAMP, source: 'sample', payload, ...(note ? { note } : {}) });

export const SAMPLE_EDU = {
  schema_version: '1.0',
  universe: {
    id: 'U-C',
    name: '가상교육팀',
    level: '팀',
    owner: '가상교육팀',
    description: '신입·직무 교육을 운영하는 팀. 업무를 팀 유니버스 안에 직접 둔다. 2026-01 조직개편으로 가상운영팀에서 분리됐다(가상).',
    root_node_id: 'N-000',
    subtypes: [
      { core_type: 'artifact', name: '인수인계서' },
      { core_type: 'artifact', name: '보고서' },
      { core_type: 'artifact', name: '양식' },
    ],
    is_sample: true,
    created_at: STAMP,
  },
  nodes: [
    node('N-000', 'root', '가상교육팀', { description: '신입·직무 교육을 준비하고 운영한다' }),
    node('N-101', 'work', '신입 교육 운영', {
      description: '반기마다 들어오는 신입 직원 교육을 준비하고 진행한다',
      attrs: {
        주기: '반기(3월·9월)',
        마감: '교육 시작 2주 전까지 일정·강의실 확정',
        절차: '① 대상자 명단 받기 ② 강사·강의실 확정 ③ 안내문 발송 ④ 교육 진행·출석 기록 ⑤ 만족도 조사 요청',
        '사용 시스템': '가상교육관리시스템, 가상메일',
        주의사항: '강의실 예약은 한 달 전에 마감되니 일정이 나오면 바로 잡는다',
      },
    }),
    node('N-102', 'work', '강의실·강사 섭외', {
      description: '교육에 쓸 강의실을 예약하고 사내 강사에게 강의를 요청한다',
      attrs: { 절차: '① 강의실 후보 2곳 예약 ② 강사에게 일정 요청 ③ 확정되면 한 곳 취소', 주의사항: '강사 요청은 최소 6주 전에 해야 일정이 맞는다' },
    }),
    node('N-103', 'work', '만족도 조사', {
      description: '교육이 끝나면 설문을 보내고 결과를 모은다',
      attrs: { 주기: '과정 종료 후', 마감: '종료 후 1주 안에 회수', '사용 시스템': '가상설문도구' },
    }),
    node('N-104', 'work', '교육 결과 보고', {
      description: '출석과 만족도를 모아 과정별 결과를 보고한다',
      attrs: { 주기: '과정 종료 후', 마감: '종료 후 2주 이내', 절차: '① 출석·만족도 집계 ② 개선점 정리 ③ 팀장 검토 후 공유' },
    }),
    node('N-105', 'work', '신규 교육 과정', { description: '2026년 하반기에 새로 여는 직무 교육(준비 중, 기록 없음)' }),
    node('N-201', 'person', '나래솔', { emp_no: 'V-3001', attrs: { 연락처: '내선 3001(가상)' } }),
    node('N-202', 'person', '이든빛', { emp_no: 'V-3002', attrs: { 연락처: '내선 3002(가상)' } }),
    node('N-203', 'person', '마루한', { emp_no: 'V-3003', attrs: { 연락처: '내선 3003(가상)' } }),
    node('N-204', 'person', '임가온', { note: '사번 미기재(예외 사례: 사번 없음)' }),
    node('N-205', 'person', '윤바다라', { emp_no: 'V-1002', note: '예외 사례: A팀 윤바다와 사번이 같고 이름이 다름(사번 충돌)' }),
    node('N-301', 'topic', '강의실 부족'),
    node('N-302', 'topic', '교육 일정 변경'),
    node('N-303', 'topic', '만족도 낮음'),
    node('N-401', 'artifact', '교육 안내문 양식', { subtype: '양식', attrs: { 위치: '가상 공유폴더 > 교육 > 양식' } }),
    node('N-402', 'artifact', '만족도 설문지', { subtype: '양식', attrs: { 위치: '가상설문도구 > 신입 교육 템플릿' } }),
    node('N-403', 'artifact', '2026 상반기 교육 결과 보고서', { subtype: '보고서', attrs: { 위치: '가상 공유폴더 > 교육 > 보고' } }),
    node('N-404', 'artifact', '신입 교육 인수인계서', { subtype: '인수인계서', attrs: { 위치: '가상 공유폴더 > 교육 > 인수인계' } }),
  ],
  edges: [
    edge('N-000', 'N-101', 'contains'),
    edge('N-000', 'N-104', 'contains'),
    edge('N-000', 'N-105', 'contains'),
    edge('N-101', 'N-102', 'contains'),
    edge('N-101', 'N-103', 'contains'),
    edge('N-102', 'N-101', 'precedes', { note: '강의실·강사가 정해져야 안내문을 보낸다' }),
    edge('N-103', 'N-104', 'precedes'),
    edge('N-101', 'N-301', 'relates_to'),
    edge('N-101', 'N-302', 'relates_to'),
    edge('N-102', 'N-301', 'relates_to'),
    edge('N-103', 'N-303', 'relates_to'),
    edge('N-101', 'N-401', 'produces'),
    edge('N-101', 'N-404', 'produces'),
    edge('N-103', 'N-402', 'produces'),
    edge('N-104', 'N-403', 'produces'),
    edge('N-203', 'N-101', 'performs', { period: { start: '2025-03-01', end: '2026-03-31' } }),
    edge('N-202', 'N-101', 'performs', { period: { start: '2026-04-01' } }),
    edge('N-202', 'N-102', 'performs', { period: { start: '2026-04-01' } }),
    edge('N-204', 'N-103', 'performs', { period: { start: '2025-09-01' } }),
    edge('N-201', 'N-104', 'performs', { period: { start: '2025-03-01', end: '2025-12-31' } }),
    edge('N-205', 'N-104', 'performs', { period: { start: '2026-01-02' } }),
  ],
  events: [
    event('E-001', 'assign_start', '2025-03-01', { person_id: 'N-203', work_id: 'N-101' }, '마루한이 신입 교육 운영을 맡기 시작(당시 가상운영팀)'),
    event('E-002', 'assign_start', '2025-03-01', { person_id: 'N-201', work_id: 'N-104' }),
    event('E-003', 'assign_start', '2025-09-01', { person_id: 'N-204', work_id: 'N-103' }),
    event('E-004', 'memo', '2025-09-10', { target_id: 'N-101', topic_ids: ['N-301', 'N-302'], category: 'issue' }, '9월 신입 교육 강의실이 중복 예약되어 하루 연기함'),
    event('E-005', 'assign_end', '2025-12-31', { person_id: 'N-201', work_id: 'N-104' }),
    event('E-006', 'handover', '2026-01-02', { work_id: 'N-104', from_person_id: 'N-201', to_person_id: 'N-205' }, '조직개편으로 구두 인수인계(인수인계서 없음)'),
    event('E-007', 'assign_start', '2026-01-02', { person_id: 'N-205', work_id: 'N-104' }),
    event('E-008', 'memo', '2026-03-05', { target_id: 'N-101', topic_ids: ['N-301'], category: 'issue' }, '3월 교육도 강의실이 모자라 오후반을 따로 운영함'),
    event('E-009', 'memo', '2026-03-20', { target_id: 'N-102', topic_ids: ['N-301'], category: 'caution' }, '강사 요청은 최소 6주 전에 보내야 일정이 맞는다. 늦으면 외부 강사를 써야 해 비용이 든다'),
    event('E-010', 'assign_end', '2026-03-31', { person_id: 'N-203', work_id: 'N-101' }),
    event('E-011', 'handover', '2026-04-01', { work_id: 'N-101', from_person_id: 'N-203', to_person_id: 'N-202', artifact_id: 'N-404' }, '인수인계서로 인계(강의실 예약 요령 포함)'),
    event('E-012', 'assign_start', '2026-04-01', { person_id: 'N-202', work_id: 'N-101' }),
    event('E-013', 'memo', '2026-07-15', { target_id: 'N-104', category: 'resolved' }, '상반기 결과 보고서 공유 완료'),
    event('E-014', 'memo', '2026-09-15', { target_id: 'N-103', topic_ids: ['N-303'], category: 'in_progress' }, '9월 신입 교육 만족도 설문 회수 중(회수율 60%, 9월 말까지)'),
    event('E-015', 'memo', '2026-09-25', { target_id: 'N-103', topic_ids: ['N-303'], category: 'issue' }, '실습 시간이 짧다는 의견이 3월에 이어 다시 나옴'),
  ],
  refs: [],
  identity_links: [],
};
