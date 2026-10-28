// ─────────────────────────────────────────────────────────────
// 업무 지식관리 플랫폼 데이터 모델
// 모든 메뉴(대시보드·문서함·타임라인·회의록·AI 검색·인계)는
// 아래 단일 저장소(AppState)를 서로 다른 관점에서 보여준다.
// 추후 사내 DB / LLM API 연계 시 이 타입이 API 계약의 기준이 된다.
// ─────────────────────────────────────────────────────────────

/** 서술(문장) 단위 근거 구분 */
export type Prov =
  | 'fact' // 원문 확인 사실 — 등록 문서에 직접 기재
  | 'inference' // AI 추론 — 여러 문서를 종합한 해석
  | 'unverified' // 추가 확인 필요 — 근거 부족, 확정하지 않음
  | 'owner'; // 담당자 작성 — 사람이 직접 입력한 내용

/** 이벤트·문서의 원문 확보 상태 */
export type SourceStatus =
  | 'original' // 원문 확보·등록
  | 'cited' // 다른 원문 안에서 인용으로 확인
  | 'reference' // 정책 이력 참고정보 (원문 미등록)
  | 'link' // 링크만 등록, 원문 내용 미확인
  | 'record' // 플랫폼 내부 기록
  | 'unverified'; // 문서에서 추출했으나 원문 근거 확인 안 됨 — 별도 확인 필요

export interface Cite {
  docId: string;
  anchor?: string; // 문서 내 위치 (예: item-54)
  label?: string;
}

export interface Stmt {
  id: string;
  text: string;
  prov: Prov;
  cite?: Cite[];
  note?: string;
}

export interface User {
  id: string;
  name: string;
  dept: string;
  title: string;
  empNo?: string;
  role?: 'member' | 'lead';
  /** 전출·퇴직이면 'left'. 없으면 재직(active)으로 본다. 선택 칸이라 스키마 번호는 그대로 */
  status?: 'active' | 'left';
}

export type WorkStatus = '검토 중' | '진행 중' | '운영 중' | '완료' | '보류';
export const WORK_STATUSES: WorkStatus[] = ['검토 중', '진행 중', '운영 중', '완료', '보류'];

export interface Partner {
  name: string;
  role: string;
  prov: Prov;
  cite?: Cite[];
  note?: string;
}

export interface Work {
  id: string;
  name: string;
  parentId: string | null;
  relatedIds: string[];
  type: string;
  agency: string; // 소관 기관
  dept: string; // 담당 부서
  owners: string[]; // 현재 담당자 (복수 가능)
  ownerHistory: OwnerPeriod[]; // 담당 기간 이력 (빠진 담당자도 기록 유지)
  status: WorkStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
  summary: string;
  keywords: string[];
  purpose: Stmt[];
  background: Stmt[];
  current: Stmt[];
  cautions: Stmt[];
  rejected: Stmt[];
  partners: Partner[];
  nextIds: string[]; // 이 업무 다음에 오는 업무 ID들 (선후행)
  topics: string[]; // 주제 이름들
}

export interface OwnerPeriod {
  userId: string;
  from: string;
  to: string | null; // null = 현재 담당
  note?: string; // 예: 'HO-003 인계로 지정'
}

export interface Decision {
  id: string;
  workId: string;
  date: string;
  title: string;
  details: string[];
  prov: Prov;
  source: SourceStatus;
  cite: Cite[];
  rationale: Stmt; // 결정 이유 (없으면 unverified)
  eventId?: string;
  hidden?: boolean; // 업무 한눈에 보기에서 숨김
}

export type ActionStatus = '예정' | '진행' | '완료';
export interface Action {
  id: string;
  workId: string;
  title: string;
  due: string | null;
  status: ActionStatus;
  ownerId: string;
  note?: string;
  createdAt: string;
  cite?: Cite[];
}

export type EventType =
  | '업무 착수'
  | '법령'
  | '회의'
  | '의사결정'
  | '보도자료'
  | '시행'
  | '업무 변경'
  | '담당자 변경'
  | '문서'; // 문서 등록으로 자동 추가

export interface CauseLink {
  eventId: string;
  basis: 'fact' | 'inference';
  note: string;
  cite?: Cite[];
}

