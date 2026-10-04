// CR-3 변환 사례(A 방식): 사용자 업무정의서 "카드승인 전문 송수신 업무정의서(초안)"를
// 개발 중 Claude Code가 02-design 12.9 변환 규칙 초안 v0으로 유니버스 문서(12.2)로 바꾼 것.
// - 모든 노드·메모에 원문 근거(attrs.원문 = 절 번호)를 둔다. [가정]·[미확인]은 attrs.상태로 보존한다.
// - 원문에 사람 이름이 없어 사람 노드는 역할 이름을 라벨로 쓴다. 당사 역할에만 가상 사번(V-4xxx)을 붙였다.
// - 원문의 기관·표준명(여신금융협회, PCI DSS 등)은 사용자 결정에 따라 치환하지 않았다(2026-10-01).
// - 원문 작성일이 없어 메모 이벤트 시점은 문서를 받은 날(2026-10-01)로 적었다.
// 변환 규칙이 확정되면(T-17) 이 파일도 규칙에 맞춰 다시 만든다. 고치면 STAMP를 바꾼다.

const STAMP = '2026-10-05T00:30:00+09:00'; // 검토6 U-13: 설명의 내부 번호 제거(앞서 검토5 V-2: 작성 주체를 가상 이름으로)
const DOC_DATE = '2026-10-01';

const node = (id, core_type, label, rest = {}) => ({
  id, core_type, label, ...rest, hidden: false, created_at: STAMP, updated_at: STAMP,
});
const work = (id, label, 원문, rest = {}) => node(id, 'work', label, { ...rest, attrs: { 원문, ...(rest.attrs || {}) } });
const topic = (id, label, subtype, 원문, description, 상태) =>
  node(id, 'topic', label, { subtype, description, attrs: { 원문, ...(상태 ? { 상태 } : {}) } });
let edgeSeq = 0;
const edge = (source, target, core_type, rest = {}) => {
  edgeSeq += 1;
  return { id: `L-${String(edgeSeq).padStart(3, '0')}`, source, target, core_type, ...rest, hidden: false, created_at: STAMP };
};
const memo = (id, target_id, topic_ids, note) => ({
  id, type: 'memo', occurred_at: DOC_DATE, recorded_at: STAMP, source: 'sample', payload: { target_id, topic_ids }, note,
});

