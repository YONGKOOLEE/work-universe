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
