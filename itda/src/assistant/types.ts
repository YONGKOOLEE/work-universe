// AI 비서(고객 메모) 데이터 모델 — ClientMemory v0.4.0(SQLite 9표)을 업무잇다 AppState.assistant 한 칸으로 옮긴 것(CR-25 4.2).
// 날짜는 'YYYY-MM-DD', 시각은 'YYYY-MM-DD HH:MM:SS'(현지 시각 글자). 사진·명함 이미지 칸은 없다(저장소 5MB 보호).
// 대화 원문·분석 초안은 여기에 두지 않는다(화면 메모리에만, 사용자가 「원문 보관」을 고른 때만 활동 상세에 들어간다).

export const CUSTOMER_TYPES = ['협력사', '참가기관', '이용기관·가맹점', '정부기관', '기타'] as const;
export const INTERACTION_TYPES = ['미팅', '통화', '이메일', '메모', '기타'] as const;
export const REQUEST_STATUSES = ['미착수', '진행 중', '완료', '보류'] as const;
export const ANNIVERSARY_KINDS = ['생일', '결혼기념일', '자녀 생일', '자녀 수능일', '기타 기념일', '중요 일정'] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type AnniversaryKind = (typeof ANNIVERSARY_KINDS)[number];

/** 고객 24개 항목(원본 db.CUSTOMER_FIELDS와 같은 순서·이름 뜻) */
export interface CustomerFields {
  name: string;
  birthDate: string;
  mobile: string;
  email: string;
  officePhone: string;
  company: string;
  department: string;
  position: string;
  duties: string;
  customerType: string;
  companyAddress: string;
  firstMetDate: string;
  relationshipOrigin: string;
  personality: string;
  foodLikes: string;
  foodDislikes: string;
  hobbies: string;
  recentInterests: string;
  contactPreference: string;
  salesNotes: string;
  lastContactDate: string;
  lastMeetingDate: string;
  nextContactDate: string;
  orgRelationship: string;
}
export type CustomerFieldKey = keyof CustomerFields;

export interface FieldDef {
  key: CustomerFieldKey;
  label: string;
  /** basic=기본 인적사항, personal=개인적 특성, relation=고객과의 관계 */
  group: 'basic' | 'personal' | 'relation';
  input: 'text' | 'date' | 'tel' | 'email' | 'select' | 'textarea';
}
export const CUSTOMER_FIELDS: FieldDef[] = [
  { key: 'name', label: '이름', group: 'basic', input: 'text' },
  { key: 'birthDate', label: '생년월일', group: 'basic', input: 'date' },
  { key: 'mobile', label: '휴대전화', group: 'basic', input: 'tel' },
  { key: 'email', label: '이메일', group: 'basic', input: 'email' },
  { key: 'officePhone', label: '사무실 전화', group: 'basic', input: 'tel' },
  { key: 'company', label: '소속 회사·기관', group: 'basic', input: 'text' },
  { key: 'department', label: '부서', group: 'basic', input: 'text' },
  { key: 'position', label: '직책', group: 'basic', input: 'text' },
  { key: 'duties', label: '담당 업무', group: 'basic', input: 'text' },
  { key: 'customerType', label: '고객 유형', group: 'basic', input: 'select' },
  { key: 'companyAddress', label: '회사 주소', group: 'basic', input: 'text' },
  { key: 'firstMetDate', label: '최초 만남 일자', group: 'basic', input: 'date' },
  { key: 'relationshipOrigin', label: '관계 형성 경위', group: 'basic', input: 'textarea' },
  { key: 'personality', label: '성격·대화 스타일', group: 'personal', input: 'textarea' },
  { key: 'foodLikes', label: '선호 음식', group: 'personal', input: 'text' },
  { key: 'foodDislikes', label: '기피 음식', group: 'personal', input: 'text' },
  { key: 'hobbies', label: '취미·관심사', group: 'personal', input: 'text' },
  { key: 'recentInterests', label: '최근 관심 주제', group: 'personal', input: 'text' },
  { key: 'contactPreference', label: '선호 연락 방식', group: 'personal', input: 'text' },
  { key: 'salesNotes', label: '영업 시 참고사항', group: 'personal', input: 'textarea' },
  { key: 'lastContactDate', label: '최근 연락일', group: 'relation', input: 'date' },
  { key: 'lastMeetingDate', label: '최근 미팅일', group: 'relation', input: 'date' },
  { key: 'nextContactDate', label: '다음 연락·미팅 예정일', group: 'relation', input: 'date' },
  { key: 'orgRelationship', label: '소속기관과의 업무 관계', group: 'relation', input: 'textarea' },
];
export const FIELD_KEYS: CustomerFieldKey[] = CUSTOMER_FIELDS.map((f) => f.key);
export const FIELD_LABELS = Object.fromEntries(CUSTOMER_FIELDS.map((f) => [f.key, f.label])) as Record<CustomerFieldKey, string>;
/** 날짜 형식이어야 하는 고객 항목 */
export const DATE_FIELDS: CustomerFieldKey[] = ['birthDate', 'firstMetDate', 'lastContactDate', 'lastMeetingDate', 'nextContactDate'];

