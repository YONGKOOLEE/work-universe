// 02-design 12절(CR-2) 스키마 상수. 핵심 유형 목록은 이 파일 한 곳에만 둔다(1.3 확장 조건).

export const SCHEMA_VERSION = '1.0';

// 노드 핵심 유형(12.2 nodes[].core_type) → 화면 표시 이름
export const NODE_TYPES = {
  root: '꼭지',
  person: '사람',
  work: '업무',
  artifact: '산출물',
  org: '조직',
  topic: '주제',
};

// 관계 핵심 유형(12.2 edges[].core_type) → 화면 표시 이름
export const EDGE_TYPES = {
  contains: '포함',
  performs: '수행',
  produces: '산출',
  precedes: '선후행',
  belongs_to: '소속',
  relates_to: '관련',
  references: '참조',
};

// 모르는 유형을 불러왔을 때의 표시 이름(1.3: 멈추지 않고 "기타"로 표시)
export const UNKNOWN_TYPE_LABEL = '기타';

// 12.1 ID 접두어
export const ID_PREFIX = {
  universe: 'U-',
  node: 'N-',
  edge: 'L-',
  event: 'E-',
  identity: 'I-',
};

export const LABEL_MAX = 100;

// 12.5 오류·경고 코드
export const CODES = {
  REQUIRED: 'E-REQUIRED',
  DUP: 'E-DUP',
  PAIR: 'E-PAIR',
  SUBTYPE: 'E-SUBTYPE',
  CYCLE: 'E-CYCLE',
  SCHEMA: 'E-SCHEMA',
  NO_EMPNO: 'W-NO-EMPNO',
  EMPNO_CONFLICT: 'W-EMPNO-CONFLICT',
  STORAGE: 'W-STORAGE',
  LLM_FALLBACK: 'W-LLM-FALLBACK',
};

export function nodeTypeLabel(coreType) {
  return NODE_TYPES[coreType] || UNKNOWN_TYPE_LABEL;
}

export function edgeTypeLabel(coreType) {
  return EDGE_TYPES[coreType] || UNKNOWN_TYPE_LABEL;
}

// 12.1 중복 비교용 정규화: 앞뒤 공백 제거 + 영문 소문자
export function normalizeLabel(label) {
  return String(label).trim().toLowerCase();
}

// 12.2 events[].type → 화면 표시 이름(1.4)
export const EVENT_TYPES = {
  created: '생성',
  updated: '수정',
  hidden: '숨김',
  assign_start: '담당 시작',
  assign_end: '담당 종료',
  handover: '인수인계',
  affiliation_change: '소속 변경',
  memo: '메모',
};

// 사용자가 직접 입력하는 이벤트 유형. created·updated·hidden은 명령이 자동으로 기록한다(1.4)
export const USER_EVENT_TYPES = ['assign_start', 'assign_end', 'handover', 'affiliation_change', 'memo'];

export const EVENT_SOURCES = ['user', 'sample', 'system'];

// 메모 범주(02-design 5.6, 12.2 memo.payload.category). 없으면 이슈로 본다
export const MEMO_CATEGORIES = { issue: '이슈', caution: '주의사항', in_progress: '진행 중', resolved: '해결됨' };
export const memoCategoryOf = (payload) => (payload && payload.category) || 'issue';

// 12.2 이벤트 payload 규칙. required: 필수 키, nodeRefs: 노드 ID를 담는 키,
// nodeListRefs: 노드 ID 배열을 담는 키, eventRefs: 이벤트 ID를 담는 키.
// 키가 가리켜야 하는 노드 유형은 EVENT_REF_TYPES에 있다(예: person_id는 사람 노드)
export const EVENT_PAYLOAD = {
  created: { required: ['target_kind', 'target_id'] },
  hidden: { required: ['target_kind', 'target_id'] },
  updated: { required: ['target_kind', 'target_id', 'before', 'after'] },
  assign_start: { required: ['person_id', 'work_id'], nodeRefs: ['person_id', 'work_id'] },
  assign_end: { required: ['person_id', 'work_id'], nodeRefs: ['person_id', 'work_id'] },
  handover: {
    required: ['work_id', 'from_person_id', 'to_person_id'],
    nodeRefs: ['work_id', 'from_person_id', 'to_person_id', 'artifact_id'],
    eventRefs: ['previous_handover_id'],
  },
  affiliation_change: { required: ['person_id'], nodeRefs: ['person_id', 'from_org_id', 'to_org_id'] },
  memo: { nodeRefs: ['target_id'], nodeListRefs: ['topic_ids'] },
};

// topic은 CR-4(제안): 유니버스 사이 공유 주제를 잇는다. 사람 확인만 허용
// 이벤트 payload 키 → 가리켜야 하는 노드 핵심 유형. 인수인계 초안·인사이트 규칙이 이 유형을 믿고 계산한다
export const EVENT_REF_TYPES = {
  person_id: 'person',
  from_person_id: 'person',
  to_person_id: 'person',
  work_id: 'work',
  artifact_id: 'artifact',
  from_org_id: 'org',
  to_org_id: 'org',
  topic_ids: 'topic',
};

export const IDENTITY_KINDS = ['person', 'work', 'topic'];
export const IDENTITY_METHODS = ['emp_no_auto', 'human'];
export const IDENTITY_STATUSES = ['pending', 'confirmed', 'rejected'];

// 12.2 관계 유형별 허용 조합(출발 유형, 도착 유형)
const PAIR_RULES = {
  contains: (s, t) => (s === 'root' && t !== 'root') || (s === 'work' && t === 'work'),
  performs: (s, t) => s === 'person' && t === 'work',
  produces: (s, t) => s === 'work' && t === 'artifact',
  precedes: (s, t) => s === 'work' && t === 'work',
  belongs_to: (s, t) => (s === 'person' || s === 'org') && t === 'org',
  relates_to: (s, t) => s !== 'root' && t === 'topic',
  references: (s, t) => s !== 'root' && t !== 'root',
};

// 모르는 관계·노드 유형은 불러올 때 멈추지 않도록(1.3) 허용으로 본다.
export function pairAllowed(edgeType, sourceType, targetType) {
  const rule = PAIR_RULES[edgeType];
  if (!rule || !NODE_TYPES[sourceType] || !NODE_TYPES[targetType]) return true;
  return rule(sourceType, targetType);
}

export function eventTypeLabel(type) {
  return EVENT_TYPES[type] || UNKNOWN_TYPE_LABEL;
}
