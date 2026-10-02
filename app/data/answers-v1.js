// 정답 표 v1 (02-design 7절, 03-plan T-04). 규칙 기반 결과와 사전 생성 결과를 채점하는 기준이다.
// 근거 ID는 전역 참조("<유니버스 ID>/<노드 또는 이벤트 ID>")다. 평가 기준: ① 근거 ID 유효율 100%, ② 업무 후보에 정답 쌍 포함.
// status가 'pending'인 항목은 해당 작업에서 확정한다. 데이터가 바뀌면 이 표도 함께 고친다(K-9).

export const ANSWERS_V1 = {
  // v2(T-13): 교육팀(U-C)·조직관리(U-O) 기본안 데이터와 예외 사례 정답을 더했다. 파일 이름은 그대로 둔다(참조가 많음)
  version: 'v2',
  data: ['app/data/sample-a1.js', 'app/data/sample-card.js', 'app/data/sample-event.js', 'app/data/sample-edu.js', 'app/data/sample-org.js', 'app/data/sample-team.js', 'app/data/sample-dept.js'],

  // R-03 인수인계 초안(D-09 8개 항목). 대상은 업무 유니버스, 보내는 사람 → 받는 사람
  handover_drafts: [
    {
      id: 'HD-A1-1',
      target: 'U-A1/N-000',
      from: 'U-A1/N-011', // 윤바다
      to: 'U-A1/N-012', // 서하늘
      // CR-6: 10개 항목. 업무 속성·메모 범주를 쓴다(02-design 5.6)
      items: {
        업무_개요: { evidence: ['U-A1/N-000'] },
        세부_업무_절차: { evidence: ['U-A1/N-001', 'U-A1/N-002', 'U-A1/N-003'] }, // 진행 순서 문장 + 업무별 절차
        일정_마감: { evidence: ['U-A1/N-001', 'U-A1/N-002', 'U-A1/N-003'] },
        주의사항: { evidence: ['U-A1/N-001', 'U-A1/N-002', 'U-A1/N-003', 'U-A1/E-013'] }, // 업무 속성 3 + 주의사항 메모
        진행_중: { evidence: ['U-A1/E-014', 'U-A1/E-015'] }, // 6월 건(E-010)은 E-011로 해결되어 빠진다
        산출물_문서: { evidence: ['U-A1/N-020', 'U-A1/N-021'] },
        // 문의: 보내는 사람(윤바다). 이어서 이전 담당자 한가람. 받는 사람(서하늘)은 뺀다
        관계자_연락처: { evidence: ['U-A1/N-010', 'U-A1/N-011'] },
        최근_이슈: { evidence: ['U-A1/E-006', 'U-A1/E-012'] }, // 이슈 범주만(주의사항·진행 중·해결됨 제외), 최근 3건 이하
        // 이번 인수인계(E-007)는 제외하고 이전 것만: 한가람 → 윤바다, 근거 산출물 2026-06 인수인계서
        이전_인수인계: { evidence: ['U-A1/E-002', 'U-A1/N-020'] },
        // 월말 정산 하나만 보면 이력 부족. 가상 운영부(U-D1) 화면에서는 윤바다 등이 나온다(similar_experts SE-1)
        유사_경험자: { evidence: [], note: '사례 1 단독이면 이력 부족. U-D1 기준은 SE-1' },
      },
    },
  ],

  // R-05 반복 비효율(D-08 규칙 ①): 같은 업무에서 인수인계가 2회 이상이고, 이후 인수인계가 이전 인수인계서를 참조하지 않음
  repeat_inefficiency: [
    {
      id: 'RI-A1-1',
      work: 'U-A1/N-001',
      rule: '①',
      evidence: ['U-A1/E-002', 'U-A1/E-007'], // E-007에 previous_handover_id와 artifact_id가 없다
    },
  ],

  // R-05 유사 경험자(T-08). 가상 운영부(U-D1) 화면 기준 — 사례 2(U-B)가 같이 보여야 결과가 나온다.
  // 현재 담당자(서하늘)와 같은 업무만 맡았던 한가람은 "다른 업무"를 수행한 적이 없어 나오지 않는다.
  similar_experts: [
    {
      id: 'SE-1',
      view: 'U-D1',
      work: 'U-A1/N-001',
      asOf: '2026-10-02',
      // 점수가 같으면 이름순. 두 역할(운영 담당·정산 담당)은 결제운영팀에서 사람이 확인해 이은 "대사" 주제를 다룬 카드승인 업무의 담당 역할이고,
      // 윤바다는 행사팀 2025 행사에서 이름이 같은 주제를 다뤘다(연결 확인 전). 사번 자동 연결로 U-B의 윤바다와 U-A1의 윤바다는 같은 노드
      expected: ['U-K1/N-503', 'U-A1/N-011', 'U-K1/N-505'],
      evidence: {
        'U-A1/N-011': ['U-B/N-101', 'U-A1/N-030', 'U-B/N-302', 'U-A1/N-011'], // 2025 행사, 공유 주제 대사 불일치(양쪽), 윤바다
      },
      excluded: ['U-A1/N-012'], // 서하늘: 현재 담당자
      not_expected: ['U-A1/N-010'], // 한가람: 대사 확인만 담당했고 다른 업무는 맡은 적이 없다
    },
    {
      id: 'SE-2',
      view: 'U-A1',
      work: 'U-A1/N-001',
      asOf: '2026-10-02',
      expected: [], // 월말 정산 하나만 보면 비교할 다른 업무가 없다("비슷한 업무를 수행한 사람 없음")
    },
    {
      id: 'SE-3',
      view: 'U-D1',
      work: 'U-A1/N-003', // 보고: 주제·산출물 연결이 없다
      asOf: '2026-10-02',
      insufficient: true, // "데이터 부족"
    },
  ],

  // R-05 밀집/공백(T-11). 공백 종류: never = 담당 기록 없음, ended = 이전 담당자만 있음(끝난 업무일 수 있음)
  density_gaps: [
    { id: 'DG-A1', view: 'U-A1', asOf: '2026-10-02', n: 3, status: 'ok', gaps: ['U-A1/N-002:never', 'U-A1/N-003:never'], dense: [] },
    { id: 'DG-B', view: 'U-B', asOf: '2026-10-02', n: 3, status: 'ok', gaps: ['U-B/N-101:ended'], dense: ['U-B/N-201'] },
    { id: 'DG-B-N4', view: 'U-B', asOf: '2026-10-02', n: 4, status: 'ok', gaps: ['U-B/N-101:ended'], dense: [] },
    // T-13: 교육팀은 「신규 교육 과정」만 담당 기록이 없다. 조직관리(U-O)는 수행 연결이 없어 데이터 부족
    { id: 'DG-C', view: 'U-C', asOf: '2026-10-02', n: 3, status: 'ok', gaps: ['U-C/N-105:never'], dense: [] },
    { id: 'DG-O', view: 'U-O', asOf: '2026-10-02', n: 3, status: 'insufficient', gaps: [], dense: [] },
  ],

  // R-05 흐름 변화(T-11·T-13). 조직관리는 2026-03-10 이후 입력이 없어 2026-04부터 "입력 없음"(설계 4절 사례 3)
  flow_changes: [
    { id: 'FC-O', view: 'U-O', unit: 'month', asOf: '2026-10-02', last_input: '2026-03-10', first_period: '2025-07', no_data_from: '2026-04', counts: { '2025-07': 2, '2026-01': 12, '2026-03': 2 } },
  ],

  // R-14 조직개편(T-13): 기준일 소속. 개편 전후로 사람의 소속이 바뀌고 업무 이력은 이어진다
  affiliations: [
    { id: 'AF-1', view: 'U-O', person: 'U-O/N-101', at: { '2025-12-31': '가상운영팀', '2026-02-01': '가상정산팀' } },
    { id: 'AF-2', view: 'U-O', person: 'U-O/N-204', at: { '2025-06-30': '가상운영팀', '2025-07-01': '가상행사팀' } },
    { id: 'AF-3', view: 'U-O', person: 'U-O/N-301', at: { '2025-12-31': '가상운영팀', '2026-01-01': '가상교육팀' } },
  ],

  // 예외 사례(02-design 4절, T-13): 데이터에 들어 있는 것
  exceptions: {
    empno_conflict: { id: 'EX-CONFLICT', view: 'U-D1', emp_no: 'V-1002', labels: ['윤바다', '윤바다라'] }, // 자동으로 합치지 않음
    no_empno: { id: 'EX-NOEMP', node: 'U-C/N-204' }, // 임가온
    history_short: { id: 'EX-SHORT', view: 'U-C', target: 'U-C/N-105', from: 'U-C/N-202', to: 'U-C/N-203', insufficient_items: ['세부_업무_절차', '일정_마감', '주의사항', '진행_중', '산출물_문서', '최근_이슈', '이전_인수인계', '유사_경험자'] },
  },

  // R-11 같은 업무 쌍: A·B·C 데이터는 T-13에서 갖췄다. 어떤 쌍을 "같은 업무"로 볼지는 통합(T-10)과 조력자 의견(구성 기준) 뒤에 정한다
  // T-10(2026-10-03, 기본안 데이터): 통합 후보 목록에 반드시 들어가야 하는 쌍. 같은 업무인지의 판정은 사람이 한다(R-11 ②)
  same_work_pairs: [
    { id: 'SW-1', view: 'U-D1', a: 'U-B/N-103', b: 'U-C/N-102', why: '장소 섭외 ↔ 강의실·강사 섭외: 행사·교육 모두 장소를 잡는 일(낱말 「섭외」)' },
    { id: 'SW-2', view: 'U-D1', a: 'U-A1/N-001', b: 'U-K1/N-104', why: '대사 확인 ↔ 거래 조회: 같은 주제 「대사 불일치」(사람이 이은 주제)' },
    { id: 'SW-3', view: 'U-D1', a: 'U-A1/N-003', b: 'U-C/N-104', why: '보고 ↔ 교육 결과 보고: 결과를 정리해 보고하는 일(낱말 「보고」)' },
  ],
};