export interface Customer extends CustomerFields {
  id: string;
  /** 이 고객의 담당 영업자(AppState.users의 ID). 고치는 권한의 기준 */
  ownerId: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ChangeSource = 'manual' | 'demo' | 'activity' | 'restore' | 'card' | 'ai' | 'sample' | 'followup';
export const SOURCE_LABELS: Record<ChangeSource, string> = {
  manual: '직접 입력',
  demo: '데모 데이터',
  activity: '활동기록 자동 반영',
  restore: '이전 값 복원',
  card: '명함 인식',
  ai: 'AI 분석',
  sample: '예시 분석(AI 미사용)',
  followup: '미팅 후 질문',
};

export interface Interaction {
  id: string;
  customerId: string;
  type: string;
  date: string;
  time: string;
  endTime: string;
  title: string;
  summary: string;
  details: string;
  source: string;
  sourceFile: string;
  isDemo: boolean;
  createdAt: string;
}

export interface CustRequest {
  id: string;
  customerId: string;
  content: string;
  receivedDate: string;
  dueDate: string;
  status: string;
  assignee: string;
  interactionId: string | null;
  result: string;
  source: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Anniversary {
  id: string;
  customerId: string;
  kind: string;
  label: string;
  date: string;
  repeatYearly: boolean;
  /** 알림 시점(며칠 전, 쉼표로 구분) 예: '7,2,0' */
  remindDays: string;
  notes: string;
  isDemo: boolean;
  createdAt: string;
}

/** 고객 항목 변경 이력(변경 전·후 값과 출처). 복원의 근거 */
export interface ChangeEntry {
  id: string;
  customerId: string;
  field: string;
  oldValue: string;
  newValue: string;
  source: string;
  note: string;
  changedAt: string;
}

/** 미팅 후 질문의 미팅별 상태 */
export interface FollowupState {
  interactionId: string;
  status: 'pending' | 'done' | 'skipped';
  answers: Record<string, Record<string, string>>;
  asked: string[];
  updatedAt: string;
}

/** 알림·미팅 후 질문 설정(원본 notify.DEFAULTS에서 Windows 알림 항목만 뺐다) */
export interface AssistantConf {
  /** 날짜 기준 알림 시각 'HH:MM' */
  notifyTime: string;
  /** 요청 기한 n일 전(쉼표) */
  reqRemind: string;
  /** 생일 n일 전(쉼표) */
  bdayRemind: string;
  meetDaybefore: boolean;
  meetHourbefore: boolean;
  /** 미팅 종료 1시간 뒤 맞춤형 질문 */
  fuEnable: boolean;
  /** 종료 시간이 없는 미팅의 기본 소요시간(분) */
  fuDuration: number;
  /** 시작 시간도 없는 미팅의 질문 시각 'HH:MM' */
  fuNotime: string;
}
export const DEFAULT_CONF: AssistantConf = {
  notifyTime: '09:00',
  reqRemind: '7,2,0',
  bdayRemind: '7,2,0',
  meetDaybefore: true,
  meetHourbefore: true,
  fuEnable: true,
  fuDuration: 60,
  fuNotime: '18:00',
};

export interface AssistantData {
  customers: Customer[];
  interactions: Interaction[];
  requests: CustRequest[];
  anniversaries: Anniversary[];
  changes: ChangeEntry[];
  followups: FollowupState[];
  /** 읽음 표시한 알림의 고유 키(알림 자체는 저장하지 않고 그때그때 계산한다) */
  noticeRead: string[];
  conf: AssistantConf;
}
