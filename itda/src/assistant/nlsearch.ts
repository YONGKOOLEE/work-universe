// 자연어 검색 — 질문 문장 → 「검색 조건」으로 해석 → 이 브라우저의 고객 데이터에서 검색 → 결과마다 근거 표시.
// 원본: ClientMemory app/nlsearch.py. 해석 방식 두 가지:
//  · 규칙 해석(기본): 자주 쓰는 질문 형태를 규칙으로 해석. 외부 전송 없음
//  · AI 해석(선택): Claude에 「질문 문장과 기준일」만 보내 검색 조건으로 바꾼다(고객 이름·정보는 보내지 않는다). 실제 검색은 늘 이 브라우저에서 한다
// 검색 결과는 저장된 데이터에서 찾은 것만 보여주며 AI가 고객정보를 만들어내지 않는다.
// CR-25 2.3-3으로 낱말을 보강했다: 「못 드시는·안 드시는·꺼리는·먹지 않는」 같은 피하는 음식 표현, 「이번 달에 챙겨야 할 사람」(기한 임박 요청·경조사·예정 연락).
import { S, type LlmClient } from '../ai/llm';
import { addDays, diffDays, isValidDate, monthRange, nextOccurrence, weekday, WEEKDAY_KO, ymd } from './dates';
import { maskText } from './claude';
import { sortStable } from './queries';
import { CUSTOMER_TYPES, FIELD_LABELS, type AssistantData, type CustRequest, type Customer, type CustomerFieldKey } from './types';

export type Scope = 'interest' | 'food_like' | 'food_dislike' | 'personality' | 'contact_pref' | 'org' | 'any';
export const KW_SCOPES: Record<Scope, CustomerFieldKey[]> = {
  interest: ['hobbies', 'recentInterests', 'salesNotes'],
  food_like: ['foodLikes'],
  food_dislike: ['foodDislikes'],
  personality: ['personality', 'contactPreference'],
  contact_pref: ['contactPreference'],
  org: ['company', 'department', 'position', 'duties', 'orgRelationship'],
  any: ['name', 'company', 'department', 'position', 'duties', 'hobbies', 'recentInterests', 'foodLikes', 'foodDislikes', 'personality', 'contactPreference', 'salesNotes', 'orgRelationship', 'relationshipOrigin'],
};
export const SCOPE_LABEL: Record<Scope, string> = { interest: '관심사', food_like: '선호 음식', food_dislike: '기피 음식', personality: '성향·연락 방식', contact_pref: '선호 연락 방식', org: '소속·업무', any: '전체' };

export interface Cond {
  target: 'customers' | 'requests';
  keywords: { text: string; scope: Scope }[];
  conversationKeywords: string[];
  orgKeywords: string[];
  customerTypes: string[];
  noContactDays: number | null;
  contactKind: 'contact' | 'meeting';
  birthdayFrom: string;
  birthdayTo: string;
  requestStatus: '' | 'open' | 'any';
  requestKeywords: string[];
  dueWithinDays: number | null;
  overdue: boolean;
  /** 「이번 달에 챙겨야 할 사람」: 이 기간(포함) 안에 기한이 닥친 요청·생일·기념일·예정 연락·예정 미팅이 있는 고객. 둘 다 있거나 둘 다 빈 글 */
  agendaFrom: string;
  agendaTo: string;
  /** 「이번 주에 만나는 사람」: 이 기간(포함) 안에 예정된 미팅이 있는 고객. 둘 다 있거나 둘 다 빈 글 */
  meetingFrom: string;
  meetingTo: string;
  /** 질문에 들어 있는 고객 이름(「오정석 생일 언제야」) — 이 이름의 고객만 */
  nameKeywords: string[];
  /** 이름으로 찾을 때 근거로 함께 보여 줄 정보: birthday(생일) · contact(연락처) */
  show: ('birthday' | 'contact')[];
}

export const emptyCond = (): Cond => ({
  target: 'customers', keywords: [], conversationKeywords: [], orgKeywords: [], customerTypes: [], noContactDays: null, contactKind: 'contact',
  birthdayFrom: '', birthdayTo: '', requestStatus: '', requestKeywords: [], dueWithinDays: null, overdue: false, agendaFrom: '', agendaTo: '',
  meetingFrom: '', meetingTo: '', nameKeywords: [], show: [],
});

// ───────────── 규칙 해석 ─────────────