export const SAMPLE_CARD = {
  schema_version: '1.0',
  universe: {
    id: 'U-K1',
    name: '대형가맹점 A 카드승인 전문 송수신',
    level: '업무',
    owner: '가상 시스템분석팀',
    description:
      'A사 결제 요청을 카드사/VAN으로 전달하고 승인 결과를 A사에 실시간으로 회신한다(원문 §1 목적). ' +
      '범위 제외: 매입·정산 배치, 포인트·할인 적용, 현금영수증 [가정: 후속 과제]. ' +
      '업무정의서(초안)에서 변환한 유니버스(가상 가맹점).',
    root_node_id: 'N-000',
    subtypes: [
      { core_type: 'work', name: '처리 단계' },
      { core_type: 'person', name: '역할' },
      { core_type: 'topic', name: '요건' },
      { core_type: 'topic', name: '예외' },
      { core_type: 'topic', name: '보안' },
      { core_type: 'topic', name: '비기능' },
      { core_type: 'artifact', name: '문서' },
    ],
    is_sample: true,
    created_at: STAMP,
  },
  nodes: [
    node('N-000', 'root', '대형가맹점 A 카드승인 전문 송수신', {
      description: 'A사 결제 요청을 카드사/VAN으로 전달하고 승인 결과를 A사에 실시간으로 회신한다.',
      attrs: { 원문: '§1', 배경: 'A사 결제량이 많아 기존 공용 채널 대신 전용 연동 구간이 필요하다', 상태: '가정' },
    }),

    // §1 범위 → 업무
    work('N-101', '승인', '§1 범위'),
    work('N-102', '승인취소', '§1 범위', { description: '매입 전 승인취소. 매입 후는 매출취소로 처리가 다르다(§3 취소 구분)' }),
    work('N-103', '망취소', '§1 범위, §3', {
      description: '승인 요청 중 타임아웃·통신 장애로 응답을 받지 못했을 때 정합성을 위해 요청한다. 승인 요청 때 쓴 데이터를 그대로 쓰고 요청 ID로 대상을 식별한다',
    }),
    work('N-104', '거래 조회', '§1 범위'),
    work('N-105', '장애 시 재처리', '§1 범위, §4.1', { description: '비동기 저장 후 별도 프로세스·배치로 재처리할 수 있다. 재처리 주기와 횟수는 별도 정의' }),

    // §2 업무 흐름 → 처리 단계
    work('N-201', '승인요청 수신', '§2-1', { subtype: '처리 단계', description: 'A사 결제 시스템이 승인요청 전문을 당사로 송신한다' }),
    work('N-202', '요청 검증', '§2-2', { subtype: '처리 단계', description: '전문 형식, 필수값, 중복 여부, 가맹점 유효성을 검증한다' }),
    work('N-203', '카드사 전문 변환·송신', '§2-3', { subtype: '처리 단계', description: '검증을 통과한 요청을 카드사/VAN 규격 전문으로 변환해 송신한다' }),
    work('N-204', '응답 수신·회신', '§2-4', { subtype: '처리 단계', description: '승인번호·응답코드를 기록하고 A사 규격 응답으로 회신한다' }),
    work('N-205', '정합성 조치', '§2-5', {
      subtype: '처리 단계',
      description: '응답이 지연되거나 연결이 끊기면 승인 여부를 확정할 수 없으므로 망취소 또는 조회 절차로 정합성을 맞춘다',
    }),

    // §3 요건, §4 예외·보안·비기능, §5 대사 → 주제
    topic('N-301', '전문 규격', '요건', '§3', '승인요청/응답, 취소요청/응답, 망취소, 조회. 고정길이/가변, ISO 8583 계열 여부', '미확인'),
    topic('N-302', '통신 방식', '요건', '§3', 'TCP 소켓 상시 연결 또는 요청별 연결. 연결 수, keep-alive, 전용회선/VPN 여부', '미확인'),
    topic('N-303', '거래 고유번호', '요건', '§3', '중복 방지와 망취소 대상 특정에 사용. 필수 식별자: 가맹점 번호, 거래 고유번호, 일시, 금액, 거래 구분'),
    topic('N-304', '타임아웃', '예외', '§3, §4.1', '카드사 구간 타임아웃 안에 A사 타임아웃이 들어가도록 설계. 타임아웃 시 A사에는 실패로 응답하고 내부에서 망취소', '가정'),
    topic('N-305', '취소 구분', '요건', '§3', '매입 전 승인취소, 매입 후 매출취소, 승인 결과 불명 시 망취소. 세 경우의 처리 방식이 다르다'),
    topic('N-306', '부분취소', '요건', '§3', '전액·부분취소 여부, 누적 취소 한도', '미확인'),
    topic('N-307', '중복 요청', '예외', '§4.1', '같은 거래 고유번호가 재수신되면 새로 승인하지 않고 기존 결과를 회신한다', '가정'),
    topic('N-308', '망상취소', '예외', '§4.1', '카드사와 VAN 사이 통신 장애로 승인이 자동 취소될 수 있다. 고객 재승인 요청 절차를 A사와 미리 합의'),
    topic('N-309', '마감 시각 경계', '예외', '§4.1', '매입 전후로 승인취소와 매출취소가 갈린다. 마감 시각은 계약에 따라 다르다'),
    topic('N-310', '카드번호 마스킹', '보안', '§4.2', '로그·화면 출력 시 마스킹. PCI DSS 기준은 앞 6자리·뒤 최대 4자리 표시 가능, 여신금융협회 기준 등 적용 기준은 확정 필요'),
    topic('N-311', 'CVC 저장 금지', '보안', '§4.2', 'CVC/CVV 같은 카드 검증값은 승인 후 저장 금지(암호화해도 저장 불가)'),
    topic('N-312', '전송 구간 암호화', '보안', '§4.2', 'TLS 또는 전용 암호화와 키 교체 절차', '미확인'),
    topic('N-313', '비기능 요건', '비기능', '§4.3', '처리량(피크 TPS), 응답시간, 가용성(이중화), 감사(전문 원문 보관·마스킹), 모니터링(응답코드·타임아웃율·망취소 건수)', '가정'),
    topic('N-314', '대사(승인 내역 정합성 확인)', '요건', '§5.1-5, §5.2', '대사 주기와 불일치 처리 절차. 승인 불명확 거래 누락 대응으로 일 단위 대사', '미확인'),

    // §1 이해관계자 → 조직·역할
    node('N-401', 'org', '가상 대형가맹점 A사', { attrs: { 원문: '§1 이해관계자' } }),
    node('N-402', 'org', '가상 카드사·VAN', { attrs: { 원문: '§1 이해관계자' } }),
    node('N-403', 'org', '가상 당사(승인 중계)', { attrs: { 원문: '§1 이해관계자' } }),
    node('N-501', 'person', 'A사 결제 담당', { subtype: '역할', attrs: { 원문: '§1 이해관계자' } }),
    node('N-502', 'person', '카드사/VAN 연동 담당', { subtype: '역할', emp_no: 'V-4001', attrs: { 원문: '§1 이해관계자' } }),
    node('N-503', 'person', '운영 담당', { subtype: '역할', emp_no: 'V-4002', attrs: { 원문: '§1 이해관계자' } }),
    node('N-504', 'person', '보안 담당', { subtype: '역할', emp_no: 'V-4003', attrs: { 원문: '§1 이해관계자' } }),
    node('N-505', 'person', '정산 담당', { subtype: '역할', emp_no: 'V-4004', attrs: { 원문: '§1 이해관계자' } }),

    // §6 다음 산출물, §5.2 대응 → 산출물
    node('N-601', 'artifact', '전문 명세서', { subtype: '문서', attrs: { 원문: '§6', 순서: 1 } }),
    node('N-602', 'artifact', '예외 시나리오 테이블', { subtype: '문서', attrs: { 원문: '§6', 순서: 2 } }),
    node('N-603', 'artifact', '테스트 케이스', { subtype: '문서', description: '정상·타임아웃·중복·망취소', attrs: { 원문: '§6', 순서: 3 } }),
    node('N-604', 'artifact', '응답코드 매핑표', { subtype: '문서', description: '카드사별 응답코드·필드 해석 차이 대응', attrs: { 원문: '§5.2' } }),
    node('N-605', 'artifact', '업무정의서(초안)', { subtype: '문서', description: '이 유니버스의 원문', attrs: { 원문: '전체' } }),
  ],
  edges: [
    // 꼭지 → 범위 업무
    ...['N-101', 'N-102', 'N-103', 'N-104', 'N-105'].map((w) => edge('N-000', w, 'contains')),
    // 승인 업무 안의 처리 단계와 흐름
    ...['N-201', 'N-202', 'N-203', 'N-204'].map((w) => edge('N-101', w, 'contains')),
    edge('N-103', 'N-205', 'contains'),
    edge('N-201', 'N-202', 'precedes'),
    edge('N-202', 'N-203', 'precedes'),
    edge('N-203', 'N-204', 'precedes'),
    edge('N-204', 'N-205', 'precedes', { note: '응답 지연·연결 끊김 시' }),
    edge('N-205', 'N-104', 'references', { note: '조회로 정합성 확인' }),
    edge('N-105', 'N-103', 'references', { note: '실패한 망취소 재처리' }),
    edge('N-203', 'N-402', 'references', { note: '전문 송신 대상(외부 기관)' }),
    edge('N-201', 'N-401', 'references', { note: '승인요청을 보내는 곳(외부 기관)' }),
    // 업무·단계 → 주제
    edge('N-202', 'N-303', 'relates_to'),
    edge('N-202', 'N-307', 'relates_to'),
    edge('N-202', 'N-301', 'relates_to'),
    edge('N-203', 'N-301', 'relates_to'),
    edge('N-203', 'N-302', 'relates_to'),
    edge('N-204', 'N-304', 'relates_to'),
    edge('N-103', 'N-304', 'relates_to'),
    edge('N-103', 'N-303', 'relates_to'),
    edge('N-103', 'N-305', 'relates_to'),
    edge('N-102', 'N-305', 'relates_to'),
    edge('N-102', 'N-306', 'relates_to'),
    edge('N-102', 'N-309', 'relates_to'),
    edge('N-101', 'N-308', 'relates_to'),
    edge('N-101', 'N-310', 'relates_to'),
    edge('N-101', 'N-311', 'relates_to'),
    edge('N-101', 'N-312', 'relates_to'),
    edge('N-101', 'N-313', 'relates_to'),
    edge('N-105', 'N-304', 'relates_to'),
    edge('N-105', 'N-314', 'relates_to'),
    edge('N-104', 'N-314', 'relates_to'),
    // 역할 → 업무·주제·조직
    edge('N-501', 'N-201', 'performs'),
    edge('N-502', 'N-203', 'performs'),
    edge('N-503', 'N-105', 'performs'),
    edge('N-503', 'N-205', 'performs'),
    edge('N-505', 'N-104', 'performs'),
    edge('N-504', 'N-310', 'relates_to'),
    edge('N-504', 'N-311', 'relates_to'),
    edge('N-504', 'N-312', 'relates_to'),
    edge('N-505', 'N-314', 'relates_to'),
    edge('N-501', 'N-401', 'belongs_to'),
    edge('N-502', 'N-403', 'belongs_to'),
    edge('N-503', 'N-403', 'belongs_to'),
    edge('N-504', 'N-403', 'belongs_to'),
    edge('N-505', 'N-403', 'belongs_to'),
    // 산출물
    edge('N-203', 'N-601', 'produces'),
    edge('N-205', 'N-602', 'produces'),
    edge('N-101', 'N-603', 'produces'),
    edge('N-203', 'N-604', 'produces'),
    edge('N-602', 'N-601', 'references', { note: '§6 순서: 명세서 → 예외 시나리오' }),
    edge('N-603', 'N-602', 'references', { note: '§6 순서: 예외 시나리오 → 테스트 케이스' }),
    edge('N-601', 'N-605', 'references'),
  ],
  events: [
    // §5.1 확정할 질문, §5.2 주요 리스크 → 메모
    memo('E-001', 'N-203', ['N-301'], '[§5.1-1 질문] 전문 규격(필드 정의, 인코딩)과 테스트 환경은 누가 제공하는가?'),
    memo('E-002', 'N-203', ['N-302'], '[§5.1-2 질문] 연결 방식과 네트워크 구성(전용회선, VPN, 접속 IP 제한)은 어떻게 하는가?'),
    memo('E-003', 'N-103', ['N-304'], '[§5.1-3 질문] 타임아웃·재처리 책임은 어느 구간이 지는가?'),
    memo('E-004', 'N-102', ['N-306', 'N-305'], '[§5.1-4 질문] 부분취소와 매입 후 취소를 지원하는가?'),
    memo('E-005', 'N-104', ['N-314'], '[§5.1-5 질문] 대사 주기와 불일치 처리 절차는 무엇인가?'),
    memo('E-006', 'N-103', ['N-304', 'N-314'], '[§5.2 리스크] 승인 불명확 거래 누락: 망취소 실패 시 고객은 미승인으로 알지만 한도는 차감될 수 있음 → 재처리 큐, 일 단위 대사'),
    memo('E-007', 'N-203', ['N-301'], '[§5.2 리스크] 규격 불일치: 카드사별 응답코드·필드 해석 차이로 오류 분기 증가 → 요구사항 단계에서 코드 매핑표 확정'),
    memo('E-008', 'N-101', ['N-310', 'N-311'], '[§5.2 리스크] 보안 심사 지연: 저장 항목·마스킹 기준 협의 지연 → 일정 초기에 보안 담당과 기준 확정'),
  ],
  refs: [],
  identity_links: [],
};
