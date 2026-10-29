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
  importedFrom?: string[]; // 합쳐 불러오기로 들어온 원본 표시(`원본ID|정규화 이름`) — 다음 불러오기에서 이 업무로 맞춘다
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
  | '업무 매뉴얼'
  | '보고자료'
  | '기타';
export const DOC_TYPES: DocType[] = ['검토보고서', '보고자료', '법령 개정자료', '회의록', '보도자료', '추진계획', '결과보고서', '업무 매뉴얼', '기타'];

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
  analyzedAt?: string; // 마지막으로 (다시) 분석한 시각
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
  /** 조직장이 담당자 대신 시작했으면 그 조직장의 ID(없으면 담당자가 직접 시작). 사전 점검·제출은 이 경우에만 범위 안 조직장도 할 수 있다 */
  startedById?: string;
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
  deletedDocs?: DeletedDoc[]; // 지운 문서 기록(합쳐 불러오기에서 되살아나지 않게). 선택 칸이라 스키마 번호는 그대로
  orgs?: Org[]; // 조직 계층(팀 → 부 → 본부 → 회사, 2026-10-29 사용자 결정). 없으면 업무·사람의 dept 글자를 팀으로 본다(lib/orgs.ts)
  privateMemos?: PrivateMemo[]; // 「나만 보기」 메모 — 쓴 사람에게만 보인다(열람 범위에서 거름, 2026-10-29 사용자 결정)
  aiChecks?: Record<string, AiCheckRecord>; // 업무 ID → 마지막 AI 점검 결과(업무 내용이 아니라 버전·갱신일에 영향 없음, 2026-10-29 사용자 결정 「마지막 결과만 저장」)
  searchLog: string[];
  focus: Record<string, string>; // 사용자별로 마지막에 보던 업무 ('all' 또는 업무 ID)
}

export type AiCheckKind = 'missing_action' | 'missing_due' | 'conflict' | 'stale' | 'missing_info' | 'risk';
export interface AiCheckFinding {
  kind: AiCheckKind;
  severity: 'high' | 'mid' | 'low';
  title: string;
  detail: string;
  quote: string;
  cite: Cite | null;
  recordLine: string | null;
}
/** 업무마다 마지막 AI 점검 1개. API 키·프롬프트 원문은 담지 않는다 */
export interface AiCheckRecord {
  at: string; // ISO
  byId: string; // 점검한 사람
  engine: 'claude';
  model: string;
  workVersion: number; // 점검할 때의 Work.version — 지금 값과 다르면 「점검 뒤 기록이 바뀜」
  docIds?: string[]; // 점검할 때 이 업무에 연결돼 있던 문서 ID(정렬). 지금 연결 문서가 다르면 「점검 뒤 기록이 바뀜」(없으면 버전만 비교)
  findings: AiCheckFinding[];
  dropped: number;
}

/** 지운 문서의 흔적: 같은 제목+작성일 문서는 합쳐 불러오기에서 들여오지 않는다. id는 인계 스냅샷에 남은 옛 참조를 알아보는 데 쓴다 */
export interface DeletedDoc {
  id: string;
  title: string;
  writtenAt: string;
  at: string;
}

/** 「나만 보기」 메모: 업무에 붙지만 쓴 사람만 본다. 업무 기록·인계·지도 파생에는 들어가지 않는다 */
export interface PrivateMemo {
  id: string;
  workId: string;
  userId: string;
  text: string;
  at: string;
}

/** 조직 단계. 위(회사)에서 아래(팀) 순서 */
export type OrgLevel = '회사' | '본부' | '부' | '팀';
export const ORG_LEVELS: OrgLevel[] = ['회사', '본부', '부', '팀'];

/**
 * 조직(2026-10-29 사용자 결정: 업무가 모여 팀, 팀이 모여 부, 부가 모여 본부, 회사 전체).
 * 업무·사람의 dept는 조직 이름(name)을 그대로 가리킨다 — 이름을 바꾸면 dept도 함께 바뀐다(lib/orgs.ts editOrg).
 */
export interface Org {
  id: string;
  name: string;
  level: OrgLevel;
  parentId: string | null;
}