const NUM_KO: Record<string, number> = { 한: 1, 두: 2, 세: 3, 석: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const PARTICLES = ['에서는', '으로는', '에게서', '한테서', '이라도', '에서', '으로', '에게', '한테', '께서', '까지', '부터', '처럼', '보다', '하고', '이랑', '랑', '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '로', '만', '님', '씨'];
const PARTICLES_BY_LEN = [...PARTICLES].sort((a, b) => b.length - a.length);
const STOP = new Set(['고객', '고객들', '고객님', '담당자', '담당', '사람', '분', '분들', '누구', '누구야', '누구지', '누가', '찾아줘', '찾아', '알려줘', '알려', '보여줘', '보여', '모두', '전부', '전체', '목록', '리스트', '좀', '혹시', '있는', '있어', '있나', '있을까', '어떤', '했던', '하는', '한', '인', '중', '최근', '요즘', '지난번', '지난번에', '예전에', '적', '것', '거', '뭐', '무엇', '어디', '해줘', '줘', '검색', '검색해줘', '명단', '정리해줘', '말해줘', '있었던', '관련', '관련된', '대해', '대한', '가진', '가지고']);
const ORG_WORDS = ['저축은행', '은행', '증권', '보험', '카드', '캐피탈', '학원', '학교', '재단', '병원', '요양원', '법인', '청', '시청', '구청'];
const TYPE_WORDS: [string, string][] = [['협력사', '협력사'], ['파트너', '협력사'], ['참가기관', '참가기관'], ['금융기관', '참가기관'], ['이용기관', '이용기관·가맹점'], ['가맹점', '이용기관·가맹점'], ['정부기관', '정부기관'], ['공공기관', '정부기관'], ['정부', '정부기관'], ['관공서', '정부기관']];
/** 「매운 음식 싫어하는」에서 핵심어는 「매운」이다 — 이런 군더더기 낱말은 건너뛴다(원본은 마지막 낱말 「음식」을 그대로 써서 「날음식」 고객까지 찾았다) */
const GENERIC_FOOD = new Set(['음식', '음식은', '음식을', '음식이', '것', '거', '걸', '게', '메뉴', '종류', '요리']);

/** 피하는 음식 표현: 싫어하는·꺼리는·기피하는·못(안) 먹는/드시는·먹지(드시지) 못하는/않는 */
const DISLIKE_VERB = '싫어하시는|싫어하는|싫어한|꺼리시는|꺼리는|꺼려하시는|꺼려하는|기피하시는|기피하는|(?:못|안)\\s*(?:먹는|드시는|드신|먹|드시)|(?:먹지|드시지)\\s*(?:못하시는|못하는|않으시는|않는)';
const DISLIKE_RE = new RegExp(`(.+?)\\s*(?:을|를|이|가)?\\s*(${DISLIKE_VERB})`);
/** 챙겨야 할 일을 묻는 표현 */
const AGENDA_RE = /(챙겨야|챙길|챙겨\s*줘야|신경\s*(?:써야|쓸)|연락해야|연락할|살펴봐야|확인해야)/;

export function stripParticle(w0: string): string {
  const w = w0.replace(/^[ ?？.!,'"]+|[ ?？.!,'"]+$/g, '');
  for (const p of PARTICLES_BY_LEN) if (w.endsWith(p) && w.length - p.length >= 2) return w.slice(0, -p.length);
  return w;
}
const num = (s: string): number | null => {
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t);
  return NUM_KO[t] ?? null;
};
const cleanPhrase = (p: string) => p.split(/\s+/).filter(Boolean).map(stripParticle).filter((w) => w && !STOP.has(w)).join(' ').trim();

/** 기간 표현(이번 달·이번 주·다음 달·다음 주·오늘·내일)에서 [시작, 끝]. 없으면 오늘부터 30일 */
function periodOf(text: string, today: string): [string, string] {
  const y = Number(today.slice(0, 4));
  const mth = Number(today.slice(5, 7));
  if (/다음\s*달/.test(text)) return monthRange(mth === 12 ? y + 1 : y, mth === 12 ? 1 : mth + 1);
  if (/이번\s*달/.test(text)) return [today, monthRange(y, mth)[1]];
  if (/다음\s*주/.test(text)) {
    const a = addDays(today, 7 - weekday(today));
    return [a, addDays(a, 6)];
  }
  if (/이번\s*주/.test(text)) return [today, addDays(today, 6 - weekday(today))];
  if (/내일/.test(text)) return [addDays(today, 1), addDays(today, 1)];
  if (/오늘/.test(text)) return [today, today];
  return [today, addDays(today, 30)];
}

/** 미팅 예정 기간: 이번 주 = 오늘부터 7일(오늘 화면의 「이번 주 미팅」과 같다), 다음 주 = 다음 월~일, 내일·오늘·이번 달·다음 달, 없으면 오늘부터 30일 */
function meetingPeriodOf(text: string, today: string): [string, string] {
  const y = Number(today.slice(0, 4));
  const mth = Number(today.slice(5, 7));
  if (/다음\s*달/.test(text)) return monthRange(mth === 12 ? y + 1 : y, mth === 12 ? 1 : mth + 1);
  if (/이번\s*달/.test(text)) return [today, monthRange(y, mth)[1]];
  if (/다음\s*주/.test(text)) {
    const a = addDays(today, 7 - weekday(today));
    return [a, addDays(a, 6)];
  }
  if (/이번\s*주/.test(text)) return [today, addDays(today, 7)];
  if (/내일/.test(text)) return [addDays(today, 1), addDays(today, 1)];
  if (/오늘/.test(text)) return [today, today];
  return [today, addDays(today, 30)];
}

/** 만나는 일정을 묻는 표현(「만나지 못한」「안 만난」 같은 미연락 표현은 아니다) */
const MEET_PLAN_RE = /(만나는|만날|만나기로|만나게|미팅\s*(?:이\s*)?(?:예정|있|잡혀|일정|약속)|예정(?:된|인)?\s*미팅|약속)/;
const NOT_MEET_PLAN_RE = /(만나지|못\s*만|안\s*만|만난\s*적|만나본)/;
/** 날짜·질문 군더더기 — 「이번 주에 만나는 사람 누구야」에서 이 낱말들을 조건으로 AND하면 늘 0건이 된다 */
const NOISE = new Set(['이번', '다음', '지난', '올해', '내년', '이달', '다음달', '이번달', '이번주', '다음주', '주에', '달에', '해에', '날에', '주', '달', '오늘', '내일', '언제', '며칠', '몇', '만나', '만나는', '만날', '만난', '만나서', '만나고', '미팅', '예정', '예정인', '약속', '일정', '내가', '우리', '나', '저', '제가', '어떻게', '어느', '누구', '누구야', '누구지', '누군지', '어디', '무엇', '뭐야', '뭔지', '알고', '싶어', '싶어요', '궁금해', '궁금해요', '확인', '확인해줘']);
/** 낱말 끝의 질문 어미(야·지·까·요 …)를 뗀 뿌리가 군더더기인가 */
function isNoise(w: string): boolean {
  if (NOISE.has(w) || STOP.has(w)) return true;
  const stem = w.replace(/(인가요|인가|이에요|예요|이야|나요|까요|일까|일까요|이죠|이지|야|지|까|죠|요)$/, '');
  return stem !== w && stem.length > 0 && (NOISE.has(stem) || STOP.has(stem));
}
/** 선호 연락 방식으로 볼 낱말 */
const CONTACT_WORDS = ['메신저', '이메일', '메일', '전화', '문자', '카톡', '카카오톡', '공문', '대면', '휴대전화', '유선'];
/** 이름 뒤에 올 수 있는 정보 낱말(「오정석 생일」「김도현 연락처」) */
const INFO_WORDS = '생일|생신|연락처|전화번호|전화|휴대폰|핸드폰|휴대전화|이메일|메일|주소|직책|부서|소속|회사|담당|업무';
const INFO_RE = new RegExp(`(?:^|\\s)([가-힣]{2,4}?)(?:이|가|의|은|는|씨|님|한테|에게)?\\s*(?:${INFO_WORDS})`);
/** 이름처럼 보이지만 이름이 아닌 낱말 */
const NOT_A_NAME = /^(이번|다음|지난|올해|내년|이달|오늘|내일|고객|담당|사람|그분|이분|우리|내|가장|최근|언제|어느|누구|회사|기관|협력|참가|정부|이용|가맹)/;

export function ruleParse(q: string, now: Date, names: readonly string[] = []): Cond {
  const today = ymd(now);
  const c = emptyCond();
  const text = q.replace(/？/g, '?').replace(/\s+/g, ' ').trim();
  const used: string[] = []; // 해석에 쓴 구절(일반 낱말 검색에서 제외)

  // 고객 이름: 등록된 이름이 질문에 그대로 있으면 이름 조건. 이름 목록이 없을 때만 「이름 + 생일·연락처 …」 꼴로 짐작한다
  const known = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((x, y) => y.length - x.length);
  for (const n of known) {
    if (text.includes(n) && !c.nameKeywords.some((k) => k.includes(n) || n.includes(k))) {
      c.nameKeywords.push(n);
      used.push(n);
    }
  }
  if (!known.length) {
    const im0 = INFO_RE.exec(text);
    if (im0 && !NOT_A_NAME.test(im0[1]) && !ORG_WORDS.some((w) => im0[1].includes(w)) && !TYPE_WORDS.some(([w]) => im0[1].includes(w))) {
      c.nameKeywords.push(im0[1]);
      used.push(im0[1]);
    }
  }
  if (c.nameKeywords.length) {
    if (/(연락처|전화번호|휴대폰|핸드폰|휴대전화|이메일 주소|메일 주소|번호)/.test(text)) c.show.push('contact');
    if (/(생일|생신)/.test(text) && !/(이번|다음)\s*(달|주)|\d{1,2}\s*월|다가오는|곧/.test(text)) c.show.push('birthday');
    used.push('연락처', '전화번호');
  }

  // 요청사항
  if (text.includes('요청')) {
    if (/(아직|미처리|처리\s*(하지|안|못)|못\s*한|안\s*된|남은|진행\s*중|밀린|처리되지)/.test(text)) c.requestStatus = 'open';
    if (/기한.{0,4}(지난|넘은|경과|지나)|연체/.test(text)) {
      c.requestStatus = 'open';
      c.overdue = true;
    }
    if (/임박|기한.{0,6}(가까|다가)|이번\s*주.{0,6}기한|기한.{0,6}이번\s*주/.test(text)) {
      c.requestStatus = 'open';
      c.dueWithinDays = 7;
    }
    const m = /([가-힣A-Za-z0-9·]+(?:\s[가-힣A-Za-z0-9·]+)?)\s*(?:을|를)\s*요청/.exec(text);
    if (m) {
      const kw = cleanPhrase(m[1]);
      if (kw && kw !== '요청사항' && kw !== '업무') {
        c.requestKeywords.push(kw);
        used.push(m[0]);
      }
    }
    const personWanted = /(고객|분|사람|담당자|담당|누구|회사|기관)/.test(text);
    if (/요청\s*사항|요청\s*건|요청\s*목록|요청들/.test(text) && !/요청(했던|한|하신)\s*(고객|분|사람|담당)/.test(text)) c.target = 'requests';
    // 「기한 지난 요청」처럼 사람을 묻지 않는 요청 질문은 「기한이 지난 요청사항」과 같은 요청 목록으로 본다
    else if ((c.overdue || c.dueWithinDays) && !personWanted) c.target = 'requests';
    else if (!c.requestStatus && !c.requestKeywords.length) c.requestStatus = 'any';
    used.push('요청');
  }

  // 장기 미연락
  const mm = /(\d+|한|두|세|석|네|다섯|여섯|일곱|여덟|아홉|열)\s*(개월|달|주|일|년)/.exec(text);
  if (/(만나지|못\s*만난|안\s*만난|못\s*본|연락(하지|을?\s*안|이?\s*없|\s*못)|소식이?\s*없|뜸한|오래)/.test(text)) {
    let days = 60;
    if (mm && num(mm[1])) {
      days = { 개월: 30, 달: 30, 주: 7, 일: 1, 년: 365 }[mm[2] as '개월']! * num(mm[1])!;
      used.push(mm[0]);
    }
    c.noContactDays = days;
    c.contactKind = /만나|못\s*본|미팅/.test(text) ? 'meeting' : 'contact';
    used.push('만나지', '연락', '오래');
  }

  // 생일 (이름이 있고 기간 말이 없으면 「그 사람의 생일」을 근거로 보여 주는 것이므로 기간 조건을 만들지 않는다)
  if (text.includes('생일') && !(c.nameKeywords.length && c.show.includes('birthday'))) {
    const y = Number(today.slice(0, 4));
    const mth = Number(today.slice(5, 7));
    let a: string;
    let b: string;
    if (text.includes('다음 달') || text.includes('다음달')) [a, b] = monthRange(mth === 12 ? y + 1 : y, mth === 12 ? 1 : mth + 1);
    else if (text.includes('이번 달') || text.includes('이번달')) [a, b] = monthRange(y, mth);
    else if (text.includes('다음 주') || text.includes('다음주')) {
      a = addDays(today, 7 - weekday(today));
      b = addDays(a, 6);
    } else if (text.includes('이번 주') || text.includes('이번주')) {
      a = addDays(today, -weekday(today));
      b = addDays(a, 6);
    } else if (/(\d{1,2})\s*월/.test(text)) {
      const mo = Number(/(\d{1,2})\s*월/.exec(text)![1]);
      if (mo >= 1 && mo <= 12) [a, b] = monthRange(mo >= mth ? y : y + 1, mo);
      else [a, b] = [today, addDays(today, 30)];
    } else [a, b] = [today, addDays(today, 30)];
    c.birthdayFrom = a;
    c.birthdayTo = b;
    used.push('생일');
  }

  // 고객 유형·소속
  for (const [w, t] of TYPE_WORDS) {
    if (text.includes(w) && !c.customerTypes.includes(t)) {
      c.customerTypes.push(t);
      used.push(w);
    }
  }
  for (const w of ORG_WORDS) {
    if (new RegExp(`${w}(?![가-힣]*요청)`).test(text) && !c.orgKeywords.some((u) => u.includes(w))) {
      if (w === '은행' && c.orgKeywords.includes('저축은행')) continue;
      if (w.length === 1 && !new RegExp(`[가-힣]+${w}(\\s|$|의|에|은|는)`).test(text)) continue;
      // 「요청」「신청」「초청」의 끝 글자 「청」을 기관(○○청)으로 읽지 않는다
      if (w === '청' && !(text.match(/[가-힣]+청(?=\s|$|의|에|은|는)/g) ?? []).some((t) => t.length >= 3 && !/(요청|신청|초청|호청)$/.test(t))) continue;
      if (c.nameKeywords.some((n) => n.includes(w))) continue; // 이름 속 글자는 기관 이름이 아니다
      c.orgKeywords.push(w);
      used.push(w);
    }
  }

  // 관심사·음식
  const dm = DISLIKE_RE.exec(text);
  if (dm) {
    const ws = dm[1].trim().split(/\s+/);
    let kw = '';
    for (let i = ws.length - 1; i >= 0; i--) {
      const w = cleanPhrase(ws[i]);
      if (w && !GENERIC_FOOD.has(w)) {
        kw = w;
        break;
      }
    }
    if (kw) {
      c.keywords.push({ text: kw, scope: 'food_dislike' });
      used.push(dm[0]);
    }
  }
  const im = /([가-힣A-Za-z0-9·]+(?:\s[가-힣A-Za-z0-9·]+){0,3}?)\s*(?:에|에\s*대해|에\s*대한)?\s*관심/.exec(text);
  if (im) {
    const kw = cleanPhrase(im[1]);
    if (kw) {
      c.keywords.push({ text: kw, scope: 'interest' });
      c.conversationKeywords.push(kw);
      used.push(im[0]);
    }
  }
  const lm = /([가-힣A-Za-z0-9·]+)\s*(?:을|를|이|가)?\s*(좋아하는|좋아한|즐기는|좋아하시는|취미인|치는|하는\s*걸\s*좋아)/.exec(text);
  if (lm && !c.keywords.some((k) => k.scope === 'interest')) {
    const kw = cleanPhrase(lm[1]);
    if (kw) {
      const food = /(음식|식|요리|고기|회|면|탕|밥|술|커피|차)$/.test(kw);
      c.keywords.push({ text: kw, scope: food ? 'food_like' : 'interest' });
      used.push(lm[0]);
    }
  }

  // 선호 연락 방식: 「메신저 선호하는 사람」「이메일 연락 선호」「선호 연락 방식이 전화인 사람」
  if (/선호/.test(text) && !/(음식|메뉴)/.test(text)) {
    const cm = /([가-힣A-Za-z]+?)(?:을|를|으로|로)?\s*(?:연락(?:\s*방식)?\s*)?(?:을|를)?\s*선호/.exec(text) ?? /선호\s*(?:하는)?\s*연락\s*방식(?:이|은|으로)?\s*([가-힣A-Za-z]+)/.exec(text);
    const w = cm ? cleanPhrase(cm[1]) : '';
    if (w && CONTACT_WORDS.some((k) => w.includes(k))) {
      c.keywords.push({ text: w === '이메일' ? '메일' : w, scope: 'contact_pref' });
      used.push(cm![0]);
    }
  }

  // 만날 사람(예정된 미팅): 「이번 주에 만나는 사람」「다음 주에 만날 사람」「이번 주 미팅 예정 고객」
  if (MEET_PLAN_RE.test(text) && !NOT_MEET_PLAN_RE.test(text) && !c.noContactDays) {
    [c.meetingFrom, c.meetingTo] = meetingPeriodOf(text, today);
    used.push('만나는', '만날', '만나게', '미팅', '예정');
  }

  // 챙겨야 할 사람(기한 임박 요청·경조사·예정 연락)
  if (AGENDA_RE.test(text)) {
    [c.agendaFrom, c.agendaTo] = periodOf(text, today);
    used.push('챙겨야', '챙길', '이번', '달에', '내가');
  }

  // 해석된 조건이 없으면: 낱말 검색(모든 고객정보 + 대화기록)
  const has = c.keywords.length || c.orgKeywords.length || c.customerTypes.length || c.noContactDays || c.birthdayFrom || c.requestStatus || c.requestKeywords.length || c.agendaFrom || c.meetingFrom || c.nameKeywords.length;
  if (!has) {
    let rest = text;
    for (const u of used) rest = rest.split(u).join(' ');
    for (const w0 of rest.split(/\s+/).filter(Boolean)) {
      const w = stripParticle(w0);
      // 군더더기 낱말(이번·주에·언제야 …)을 조건으로 AND하면 늘 0건이 되므로 건너뛴다
      if (w.length >= 2 && !isNoise(w) && !/^(찾|알려|보여|있|하|했|되)/.test(w)) {
        c.keywords.push({ text: w, scope: 'any' });
        c.conversationKeywords.push(w);
      }
    }
  }
  return normalizeCond(c, now);
}

// ───────────── AI 해석(질문 문장·기준일만 전송) ─────────────

export const SEARCH_SYSTEM = `당신은 영업사원용 고객관리 프로그램의 검색 도우미입니다. 사용자의 질문 문장을 검색 조건 JSON으로만 바꿉니다.
- 질문에 없는 조건을 추가하지 않습니다. 고객 이름이나 정보를 추측해 만들지 않습니다.
- keywords.text는 짧은 핵심어로 씁니다. ('골프 좋아하는' → text='골프', scope='interest', '해산물 못 드시는' → text='해산물', scope='food_dislike')
- '은행 담당자'처럼 소속을 말하면 orgKeywords에 넣습니다.
- 'N개월 동안 만나지 못한' → noContactDays=N*30, contactKind='meeting' / '연락 안 한' → contactKind='contact'
- 날짜 표현은 기준일을 이용해 YYYY-MM-DD로 바꿉니다.
- '요청사항을 보여줘'처럼 요청 목록을 원하면 target='requests', '요청했던 고객'처럼 사람을 원하면 target='customers'
- '이번 달에 챙겨야 할 사람'처럼 기한 임박 요청·경조사·예정 연락을 묻는 질문은 agendaFrom/agendaTo에 그 기간(YYYY-MM-DD)을 넣습니다.
- '이번 주에 만나는 사람'처럼 예정된 미팅을 묻는 질문은 meetingFrom/meetingTo에 그 기간(YYYY-MM-DD)을 넣습니다.
- 질문에 고객 이름이 있으면 nameKeywords에 이름만 넣습니다. 이름이 없으면 비웁니다.
- 값이 없는 칸은 빈 글('')·빈 목록·null·false로 둡니다.`;

const intOrNull = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
export const SEARCH_SCHEMA = S.obj({
  target: S.enumOf(['customers', 'requests']),
  keywords: S.arr(S.obj({ text: S.str, scope: S.enumOf(Object.keys(KW_SCOPES)) })),
  conversationKeywords: S.arr(S.str),
  orgKeywords: S.arr(S.str),
  customerTypes: S.arr(S.enumOf([...CUSTOMER_TYPES])),
  noContactDays: intOrNull,
  contactKind: S.enumOf(['contact', 'meeting']),
  birthdayFrom: S.str,
  birthdayTo: S.str,
  requestStatus: S.enumOf(['', 'open', 'any']),
  requestKeywords: S.arr(S.str),
  dueWithinDays: intOrNull,
  overdue: S.bool,
  agendaFrom: S.str,
  agendaTo: S.str,
  meetingFrom: S.str,
  meetingTo: S.str,
  nameKeywords: S.arr(S.str),
});

/**
 * Claude에 보내는 사용자 글 — 기준일과 질문 문장뿐이다(고객 정보는 한 글자도 넣지 않는다).
 * 질문에 사용자가 전화번호·이메일·주민등록번호·계좌번호를 적었어도 대화 분석과 같은 규칙(maskText)으로 가려서 보낸다.
 */
export function aiQuestionPrompt(q: string, now: Date): string {
  const t = ymd(now);
  return `기준일(오늘): ${t} (${WEEKDAY_KO[weekday(t)]}요일)\n질문: ${maskText(q)[0]}`;
}

export async function aiParse(client: LlmClient, q: string, now: Date, signal?: AbortSignal): Promise<Cond> {
  const raw = await client.json<Partial<Cond>>({ system: SEARCH_SYSTEM, user: aiQuestionPrompt(q, now), schema: SEARCH_SCHEMA, limit: 'queryParse' }, signal);
  const c = emptyCond();
  for (const k of Object.keys(c) as (keyof Cond)[]) if (raw && k in raw) (c as unknown as Record<string, unknown>)[k] = raw[k];
  return normalizeCond(c, now);
}

const clip = (v: unknown, n = 40) => String(v ?? '').trim().slice(0, n);
/** 규칙·AI 해석 결과를 안전한 형태로 정리 */
export function normalizeCond(c: Partial<Cond>, now: Date): Cond {
  const today = ymd(now);
  const out = emptyCond();
  out.target = c.target === 'requests' ? 'requests' : 'customers';
  out.keywords = (Array.isArray(c.keywords) ? c.keywords : [])
    .filter((k) => k && typeof k === 'object' && clip(k.text))
    .map((k) => ({ text: clip(k.text), scope: (k.scope && k.scope in KW_SCOPES ? k.scope : 'any') as Scope }))
    .slice(0, 6);
  for (const key of ['conversationKeywords', 'orgKeywords', 'requestKeywords'] as const) {
    out[key] = (Array.isArray(c[key]) ? c[key]! : []).map((x) => clip(x)).filter(Boolean).slice(0, 6);
  }
  out.customerTypes = (Array.isArray(c.customerTypes) ? c.customerTypes : []).filter((t) => (CUSTOMER_TYPES as readonly string[]).includes(t));
  if (c.noContactDays !== null && c.noContactDays !== undefined && (c.noContactDays as unknown) !== '') {
    const n = Math.trunc(Number(c.noContactDays));
    out.noContactDays = n && n >= 1 && n <= 3650 ? n : null;
  }
  out.contactKind = c.contactKind === 'meeting' ? 'meeting' : 'contact';
  for (const k of ['birthdayFrom', 'birthdayTo', 'agendaFrom', 'agendaTo', 'meetingFrom', 'meetingTo'] as const) {
    const v = clip(c[k], 10);
    out[k] = isValidDate(v) ? v : '';
  }
  if (!!out.birthdayFrom !== !!out.birthdayTo) {
    out.birthdayTo = out.birthdayTo || addDays(out.birthdayFrom, 30);
    out.birthdayFrom = out.birthdayFrom || today;
  }
  if (!!out.agendaFrom !== !!out.agendaTo) {
    out.agendaTo = out.agendaTo || addDays(out.agendaFrom, 30);
    out.agendaFrom = out.agendaFrom || today;
  }
  if (out.agendaFrom > out.agendaTo) [out.agendaFrom, out.agendaTo] = [out.agendaTo, out.agendaFrom];
  if (!!out.meetingFrom !== !!out.meetingTo) {
    out.meetingTo = out.meetingTo || addDays(out.meetingFrom, 30);
    out.meetingFrom = out.meetingFrom || today;
  }
  if (out.meetingFrom > out.meetingTo) [out.meetingFrom, out.meetingTo] = [out.meetingTo, out.meetingFrom];
  out.nameKeywords = (Array.isArray(c.nameKeywords) ? c.nameKeywords : []).map((x) => clip(x, 20)).filter(Boolean).slice(0, 3);
  out.show = (Array.isArray(c.show) ? c.show : []).filter((x, i, arr): x is 'birthday' | 'contact' => (x === 'birthday' || x === 'contact') && arr.indexOf(x) === i);
  out.requestStatus = c.requestStatus === 'open' || c.requestStatus === 'any' ? c.requestStatus : '';
  if (c.dueWithinDays !== null && c.dueWithinDays !== undefined && (c.dueWithinDays as unknown) !== '') {
    const n = Math.trunc(Number(c.dueWithinDays));
    out.dueWithinDays = n && n >= 0 && n <= 365 ? n : null; // 0은 「조건 없음」으로 본다(원본과 같음)
  }
  out.overdue = !!c.overdue;
  if ((out.overdue || out.dueWithinDays) && !out.requestStatus) out.requestStatus = 'open';
  return out;
}

const md = (iso: string) => iso.slice(5).replace('-', '/');
/** 해석된 조건을 사람이 읽는 문장으로(화면 상단에 보여, 질문과 다르게 해석됐는지 확인하게 한다) */
export function describeCond(c: Cond): string[] {
  const out: string[] = [];
  if (c.target === 'requests') out.push('요청사항 목록');
  if (c.nameKeywords.length) out.push('이름이 ' + c.nameKeywords.map((x) => `'${x}'`).join(' 또는 ') + '인 고객');
  for (const k of c.keywords) out.push(`${SCOPE_LABEL[k.scope]}에 '${k.text}'`);
  if (c.conversationKeywords.length) out.push('대화기록 포함: ' + c.conversationKeywords.map((x) => `'${x}'`).join(', '));
  if (c.orgKeywords.length) out.push('소속에 ' + c.orgKeywords.map((x) => `'${x}'`).join(' 또는 '));
  if (c.customerTypes.length) out.push('고객 유형: ' + c.customerTypes.join(', '));
  if (c.noContactDays) out.push(`${c.noContactDays}일 이상 ${c.contactKind === 'meeting' ? '미팅' : '연락'} 없음`);
  if (c.birthdayFrom) out.push(`생일 ${md(c.birthdayFrom)}~${md(c.birthdayTo)}`);
  if (c.meetingFrom) out.push(`${md(c.meetingFrom)}~${md(c.meetingTo)} 예정 미팅`);
  if (c.agendaFrom) out.push(`${md(c.agendaFrom)}~${md(c.agendaTo)} 챙길 일: 기한 임박 요청·경조사·예정 연락`);
  if (c.requestStatus === 'open') out.push('미처리 요청' + (c.overdue ? ' (기한 경과)' : c.dueWithinDays ? ` (기한 ${c.dueWithinDays}일 이내)` : ''));
  else if (c.requestStatus === 'any' && c.target === 'customers') out.push('요청 이력 있음');
  if (c.requestKeywords.length) out.push('요청 내용에 ' + c.requestKeywords.map((x) => `'${x}'`).join(', '));
  return out.length ? out : ['조건 없음 — 전체'];
}

// ───────────── 검색 실행(이 브라우저의 데이터) ─────────────

function match(text: string | undefined, kw: string): boolean {
  const t = (text || '').toLowerCase();
  const k = kw.toLowerCase().trim();
  if (!k || !t) return false;
  if (t.includes(k)) return true;
  const parts = k.split(/\s+/).filter((p) => p.length >= 2);
  return parts.length >= 2 && parts.every((p) => t.includes(p));
}
function snip(text: string, kw: string, n = 60): string {
  const t = (text || '').replace(/\n/g, ' ');
  const first = (kw || '').toLowerCase().split(/\s+/).filter(Boolean)[0];
  const i = first ? t.toLowerCase().indexOf(first) : -1;
  if (i < 0 || t.length <= n) return t.slice(0, n) + (t.length > n ? '…' : '');
  const a = Math.max(0, i - Math.floor(n / 3));
  return (a ? '…' : '') + t.slice(a, a + n) + (a + n < t.length ? '…' : '');
}

export interface Evidence {
  label: string;
  text: string;
  kw?: string;
  link?: { to: 'customer-history' | 'customer-requests' | 'customer-events'; customerId: string };
}
export interface SearchCustomer {
  id: string;
  name: string;
  company: string;
  department: string;
  position: string;
  customerType: string;
  updatedAt: string;
  isDemo: boolean;
  evidence: Evidence[];
}
export interface SearchRequest extends CustRequest {
  name: string;
  company: string;
  position: string;
  dDay: number | null;
}
export interface SearchResult {
  target: 'customers' | 'requests';
  customers: SearchCustomer[];
  requests: SearchRequest[];
  count: number;
}

const dday = (n: number) => (n === 0 ? '오늘' : `D-${n}`);

export function executeSearch(a: AssistantData, c: Cond, now: Date): SearchResult {
  const today = ymd(now);
  const customers = sortStable(a.customers, (x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  const inters = new Map<string, typeof a.interactions>();
  for (const i of sortStable(a.interactions, (x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))) {
    if (!inters.has(i.customerId)) inters.set(i.customerId, []);
    inters.get(i.customerId)!.push(i);
  }
  const reqs = new Map<string, CustRequest[]>();
  for (const r of sortStable(a.requests, (x, y) => ((x.dueDate || '9999') < (y.dueDate || '9999') ? -1 : (x.dueDate || '9999') > (y.dueDate || '9999') ? 1 : 0))) {
    if (!reqs.has(r.customerId)) reqs.set(r.customerId, []);
    reqs.get(r.customerId)!.push(r);
  }
  const anns = new Map<string, typeof a.anniversaries>();
  for (const x of a.anniversaries) {
    if (!anns.has(x.customerId)) anns.set(x.customerId, []);
    anns.get(x.customerId)!.push(x);
  }

  const reqOk = (r: CustRequest) => {
    if (c.requestStatus === 'open' && r.status === '완료') return false;
    if (c.overdue && !(r.dueDate && r.dueDate < today)) return false;
    if (c.dueWithinDays !== null) {
      const lim = addDays(today, c.dueWithinDays);
      if (!(r.dueDate && r.dueDate <= lim)) return false;
    }
    return c.requestKeywords.every((k) => match(`${r.content} ${r.result || ''}`, k));
  };

  const results: { c: SearchCustomer; sort: string }[] = [];
  const reqResults: SearchRequest[] = [];
  const asReq = (r: CustRequest, cu: Customer): SearchRequest => ({ ...r, name: cu.name, company: cu.company, position: cu.position, dDay: null });

  for (const cu of customers) {
    const ev: Evidence[] = [];
    if (c.nameKeywords.length) {
      if (!c.nameKeywords.some((n) => match(cu.name, n))) continue;
      ev.push({ label: '이름', text: cu.name });
      if (c.show.includes('birthday')) {
        const nb = cu.birthDate ? nextOccurrence(cu.birthDate, today) : null;
        ev.push({ label: '생일', text: nb ? `${Number(nb.slice(5, 7))}월 ${Number(nb.slice(8, 10))}일${nb === today ? ' (오늘)' : ` (${dday(diffDays(today, nb))})`}` : '생일 정보 없음', link: { to: 'customer-events', customerId: cu.id } });
      }
      if (c.show.includes('contact')) {
        ev.push({ label: '휴대전화', text: cu.mobile || '미입력' });
        ev.push({ label: '이메일', text: cu.email || '미입력' });
        if (cu.officePhone) ev.push({ label: '사무실 전화', text: cu.officePhone });
      }
    }
    if (c.customerTypes.length && !c.customerTypes.includes(cu.customerType || '기타')) continue;
    if (c.customerTypes.length) ev.push({ label: '고객 유형', text: cu.customerType });
    if (c.orgKeywords.length) {
      const hit = c.orgKeywords.find((k) => match(cu.company, k) || match(cu.department, k));
      if (!hit) continue;
      ev.push({ label: '소속', text: `${cu.company} ${cu.department || ''}`.trim() });
    }
    let sortKey = cu.name;
    let ok = true;
    for (const k of c.keywords) {
      const f = KW_SCOPES[k.scope].find((fld) => match(cu[fld], k.text));
      if (f) {
        ev.push({ label: FIELD_LABELS[f] ?? f, text: snip(cu[f], k.text), kw: k.text });
        continue;
      }
      // 관심사·전체 검색은 대화기록·요청사항에서 찾은 것도 근거로 인정
      if (k.scope === 'interest' || k.scope === 'any') {
        const it = (inters.get(cu.id) ?? []).find((i) => match(`${i.title} ${i.summary} ${i.details}`, k.text));
        if (it) {
          ev.push({ label: `${it.type} 기록 ${it.date}`, text: snip(`${it.title} — ${it.summary} ${it.details}`, k.text), kw: k.text, link: { to: 'customer-history', customerId: cu.id } });
          continue;
        }
        const rq = (reqs.get(cu.id) ?? []).find((r) => match(r.content, k.text));
        if (rq && k.scope === 'any') {
          ev.push({ label: `요청사항 ${rq.receivedDate}`, text: snip(rq.content, k.text), kw: k.text, link: { to: 'customer-requests', customerId: cu.id } });
          continue;
        }
      }
      ok = false;
      break;
    }
    if (!ok) continue;
    for (const k of c.conversationKeywords) {
      if (ev.some((e) => e.kw === k)) continue;
      const it = (inters.get(cu.id) ?? []).find((i) => match(`${i.title} ${i.summary} ${i.details}`, k));
      if (it) ev.push({ label: `${it.type} 기록 ${it.date}`, text: snip(`${it.title} — ${it.summary}`, k), kw: k, link: { to: 'customer-history', customerId: cu.id } });
    }
    if (c.noContactDays) {
      const ref = c.contactKind === 'meeting' ? cu.lastMeetingDate : cu.lastContactDate;
      const label = c.contactKind === 'meeting' ? '최근 미팅' : '최근 연락';
      if (ref && isValidDate(ref)) {
        const gap = diffDays(ref, today);
        if (gap < c.noContactDays) continue;
        sortKey = String(99999 - gap).padStart(5, '0');
        ev.push({ label, text: `${ref} (${gap}일 전)` });
      } else {
        ev.push({ label, text: '기록 없음' });
        sortKey = '00000';
      }
    }
    if (c.birthdayFrom) {
      const nb = cu.birthDate ? nextOccurrence(cu.birthDate, today) : null;
      if (!nb || !(c.birthdayFrom <= nb && nb <= c.birthdayTo)) continue;
      ev.push({ label: '생일', text: nb !== today ? `${Number(nb.slice(5, 7))}월 ${Number(nb.slice(8, 10))}일 (D-${diffDays(today, nb)})` : '오늘' });
      sortKey = nb;
    }
    if (c.meetingFrom) {
      // 예정된 미팅(오늘 이후)이 기간 안에 있는 고객
      const ms = (inters.get(cu.id) ?? []).filter((m) => m.type === '미팅' && m.date >= today && m.date >= c.meetingFrom && m.date <= c.meetingTo);
      if (!ms.length) continue;
      const sorted = sortStable(ms, (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.time < y.time ? -1 : x.time > y.time ? 1 : 0));
      for (const m of sorted.slice(0, 2)) ev.push({ label: '예정 미팅', text: `${m.date} ${m.time || ''} ${m.title}`.replace(/ {2}/g, ' '), link: { to: 'customer-history', customerId: cu.id } });
      sortKey = sorted[0].date;
    }
    if (c.agendaFrom) {
      const found: { when: string; e: Evidence }[] = [];
      for (const r of reqs.get(cu.id) ?? []) {
        // 기한이 기간 끝까지 닥친 미처리 요청(이미 지난 것 포함, 보류는 제외 — 오늘 화면과 같은 규칙)
        if (r.status === '완료' || r.status === '보류' || !r.dueDate || !isValidDate(r.dueDate) || r.dueDate > c.agendaTo) continue;
        const n = diffDays(today, r.dueDate);
        found.push({ when: r.dueDate, e: { label: `요청사항 (${r.status})`, text: `${snip(r.content, '')} · 기한 ${r.dueDate}${n < 0 ? ' (기한 경과)' : ''}`, link: { to: 'customer-requests', customerId: cu.id } } });
      }
      const bn = cu.birthDate ? nextOccurrence(cu.birthDate, today) : null;
      if (bn && bn >= c.agendaFrom && bn <= c.agendaTo) found.push({ when: bn, e: { label: '생일', text: `${Number(bn.slice(5, 7))}월 ${Number(bn.slice(8, 10))}일 (${dday(diffDays(today, bn))})`, link: { to: 'customer-events', customerId: cu.id } } });
      for (const an of anns.get(cu.id) ?? []) {
        const n = an.repeatYearly ? nextOccurrence(an.date, today) : isValidDate(an.date) ? an.date : null;
        if (n && n >= c.agendaFrom && n <= c.agendaTo) found.push({ when: n, e: { label: `경조사 (${an.label || an.kind})`, text: `${Number(n.slice(5, 7))}월 ${Number(n.slice(8, 10))}일 (${dday(diffDays(today, n))})`, link: { to: 'customer-events', customerId: cu.id } } });
      }
      if (cu.nextContactDate && isValidDate(cu.nextContactDate) && cu.nextContactDate <= c.agendaTo) {
        found.push({ when: cu.nextContactDate, e: { label: '예정 연락', text: `${cu.nextContactDate}${cu.nextContactDate < today ? ' (예정일 지남)' : ''}` } });
      }
      for (const m of inters.get(cu.id) ?? []) {
        if (m.type === '미팅' && m.date >= today && m.date >= c.agendaFrom && m.date <= c.agendaTo) found.push({ when: m.date, e: { label: '예정 미팅', text: `${m.date} ${m.time || ''} ${m.title}`.replace(/ {2}/g, ' '), link: { to: 'customer-history', customerId: cu.id } } });
      }
      if (!found.length) continue;
      found.sort((x, y) => (x.when < y.when ? -1 : x.when > y.when ? 1 : 0));
      ev.push(...found.map((f) => f.e));
      sortKey = found[0].when;
    }
    if (c.requestStatus || c.requestKeywords.length) {
      const mr = (reqs.get(cu.id) ?? []).filter(reqOk);
      if (!mr.length) continue;
      for (const r of mr) reqResults.push(asReq(r, cu));
      for (const r of mr.slice(0, 2)) {
        ev.push({ label: `요청사항 (${r.status})`, text: snip(r.content, c.requestKeywords[0] ?? '') + (r.dueDate ? ` · 기한 ${r.dueDate}` : ''), link: { to: 'customer-requests', customerId: cu.id } });
      }
    }
    results.push({ c: { id: cu.id, name: cu.name, company: cu.company, department: cu.department, position: cu.position, customerType: cu.customerType, updatedAt: cu.updatedAt, isDemo: cu.isDemo, evidence: ev }, sort: sortKey });
  }

  if (c.target === 'requests') {
    if (!(c.requestStatus || c.requestKeywords.length)) {
      // 「요청사항 보여줘」만 있는 경우 등
      for (const cu of customers) for (const r of reqs.get(cu.id) ?? []) if (reqOk(r) && results.some((x) => x.c.id === cu.id)) reqResults.push(asReq(r, cu));
    }
    for (const r of reqResults) r.dDay = r.dueDate && isValidDate(r.dueDate) ? diffDays(today, r.dueDate) : null;
    const sorted = sortStable(reqResults, (x, y) => Number(x.status === '완료') - Number(y.status === '완료') || ((x.dueDate || '9999') < (y.dueDate || '9999') ? -1 : (x.dueDate || '9999') > (y.dueDate || '9999') ? 1 : 0));
    return { target: 'requests', customers: [], requests: sorted, count: sorted.length };
  }
  const sorted = sortStable(results, (x, y) => (x.sort < y.sort ? -1 : x.sort > y.sort ? 1 : 0)).map((x) => x.c);
  return { target: 'customers', customers: sorted, requests: [], count: sorted.length };
}

export interface SearchOutcome extends SearchResult {
  q: string;
  /** 어떤 방식으로 해석했는가 — 화면에 「규칙」「AI」로 구분 표시한다 */
  mode: 'rule' | 'ai';
  /** AI 해석을 시도했다가 실패해 규칙으로 바꾼 이유(없으면 '') */
  aiError: string;
  conditions: Cond;
  explain: string[];
  /** 결과가 비는 까닭을 알리는 글(예: 고객이 한 명도 없을 때). 없으면 '' */
  note: string;
}

export const NO_CUSTOMERS_NOTE = '등록된 고객이 없습니다';

/** 질문 하나를 검색한다. client가 있으면 AI 해석을 먼저 시도하고, 실패하면 규칙 해석으로 대체한다 */
export async function searchQuestion(a: AssistantData, q0: string, now: Date, opts: { client?: LlmClient | null; errorText?: (e: unknown) => string; signal?: AbortSignal } = {}): Promise<SearchOutcome | { error: string }> {
  const q = q0.trim();
  if (!q) return { error: '검색할 문장을 입력해 주세요.' };
  if (q.length > 200) return { error: '질문이 너무 깁니다. (200자 이내)' };
  let mode: 'rule' | 'ai' = 'rule';
  let aiError = '';
  let cond: Cond | null = null;
  if (opts.client) {
    try {
      cond = await aiParse(opts.client, q, now, opts.signal);
      mode = 'ai';
    } catch (e) {
      aiError = opts.errorText ? opts.errorText(e) : 'AI 해석에 실패했습니다.';
    }
  }
  if (!cond) cond = ruleParse(q, now, a.customers.map((x) => x.name));
  const res = executeSearch(a, cond, now);
  return { q, mode, aiError, conditions: cond, explain: describeCond(cond), note: a.customers.length === 0 ? NO_CUSTOMERS_NOTE : '', ...res };
}
