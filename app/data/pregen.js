// 사전 생성 결과(CR-1, 02-design 12.3, T-12). 개발 중 Claude Code가 확정 가상 데이터(v2)의 근거만 보고 쓴 문장이다.
// 작성 근거: `node tools/pregen-dump.mjs`의 출력(항목별 규칙 기반 근거와 그 내용). 데이터 밖 내용은 쓰지 않았다.
// 조회 키: (task, target, item, from>to, 정렬한 evidence_ids). 초안은 보내는·받는 사람이 같을 때만 쓴다. 근거가 바뀐 항목은 화면에서 규칙 기반으로 돌아간다(K-9).
// 데이터를 고치면 tests/pregen.test.js가 낡은 항목을 알려 준다 → 덤프를 다시 보고 고친다.
// 12.3과 다른 점: 초안은 항목(item)마다 한 줄이다(항목 단위로 낡음을 판정하기 위해, tech-record 27절).

const A1 = 'U-A1';
const C = 'U-C';
const g = (u, ...ids) => ids.map((id) => `${u}/${id}`);

const handoverA1 = [
  {
    item: '업무_개요',
    evidence_ids: g(A1, 'N-000'),
    sentences: [{ text: '월말 정산 점검은 매월 말 정산 결과를 모아 원천 자료와 대조(대사)하고, 그 결과를 보고하는 반복 업무입니다.', evidence_ids: g(A1, 'N-000') }],
  },
  {
    item: '세부_업무_절차',
    evidence_ids: g(A1, 'N-001', 'N-002', 'N-003'),
    sentences: [
      { text: '일은 자료 수집 → 대사 확인 → 보고 순서로 진행됩니다.', evidence_ids: g(A1, 'N-002', 'N-001', 'N-003') },
      { text: '자료 수집: 가상정산시스템에서 전월 마감 자료를 내려받아 원천 자료와 건수를 맞춘 뒤 점검표 양식에 붙여 넣습니다(가상정산시스템·가상원천조회 사용).', evidence_ids: g(A1, 'N-002') },
      { text: '대사 확인: 점검표의 정산 합계와 원천 합계를 대조하고, 차이가 나는 건을 건별로 찾아 환불·재처리 건이 반영됐는지 확인한 다음 차이 사유를 점검표에 적습니다.', evidence_ids: g(A1, 'N-001') },
      { text: '보고: 점검표 결과를 한 장으로 요약하고 불일치 건과 조치 계획을 적어, 팀장 검토 후 공유합니다.', evidence_ids: g(A1, 'N-003') },
    ],
  },
  {
    item: '일정_마감',
    evidence_ids: g(A1, 'N-001', 'N-002', 'N-003'),
    sentences: [{ text: '세 업무 모두 매월 반복되며, 월 마감 후 1영업일 안에 자료 수집, 3영업일 안에 대사 확인, 5영업일 안에 보고를 마쳐야 합니다.', evidence_ids: g(A1, 'N-002', 'N-001', 'N-003') }],
  },
  {
    item: '주의사항',
    evidence_ids: g(A1, 'E-013', 'N-001', 'N-002', 'N-003'),
    sentences: [
      { text: '자료는 월 마감 직후에 덜 올라올 수 있으니 오전 10시 이후에 내려받으세요.', evidence_ids: g(A1, 'N-002') },
      { text: '원천 시스템은 매월 첫 영업일 새벽에 점검으로 조회가 안 되므로, 그 시간에는 대조를 시작하지 마세요(2026-08-20 메모).', evidence_ids: g(A1, 'E-013') },
      { text: '환불 건이 다음 달에 반영되는 경우가 있어, 월 경계에 걸린 건은 따로 표시해 둡니다.', evidence_ids: g(A1, 'N-001') },
      { text: '불일치 건은 원인을 확인하기 전이라도 건수와 금액부터 먼저 보고합니다.', evidence_ids: g(A1, 'N-003') },
    ],
  },
  {
    item: '진행_중',
    evidence_ids: g(A1, 'E-014', 'E-015'),
    sentences: [
      { text: '9월 불일치 3건 중 2건은 원인을 확인했고, 남은 1건은 원천 시스템 담당에게 재조회를 요청해 회신을 기다리는 중입니다(2026-09-28).', evidence_ids: g(A1, 'E-014') },
      { text: '그래서 9월 보고서는 잠정본으로 공유되어 있고, 회신이 오면 확정본으로 바꿔야 합니다(2026-09-29).', evidence_ids: g(A1, 'E-015') },
    ],
  },
  {
    item: '산출물_문서',
    evidence_ids: g(A1, 'N-020', 'N-021'),
    sentences: [
      { text: '점검표 양식은 공용 문서함 > 정산 > 점검표에 있으며, 자료 수집 단계에서 씁니다.', evidence_ids: g(A1, 'N-021') },
      { text: '이전 담당자 한가람이 남긴 2026-06 인수인계서는 공용 문서함 > 정산 > 인수인계에 있습니다.', evidence_ids: g(A1, 'N-020') },
    ],
  },
  {
    item: '관계자_연락처',
    evidence_ids: g(A1, 'N-010', 'N-011'),
    sentences: [
      { text: '궁금한 점은 먼저 보내는 사람 윤바다(V-1002, 내선 1002)에게 물어보세요.', evidence_ids: g(A1, 'N-011') },
      { text: '그 전에는 한가람(V-1001, 내선 1001)이 2025-03-01부터 2026-05-31까지 대사 확인을 맡았습니다.', evidence_ids: g(A1, 'N-010') },
    ],
  },
  {
    item: '최근_이슈',
    evidence_ids: g(A1, 'E-006', 'E-012'),
    sentences: [
      { text: '2026-09-15에 대사 불일치 3건이 다시 발생했습니다.', evidence_ids: g(A1, 'E-006') },
      { text: '2026-07-10에는 점검표 양식의 항목 순서가 바뀌어 자료 붙여넣기가 어긋났고, 양식을 고쳐 바로잡았습니다.', evidence_ids: g(A1, 'E-012') },
    ],
  },
  {
    item: '이전_인수인계',
    evidence_ids: g(A1, 'E-002', 'E-007', 'N-020'),
    sentences: [
      { text: '2026-06-01 한가람 → 윤바다 인수인계는 2026-06 인수인계서를 근거로 문서로 이루어졌습니다. 그 문서를 함께 보세요.', evidence_ids: g(A1, 'E-002', 'N-020') },
      { text: '2026-09-30 윤바다 → 서하늘 인수인계는 인수인계서 없이 구두로 이루어졌습니다. 이 초안을 확정하면 그 자리를 채우는 문서가 됩니다.', evidence_ids: g(A1, 'E-007') },
    ],
  },
  {
    // 부서 화면(U-D1)에서 열었을 때만 채워지는 항목
    item: '유사_경험자',
    // D3-31: 보내는 사람(윤바다)은 「문의」로 이미 나오므로 뺀다
    evidence_ids: ['U-A1/N-030', 'U-K1/N-104', 'U-K1/N-105', 'U-K1/N-503', 'U-K1/N-505'],
    sentences: [
      { text: '카드승인 업무에서 같은 「대사 불일치」 주제를 다루는 「장애 시 재처리」의 운영 담당(V-4002)과 「거래 조회」의 정산 담당(V-4004)에게 물어볼 수 있습니다.', evidence_ids: ['U-K1/N-503', 'U-K1/N-105', 'U-K1/N-505', 'U-K1/N-104', 'U-A1/N-030'] },
    ],
  },
].map((x) => ({ task: 'handover', target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012', ...x }));

const handoverC = [
  {
    item: '업무_개요',
    evidence_ids: g(C, 'N-101'),
    sentences: [{ text: '신입 교육 운영은 반기(3월·9월)마다 들어오는 신입 직원의 교육을 준비하고 진행하는 업무입니다.', evidence_ids: g(C, 'N-101') }],
  },
  {
    item: '세부_업무_절차',
    evidence_ids: g(C, 'N-101', 'N-102', 'N-103'),
    sentences: [
      { text: '강의실·강사 섭외를 마쳐야 교육을 열 수 있고, 교육이 끝난 뒤 만족도 조사를 합니다.', evidence_ids: g(C, 'N-102', 'N-101', 'N-103') },
      { text: '신입 교육 운영: 대상자 명단을 받고, 강사·강의실을 확정해 안내문을 보낸 뒤 교육을 진행하며 출석을 기록하고, 끝나면 만족도 조사를 요청합니다(가상교육관리시스템·가상메일 사용).', evidence_ids: g(C, 'N-101') },
      { text: '강의실·강사 섭외: 강의실 후보 두 곳을 예약해 두고 강사에게 일정을 요청한 다음, 확정되면 한 곳을 취소합니다.', evidence_ids: g(C, 'N-102') },
      { text: '만족도 조사: 교육이 끝나면 가상설문도구로 설문을 보내고 결과를 모읍니다.', evidence_ids: g(C, 'N-103') },
    ],
  },
  {
    item: '일정_마감',
    evidence_ids: g(C, 'N-101', 'N-102', 'N-103'),
    sentences: [
      { text: '교육은 3월과 9월, 반기마다 있으며 교육 시작 2주 전까지 일정과 강의실을 확정해야 합니다.', evidence_ids: g(C, 'N-101') },
      { text: '강사는 교육 시작 6주 전까지 확정해야 하며, 강의실·강사 섭외는 교육 과정마다 반복됩니다.', evidence_ids: g(C, 'N-102') },
      { text: '만족도 설문은 과정이 끝난 뒤 1주 안에 회수합니다.', evidence_ids: g(C, 'N-103') },
    ],
  },
  {
    item: '주의사항',
    evidence_ids: g(C, 'E-009', 'N-101', 'N-102', 'N-103'),
    sentences: [
      { text: '강의실 예약은 한 달 전에 마감되니 일정이 나오면 바로 잡으세요.', evidence_ids: g(C, 'N-101') },
      { text: '강사 요청은 최소 6주 전에 보내야 일정이 맞고, 늦으면 외부 강사를 써야 해 비용이 듭니다.', evidence_ids: g(C, 'N-102', 'E-009') },
      { text: '만족도 조사는 응답률이 70% 아래면 한 번 더 안내합니다.', evidence_ids: g(C, 'N-103') },
    ],
  },
  {
    item: '진행_중',
    evidence_ids: g(C, 'E-014'),
    sentences: [{ text: '9월 신입 교육의 만족도 설문을 회수하는 중입니다. 2026-09-15 기준 회수율은 60%였고, 9월 말까지 받을 예정이었습니다.', evidence_ids: g(C, 'E-014') }],
  },
  {
    item: '산출물_문서',
    evidence_ids: g(C, 'N-401', 'N-402', 'N-404'),
    sentences: [
      { text: '교육 안내문 양식은 가상 공유폴더 > 교육 > 양식에, 만족도 설문지는 가상설문도구 > 신입 교육 템플릿에 있습니다.', evidence_ids: g(C, 'N-401', 'N-402') },
      { text: '이전 인수인계 때 만든 신입 교육 인수인계서는 가상 공유폴더 > 교육 > 인수인계에 있습니다.', evidence_ids: g(C, 'N-404') },
    ],
  },
  {
    item: '관계자_연락처',
    evidence_ids: g(C, 'N-202', 'N-203', 'N-204'),
    sentences: [
      { text: '궁금한 점은 먼저 보내는 사람 이든빛(V-3002, 내선 3002)에게 물어보세요.', evidence_ids: g(C, 'N-202') },
      { text: '이전 담당자 마루한(V-3003, 내선 3003)이 2025-03-01부터 2026-03-31까지 이 업무를 맡았습니다.', evidence_ids: g(C, 'N-203') },
      { text: '만족도 조사는 2025-09-01부터 임가온이 맡고 있습니다(사번·연락처 기록 없음).', evidence_ids: g(C, 'N-204') },
    ],
  },
  {
    item: '최근_이슈',
    evidence_ids: g(C, 'E-004', 'E-008', 'E-015'),
    sentences: [
      { text: '강의실 부족이 되풀이되고 있습니다. 2025-09-10에는 강의실이 중복 예약돼 교육을 하루 미뤘고, 2026-03-05에는 강의실이 모자라 오후반을 따로 운영했습니다.', evidence_ids: g(C, 'E-004', 'E-008') },
      { text: '2026-09-25에는 실습 시간이 짧다는 의견이 3월에 이어 다시 나왔습니다.', evidence_ids: g(C, 'E-015') },
    ],
  },
  {
    item: '이전_인수인계',
    evidence_ids: g(C, 'E-011', 'N-404'),
    sentences: [{ text: '직전 인수인계는 2026-04-01 마루한 → 이든빛으로, 강의실 예약 요령을 담은 신입 교육 인수인계서로 이루어졌습니다.', evidence_ids: g(C, 'E-011', 'N-404') }],
  },
].map((x) => ({ task: 'handover', target: 'U-C/N-101', from: 'U-C/N-202', to: 'U-C/N-201', ...x }));

const explain = [
  {
    target: 'similar|U-A1/N-001',
    evidence_ids: ['U-A1/N-011', 'U-A1/N-030', 'U-B/N-101', 'U-B/N-302', 'U-K1/N-104', 'U-K1/N-105', 'U-K1/N-503', 'U-K1/N-505'],
    sentences: [
      { text: '「대사 확인」과 비슷한 일을 해 본 사람은 세 명이고, 모두 「대사 불일치」 주제로 이어집니다.', evidence_ids: ['U-A1/N-030', 'U-A1/N-011', 'U-K1/N-503', 'U-K1/N-505'] },
      { text: '윤바다는 행사팀 「2025 행사」에서 이름이 같은 주제를 다뤘고(같은 주제인지는 확인 전), 운영 담당과 정산 담당은 카드승인 업무의 「장애 시 재처리」와 「거래 조회」를 맡고 있습니다.', evidence_ids: ['U-A1/N-011', 'U-B/N-101', 'U-B/N-302', 'U-K1/N-503', 'U-K1/N-105', 'U-K1/N-505', 'U-K1/N-104'] },
    ],
  },
  {
    target: 'repeat|U-A1',
    evidence_ids: g(A1, 'E-002', 'E-007'),
    sentences: [
      { text: '「대사 확인」은 2026-06-01에는 인수인계서로 넘겨받았지만, 2026-09-30 윤바다 → 서하늘 인수인계는 인수인계서 없이 구두로 이루어져 앞선 문서를 이어받지 않았습니다.', evidence_ids: g(A1, 'E-002', 'E-007') },
      { text: '이 흐름이면 다음 담당자도 처음부터 다시 설명을 들어야 할 수 있습니다.', evidence_ids: g(A1, 'E-007') },
    ],
  },
  {
    // D3-32: 주의사항·해결됨 메모는 세지 않고 포함 관계 업무는 한 곳으로 묶으므로 교육팀 「강의실 부족」은 반복이 아니다
    target: 'repeat|U-D1',
    evidence_ids: ['U-A1/E-002', 'U-A1/E-006', 'U-A1/E-007', 'U-A1/E-010', 'U-A1/E-014', 'U-A1/N-030', 'U-B/E-002', 'U-B/N-302', 'U-K1/E-005', 'U-K1/E-006'],
    sentences: [
      { text: '월말 정산의 「대사 확인」은 마지막 인수인계(2026-09-30)가 이전 인수인계서를 이어받지 않았습니다.', evidence_ids: ['U-A1/E-002', 'U-A1/E-007'] },
      { text: '「대사 불일치」 주제는 월말 정산·행사·카드승인의 네 업무에서 되풀이되어, 여러 팀이 같은 문제를 따로 다루고 있을 가능성이 있습니다.', evidence_ids: ['U-A1/N-030', 'U-B/N-302', 'U-A1/E-006', 'U-B/E-002', 'U-K1/E-006'] },
    ],
  },
  {
    target: 'density|U-D1|n=3',
    evidence_ids: ['U-A1/N-002', 'U-A1/N-003', 'U-A1/N-011', 'U-B/N-101', 'U-B/N-102', 'U-B/N-103', 'U-B/N-104', 'U-B/N-201', 'U-C/N-105', 'U-K1/N-101', 'U-K1/N-102', 'U-K1/N-103', 'U-K1/N-202', 'U-K1/N-204'],
    sentences: [
      { text: '담당자가 정해지지 않은 업무는 월말 정산의 자료 수집·보고(마지막 담당자 윤바다가 2026-09-30에 맡은 일을 끝냈고 후임이 없습니다), 카드승인의 승인·승인취소·망취소·요청 검증·응답 수신·회신, 교육팀의 신규 교육 과정입니다.', evidence_ids: ['U-A1/N-002', 'U-A1/N-003', 'U-A1/N-011', 'U-K1/N-101', 'U-K1/N-102', 'U-K1/N-103', 'U-K1/N-202', 'U-K1/N-204', 'U-C/N-105'] },
      { text: '행사팀의 「2025 행사」는 이전 담당자(윤바다)만 있어, 이미 끝난 행사인지 확인이 필요합니다.', evidence_ids: ['U-B/N-101', 'U-A1/N-011'] },
      { text: '행사팀의 도하람은 2026 행사·장소 섭외·참가자 모집 세 업무를 함께 맡고 있습니다.', evidence_ids: ['U-B/N-201', 'U-B/N-102', 'U-B/N-103', 'U-B/N-104'] },
    ],
  },
  {
    target: 'density|U-C|n=3',
    evidence_ids: g(C, 'N-105'),
    sentences: [{ text: '교육팀에서 담당자가 없는 업무는 아직 준비 중인 「신규 교육 과정」 하나입니다.', evidence_ids: g(C, 'N-105') }],
  },
  {
    target: 'flow|U-A1|month',
    evidence_ids: g(A1, 'E-001', 'E-002', 'E-003', 'E-004', 'E-005', 'E-006', 'E-007', 'E-008', 'E-009', 'E-010', 'E-011', 'E-012', 'E-013', 'E-014', 'E-015', 'E-016', 'E-017', 'E-018', 'E-019'),
    sentences: [
      { text: '기록은 2025-03 담당 시작 뒤로 드문드문 이어지다가, 담당자가 바뀐 2026-06과 2026-09에 몰렸습니다. 가장 많은 2026-09에는 불일치 재발과 구두 인수인계, 윤바다의 담당 종료가 겹칩니다.', evidence_ids: g(A1, 'E-003', 'E-002', 'E-005', 'E-016', 'E-017', 'E-010', 'E-011', 'E-006', 'E-007', 'E-008', 'E-014', 'E-015', 'E-018', 'E-019') },
      { text: '2026-09-30의 구두 인수인계는 대사 확인만 다뤘고, 같은 날 담당이 끝난 자료 수집과 보고는 이어받은 사람이 아직 없습니다.', evidence_ids: g(A1, 'E-007', 'E-018', 'E-019') },
      { text: '2026-01 조직개편으로 한가람의 소속이 바뀌었지만, 대사 확인 담당은 2026-05-31까지 끊기지 않고 이어졌습니다.', evidence_ids: g(A1, 'E-001', 'E-003', 'E-004') },
    ],
  },
  {
    target: 'flow|U-O|month',
    evidence_ids: g('U-O', 'E-001', 'E-002', 'E-003', 'E-004', 'E-005', 'E-006', 'E-007', 'E-008', 'E-009', 'E-010', 'E-011', 'E-012', 'E-013', 'E-014', 'E-015', 'E-016'),
    sentences: [
      { text: '가장 큰 변화는 2026-01 2차 조직개편입니다. 가상운영팀이 폐지되면서 12명의 소속이 가상정산팀과 가상교육팀으로 바뀌었습니다.', evidence_ids: g('U-O', 'E-003', 'E-004', 'E-005', 'E-006', 'E-007', 'E-008', 'E-009', 'E-010', 'E-011', 'E-012', 'E-013', 'E-014') },
      { text: '그보다 앞선 2025-07에는 1차 조직개편으로 2명이 가상행사팀으로 옮겼습니다.', evidence_ids: g('U-O', 'E-001', 'E-002') },
      { text: '2026-03-10 소속 정리 메모 뒤로는 기록이 없어, 그 뒤의 인력 변화는 이 자료로 판단할 수 없습니다.', evidence_ids: g('U-O', 'E-016') },
    ],
  },
  // CR-14 B 인수인계 위험(2026-10-23). 근거: pregen-dump X8~X13
  {
    target: 'risk_concentration|U-A1',
    evidence_ids: g(A1, 'N-002', 'N-003', 'N-011'),
    sentences: [
      { text: '「자료 수집」과 「보고」는 지금까지 윤바다 한 사람만 맡아 왔고, 두 업무 모두 인수인계 기록이 없습니다.', evidence_ids: g(A1, 'N-002', 'N-003', 'N-011') },
    ],
  },
  {
    target: 'risk_readiness|U-A1',
    evidence_ids: g(A1, 'E-006', 'E-012', 'E-014', 'E-015', 'N-001', 'N-002', 'N-003'),
    sentences: [
      { text: '월말 정산 점검의 세 업무 중 6항목을 모두 갖춘 업무는 아직 없습니다.', evidence_ids: g(A1, 'N-001', 'N-002', 'N-003') },
      { text: '「보고」가 2/6으로 가장 낮습니다. 9월 보고서가 잠정본인 채 진행 중이고, 산출물 연결·현재 담당자·인수인계 기록이 비어 있습니다.', evidence_ids: g(A1, 'N-003', 'E-015') },
      { text: '「자료 수집」은 3/6입니다. 7월 점검표 양식 메모가 해결 표시되지 않았고, 현재 담당자와 인수인계 기록이 없습니다.', evidence_ids: g(A1, 'N-002', 'E-012') },
      { text: '「대사 확인」은 5/6으로 준비가 가장 잘 돼 있지만, 9월 불일치 관련 메모 2건이 아직 해결 표시되지 않았습니다.', evidence_ids: g(A1, 'N-001', 'E-006', 'E-014') },
    ],
  },
  {
    target: 'risk_ripple|U-A1',
    evidence_ids: g(A1, 'N-001', 'N-002', 'N-003', 'N-012'),
    sentences: [
      { text: '「자료 수집」이 막히면 이어지는 「대사 확인」과 「보고」가 영향을 받습니다.', evidence_ids: g(A1, 'N-001', 'N-002', 'N-003') },
      { text: '서하늘이 혼자 맡은 「대사 확인」이 멈추면 「보고」까지 영향을 받습니다.', evidence_ids: g(A1, 'N-001', 'N-003', 'N-012') },
    ],
  },
  {
    target: 'risk_concentration|U-D1',
    evidence_ids: ['U-A1/N-011', 'U-B/N-101', 'U-B/N-102', 'U-B/N-201', 'U-C/N-102', 'U-C/N-202'],
    sentences: [
      { text: '부서 전체에서 한 사람만 해 봤고 인수인계 기록도 없는 업무는 8개입니다.', evidence_ids: ['U-A1/N-011', 'U-B/N-101', 'U-B/N-102', 'U-B/N-201', 'U-C/N-102', 'U-C/N-202'] },
      { text: '가상행사팀의 「2025 행사」는 윤바다, 「2026 행사」는 도하람만 맡아 봤습니다.', evidence_ids: ['U-B/N-101', 'U-A1/N-011', 'U-B/N-102', 'U-B/N-201'] },
      { text: '가상교육팀의 「강의실·강사 섭외」도 이든빛 한 사람만 해 본 업무입니다.', evidence_ids: ['U-C/N-102', 'U-C/N-202'] },
    ],
  },
  {
    target: 'risk_readiness|U-D1',
    evidence_ids: ['U-B/E-002', 'U-B/E-003', 'U-B/N-101', 'U-K1/E-003', 'U-K1/E-005', 'U-K1/E-006', 'U-K1/N-103', 'U-K1/N-104'],
    sentences: [
      { text: '부서의 업무 22개 중 6항목을 모두 갖춘 업무는 1개뿐입니다.', evidence_ids: ['U-B/N-101', 'U-K1/N-103', 'U-K1/N-104'] },
      { text: '「2025 행사」는 2025-12-15에 윤바다의 담당이 끝난 뒤 담당자도 최근 이력도 없고, 참가비 정산 불일치 메모가 해결 표시되지 않았습니다.', evidence_ids: ['U-B/N-101', 'U-B/E-002', 'U-B/E-003'] },
      { text: '카드승인의 「망취소」와 「거래 조회」는 담당자·산출물 연결이 없고, 원문의 질문·리스크 메모(§5.1·§5.2)가 해결 표시되지 않았습니다.', evidence_ids: ['U-K1/N-103', 'U-K1/N-104', 'U-K1/E-003', 'U-K1/E-005', 'U-K1/E-006'] },
    ],
  },
  {
    target: 'risk_ripple|U-D1',
    evidence_ids: ['U-C/N-102', 'U-C/N-103', 'U-C/N-104', 'U-C/N-202', 'U-K1/N-201', 'U-K1/N-202', 'U-K1/N-203', 'U-K1/N-204', 'U-K1/N-205'],
    sentences: [
      { text: '부서에서 가장 많은 업무에 닿는 길목은 카드승인의 「승인요청 수신」입니다. 이 단계가 막히면 요청 검증부터 정합성 조치까지 이어지는 4개 업무가 영향을 받습니다.', evidence_ids: ['U-K1/N-201', 'U-K1/N-202', 'U-K1/N-203', 'U-K1/N-204', 'U-K1/N-205'] },
      { text: '가상교육팀 이든빛이 혼자 맡은 업무 2개가 막히면, 이어지는 다른 업무 2개가 함께 영향을 받습니다.', evidence_ids: ['U-C/N-102', 'U-C/N-103', 'U-C/N-104', 'U-C/N-202'] },
    ],
  },
].map((x) => ({ task: 'insight_explain', ...x }));

// 역할 (c) 업무 후보 이유(T-10): 통합 확인 목록의 업무 후보마다. 왜 후보인지와 두 업무의 차이까지만 쓰고, 같은지는 사람이 정한다
const candidate = [
  {
    pair: ['U-A1/N-001', 'U-K1/N-104'],
    evidence_ids: ['U-A1/N-001', 'U-K1/N-104', 'U-A1/N-030'],
    sentences: [
      { text: '「대사 확인」과 카드승인의 「거래 조회」는 정산팀에서 사람이 이어 둔 같은 주제 「대사 불일치」를 다룹니다.', evidence_ids: ['U-A1/N-001', 'U-K1/N-104', 'U-A1/N-030'] },
      { text: '「거래 조회」는 업무 설명이 없어, 같은 업무인지는 담당자에게 확인해야 합니다.', evidence_ids: ['U-K1/N-104'] },
    ],
  },
  {
    pair: ['U-A1/N-001', 'U-K1/N-105'],
    evidence_ids: ['U-A1/N-001', 'U-K1/N-105', 'U-A1/N-030'],
    sentences: [
      { text: '둘 다 「대사 불일치」 주제를 다루지만, 「장애 시 재처리」는 장애로 저장해 둔 건을 별도 처리로 다시 보내는 일이고 「대사 확인」은 월말 정산 결과를 대조하는 일입니다.', evidence_ids: ['U-A1/N-001', 'U-K1/N-105', 'U-A1/N-030'] },
    ],
  },
  {
    pair: ['U-A1/N-003', 'U-C/N-104'],
    evidence_ids: ['U-A1/N-003', 'U-C/N-104'],
    sentences: [
      { text: '두 업무 모두 결과를 정리해 팀장 검토 후 공유하는 보고 업무입니다.', evidence_ids: ['U-A1/N-003', 'U-C/N-104'] },
      { text: '다만 월말 정산의 「보고」는 매월, 「교육 결과 보고」는 과정이 끝날 때마다 하며 다루는 내용(점검 결과 / 출석·만족도)이 다릅니다.', evidence_ids: ['U-A1/N-003', 'U-C/N-104'] },
    ],
  },
  {
    pair: ['U-B/N-103', 'U-C/N-102'],
    evidence_ids: ['U-B/N-103', 'U-C/N-102'],
    sentences: [
      { text: '둘 다 일정에 맞춰 장소를 알아보고 잡는 일입니다(행사 장소 계약 / 교육 강의실 예약).', evidence_ids: ['U-B/N-103', 'U-C/N-102'] },
      { text: '「강의실·강사 섭외」는 사내 강사에게 강의를 요청하는 일까지 포함합니다.', evidence_ids: ['U-C/N-102'] },
    ],
  },
].map(({ pair, ...x }) => ({ task: 'work_candidate_reason', target: `work_candidate|${[...pair].sort().join('|')}`, ...x }));

// 지문(fp): 줄을 쓸 때의 규칙 기반 문장의 지문(llm/providers.js fingerprint). 조회 때 지금 규칙 기반 문장의 지문과 다르면 그 항목은 규칙 기반으로 돌아간다(K-9).
// 문장은 건드리지 않고 이 표만 `node tools/pregen-dump.mjs --write-fp`로 다시 만든다(데이터를 고쳐 문장을 새로 쓴 뒤). 키: task|target|item|보내는>받는
// FP-BEGIN
const FP = {
  "handover|U-A1/N-000|업무_개요|U-A1/N-011>U-A1/N-012": 'b492e1f0',
  "handover|U-A1/N-000|세부_업무_절차|U-A1/N-011>U-A1/N-012": '4e87acaf',
  "handover|U-A1/N-000|일정_마감|U-A1/N-011>U-A1/N-012": '2f13cf1a',
  "handover|U-A1/N-000|주의사항|U-A1/N-011>U-A1/N-012": '63bc7d08',
  "handover|U-A1/N-000|진행_중|U-A1/N-011>U-A1/N-012": '3c1df702',
  "handover|U-A1/N-000|산출물_문서|U-A1/N-011>U-A1/N-012": '9e94f20c',
  "handover|U-A1/N-000|관계자_연락처|U-A1/N-011>U-A1/N-012": '9332aaaa',
  "handover|U-A1/N-000|최근_이슈|U-A1/N-011>U-A1/N-012": '78821adc',
  "handover|U-A1/N-000|이전_인수인계|U-A1/N-011>U-A1/N-012": '699c8b7f',
  "handover|U-A1/N-000|유사_경험자|U-A1/N-011>U-A1/N-012": 'cf156094',
  "handover|U-C/N-101|업무_개요|U-C/N-202>U-C/N-201": 'fa081938',
  "handover|U-C/N-101|세부_업무_절차|U-C/N-202>U-C/N-201": 'fb082476',
  "handover|U-C/N-101|일정_마감|U-C/N-202>U-C/N-201": 'f0da42b5',
  "handover|U-C/N-101|주의사항|U-C/N-202>U-C/N-201": '041f61b4',
  "handover|U-C/N-101|진행_중|U-C/N-202>U-C/N-201": '0dc0f762',
  "handover|U-C/N-101|산출물_문서|U-C/N-202>U-C/N-201": '27154aca',
  "handover|U-C/N-101|관계자_연락처|U-C/N-202>U-C/N-201": 'a8c4f7fd',
  "handover|U-C/N-101|최근_이슈|U-C/N-202>U-C/N-201": '991d9712',
  "handover|U-C/N-101|이전_인수인계|U-C/N-202>U-C/N-201": 'a5e69b9d',
  "insight_explain|similar|U-A1/N-001||": 'e2a4a3e7',
  "insight_explain|repeat|U-A1||": '0d20fb69',
  "insight_explain|repeat|U-D1||": '79ac9b60',
  "insight_explain|density|U-D1|n=3||": '5d65ae56',
  "insight_explain|density|U-C|n=3||": '20f66f7b',
  "insight_explain|flow|U-A1|month||": 'c78f93fa',
  "insight_explain|flow|U-O|month||": '6e8d1326',
  "insight_explain|risk_concentration|U-A1||": '64b77fed',
  "insight_explain|risk_readiness|U-A1||": '1b0e4846',
  "insight_explain|risk_ripple|U-A1||": '080f0b26',
  "insight_explain|risk_concentration|U-D1||": 'e6412c21',
  "insight_explain|risk_readiness|U-D1||": '47eda5b6',
  "insight_explain|risk_ripple|U-D1||": 'd5a64fa4',
  "work_candidate_reason|work_candidate|U-A1/N-001|U-K1/N-104||": 'b1db6c11',
  "work_candidate_reason|work_candidate|U-A1/N-001|U-K1/N-105||": 'b1db6c11',
  "work_candidate_reason|work_candidate|U-A1/N-003|U-C/N-104||": '47aa15ea',
  "work_candidate_reason|work_candidate|U-B/N-103|U-C/N-102||": 'cf9fed35',
};
// FP-END
const fpKey = (it) => [it.task, it.target, it.item || '', it.from && it.to ? `${it.from}>${it.to}` : ''].join('|');

export const PREGEN = {
  schema_version: '1.0',
  generator: 'Claude Code (개발 시 작성)',
  generated_at: '2026-10-02T15:00:00+09:00',
  data_version: 'v2',
  items: [...handoverA1, ...handoverC, ...explain, ...candidate].map((it) => ({ ...it, fp: FP[fpKey(it)] })),
};