export interface TEvent {
  id: string;
  workIds: string[];
  date: string; // YYYY-MM-DD 또는 YYYY-MM
  type: EventType;
  title: string;
  summary: string;
  decisions: string[];
  agency: string;
  docIds: string[];
  cite: Cite[];
  source: SourceStatus;
  meaning: string; // AI 추론 — 이 사건의 의미
  causes: CauseLink[]; // 선행 사건(계기)
  phase: string;
  autoDocId?: string; // 문서 등록으로 자동 생성된 이벤트의 원본 문서
}

export type DocType =
  | '검토보고서'
  | '법령 개정자료'
  | '회의록'
  | '보도자료'
  | '추진계획'
  | '결과보고서'
  | '보고자료'
  | '기타';
export const DOC_TYPES: DocType[] = ['검토보고서', '보고자료', '법령 개정자료', '회의록', '보도자료', '추진계획', '결과보고서', '기타'];

export type RelType = '유사' | '선행' | '후속' | '근거' | '개정' | '대체';
export interface DocRelation {
  targetId: string;
  type: RelType;
  basis: 'fact' | 'inference';
  note: string;
}

export interface DocParagraph {
  id: string;
  text: string;
  page?: number; // PDF 쪽 번호
}

export interface Doc {
  id: string;
  title: string;
  type: DocType;
  writtenAt: string; // 작성일 (원문 기준)
  registeredAt: string; // 플랫폼 등록일
  source: string;
  url?: string;
  availability: SourceStatus;
  workIds: string[];
  relevance?: { workId: string; level: 'direct' | 'none'; reason: string }[];
  summary: string[]; // AI 3줄 요약 (원문 없으면 빈 배열)
  keywords: string[];
  relations: DocRelation[];
  paragraphs?: DocParagraph[]; // 사용자가 등록한 텍스트 문서
  note?: string;
  analyzed: boolean;
  registeredBy: string;
  fileName?: string;
  timelineOff?: boolean; // 타임라인 자동 이벤트를 사용자가 삭제함
  analyzedBy?: 'claude' | 'mock';
}

export interface HistoryEntry {
  id: string;
  workId: string;
  at: string;
  actorId: string | 'ai';
  kind: string;
  summary: string;
}

export type HandoverStatus = 'draft' | 'submitted' | 'revision' | 'accepted' | 'confirmed';

export interface HandoverRequest {
  id: string;
  at: string;
  byId: string;
  text: string;
  response?: string;
  resolvedAt?: string;
}

export interface Handover {
  id: string;
  workId: string;
  fromId: string;
  toId: string;
  baseDate: string;
  status: HandoverStatus;
  step: number; // 1~8
  precheckDone: boolean;
  checklist: Record<string, boolean>;
  supplement: string; // 인계자 보완 메모
  fromLeaves: boolean | null; // 인계 후 인계자가 담당에서 빠지는지 (인계자가 결정)
  submittedAt?: string;
  acceptedAt?: string;
  confirmedAt?: string;
  requests: HandoverRequest[];
  log: { at: string; byId: string; text: string }[];
  snapshotId?: string;
  createdAt: string;
}

export interface Snapshot {
  id: string;
  handoverId: string;
  workId: string;
  takenAt: string;
  version: number;
  work: Work;
  decisions: Decision[];
  actions: Action[];
  events: TEvent[];
  docs: Pick<Doc, 'id' | 'title' | 'type' | 'writtenAt' | 'availability'>[];
}

export interface AppState {
  schema: number;
  seedMode: 'linked' | 'fresh';
  seededAt: string;
  currentUserId: string;
  users: User[];
  works: Work[];
  docs: Doc[];
  events: TEvent[];
  decisions: Decision[];
  actions: Action[];
  history: HistoryEntry[];
  handovers: Handover[];
  snapshots: Snapshot[];
  mapHidden: string[]; // 지도에서 숨긴 항목 키
  privateMemos?: PrivateMemo[]; // 「나만 보기」 메모 — 쓴 사람에게만 보인다(열람 범위에서 거름, 2026-10-29 사용자 결정)
  searchLog: string[];
  focus: Record<string, string>; // 사용자별로 마지막에 보던 업무 ('all' 또는 업무 ID)
}

/** 「나만 보기」 메모: 업무에 붙지만 쓴 사람만 본다. 업무 기록·인계·지도 파생에는 들어가지 않는다 */
export interface PrivateMemo {
  id: string;
  workId: string;
  userId: string;
  text: string;
  at: string;
}
