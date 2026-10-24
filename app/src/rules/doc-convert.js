// 문서 → 유니버스 문서(12.2) 규칙 기반 초벌 변환(T-17, CR-5 ②: 사용자 확정 2026-10-03).
// 업무정의서 같은 문서의 제목(#)·표·번호 목록·글머리표를 읽어 노드·연결·메모로 옮긴다. 결과는 "초벌"이라
// 가져오기 미리 보기에서 사람이 확인한 뒤에만 저장한다(12.9 흐름). LLM 변환(CR-3 B)은 llm/connector.js의 같은 자리로 들어온다.
// 순수 함수: 브라우저 기능을 쓰지 않는다.
//
// 세분화(사용자 결정 2026-10-03 "월말 정산 수준"): 업무당 노드 10~20개. 그래서
//   - 업무 흐름의 단계는 노드로 만들지 않고 대표 업무의 '절차' 속성(①②…)에 적는다(월말 정산 U-A1과 같은 방식)
//   - 요건·예외·보안 같은 절은 절마다 주제 노드 하나로 만들고, 항목은 설명에 줄마다 적는다
//   - 이해관계자의 기관(A사, 카드사 등)은 조직 노드를 만들지 않고 역할 노드의 '소속' 속성에 적는다
//   - 미확정 질문·리스크는 메모 이력(원문 번호를 내용 앞에)으로 둔다
// 지어내지 않기: 모든 노드에 원문 근거(attrs.원문 = 절 번호)를 두고, 원문에 없는 사번은 만들지 않는다.
// 담당(수행) 연결은 원문이 역할의 하는 일로 업무 이름을 적은 경우만 만든다(D3-21 나, 사용자 결정 2026-10-03).
// 「주 담당」 같은 담당 절의 키로 잇는 것은 CONVERT_RULES.cr17j.assignPerforms(CR-17 J 승인안에서 켬)가 켜졌을 때만.
// [가정]·[미확인] 표시는 글자 그대로 남기고, 해당 노드의 attrs.상태에도 적는다(CR-3 AC ④).

import { newId } from '../model/commands.js';
import { ID_PREFIX, LABEL_MAX, SCHEMA_VERSION, SUBTYPE_ROLE, TEXT_MAX, normalizeLabel } from '../model/schema.js';
import { josa } from '../model/josa.js';

/** 변환 규칙의 값. 바꾸기 쉽게 한 곳에 둔다(CLAUDE.md 연속 진행 모드) */
export const CONVERT_RULES = {
  version: 'v1',
  nodeTarget: { min: 10, max: 20 }, // 월말 정산 수준(사용자 결정 2026-10-03). 벗어나면 미리 보기에서 알린다
  workLabelMax: 40, // 범위가 없어 문서 이름으로 만든 업무의 이름이 이보다 길면 앞부분만 이름으로, 전체는 설명으로(검토9 C-1)
  artifactLabelMax: 40, // 산출물 이름이 이보다 길면 앞부분만 이름으로, 전체는 설명으로
  roleLabelMax: 40, // 역할 절의 줄이 이보다 길면(「키: 값」이 아니면) 사람 이름이 아니라 문장으로 본다(F23-4)
  maxInput: 200000, // 붙여 넣을 수 있는 글자 수
  // 스위치 cr17j.relatedDocLink가 켜졌을 때만 쓴다: 「관련 문서」 절의 문서를 대표 업무에 잇는 연결 종류(업무가 하나뿐인 문서만).
  // 만든 문서인지 참고한 문서인지 원문에 없으므로 「참조」(지어내지 않기, 메인 결정 2026-10-24). produces로 바꾸면 인수인계 초안의 「산출물·문서 위치」가
  // 읽지만 「원문이 만든다고 말한 것」이 아닌 문서까지 산출로 보이게 된다. 초안이 「참조」도 읽게 하는 것은 CR-17 J ②(승인 필요)
  relatedDocEdge: 'references',
  // CR-17 J 스위치 묶음. 승인안 기본값: assignPerforms·namedPersonPlain·relatedDocLink·pathToLocation·authorPickOrg(범위 한정)·authorDate·previewRenameWork 켬,
  // summaryToWork·periodDeadline 끔(authorPickOrg는 R13-6을 고친 뒤 2026-10-24 승인에 따라 켬; 전부 끄면 승인된 02-design 12.9.1 v1·12.9.2 D-P3·D-P6 그대로).
  // convertDocument의 ctx.cr17j로 한 번 호출만 덮어쓸 수 있다(시험·비교용).
  cr17j: {
    assignPerforms: true, // 담당 절의 「주 담당·담당·정」 사람 → 문서의 업무가 하나뿐일 때 업무 performs(+ 알림 C-PERFORMS-GUESS·C-ASSIGN-SKIPPED). 끄면 연결 없음(D-P3)
    namedPersonPlain: true, // 담당 절에서 이름 모양(한글 2~4자)인 사람을 하위 유형 「역할」 없는 사람으로. 끄면 모두 「역할」(12.9.1 v1: 이해관계자는 역할)
    relatedDocLink: true, // 「관련 문서」 절의 산출물 → 대표 업무 relatedDocEdge 연결(업무 하나짜리 문서). 끄면 꼭지 contains(v1: 산출물은 꼭지가 담음)
    pathToLocation: true, // 산출물 이름 뒤 괄호가 경로 모양이면 설명 대신 속성 「위치」로. 끄면 괄호는 설명(v1: 괄호는 설명)
    authorPickOrg: true, // 키가 「작성」·「작성 부서」인 줄은 조직 낱말(…팀·…부·…실·…본부·…센터·…파트·…그룹)로 끝나는 덩어리까지만 작성 주체로(없으면 입력받기), 한 줄에 키가 여럿이면 「작성 부서」 칸만. 「작성자」·「작성 주체」는 값 그대로. 끄면 모두 값 그대로이고 그냥 「작성:」은 작성 주체로 읽지 않음(D-P6: 변경 없음, R12-2)
    authorDate: true, // 「작성(자/부서/주체):」 값 속의 날짜를 작성일로 읽음. 끄면 작성일은 따로 적힌 날짜만
    summaryToWork: false, // 업무 하나짜리 문서에서 개요 첫 문장 → 대표 업무 설명
    periodDeadline: false, // 업무 하나짜리 문서에서 개요·절차 문장 속 주기·마감 구절 → 대표 업무 속성 「주기」「마감」(문장에서 낱말 고르기 — 12.9의 「개요의 주기·마감 항목」 밖)
    previewRenameWork: true, // (ui/import.js가 읽음) 가져오기 미리 보기에서 지도 이름을 고치면 업무 하나짜리 문서의 대표 업무 이름도 따라 바꿈. 끄면 지도 이름·작성 주체만 바뀜(12.9.1 미리 보기 확인 대상)
  },
};

// 「관련 문서」「참고 자료」「첨부 서류」와 「관련·참고 문서」「관련/참고 자료」처럼 두 낱말을 붙인 제목(W8). 제목 전체가 이 말일 때만: 「문서 관리 규정」「관련 법령」은 아니다
const RELATED_DOC_TITLE = /^(?:(?:관련|참고|참조|첨부) ?(?:[·/,]| 및 |와|과) ?)?(?:관련|참고|참조|첨부) ?(?:문서|자료|서류)(?: ?목록)?$/;

// 절 제목 → 무엇으로 바꿀지. 앞에 있는 것이 먼저다. 괄호 안 글자는 보지 않는다("비기능 요건 (…협의로 확정)")
const SECTION_KINDS = [
  ['artifacts', /산출물|결과물|제출물|양식|서식/],
  ['artifacts', RELATED_DOC_TITLE, 'w8'],
  ['memos', /미확정|미결|질문|확정할|확인할|확인 ?필요|리스크|위험|이슈|문제점/],
  ['steps', /흐름|절차|프로세스|처리 ?순서|진행 ?순서/],
  ['people', /이해관계자|관계자|역할|담당자|연락처/],
  ['cautions', /주의사항|유의사항|유의 ?점|주의 ?점/],
  // 「범위 외」·「제외 사항」도 범위 제외(검토5 V-3 가). 제목 전체가 맞을 때만: 「장비 범위」·「수수료 제외 기준」·「대상 외부 기관 연계」는 아니다(재검증 1)
  ['scope_out', /^((업무 ?)?범위 ?(제외|외|밖)( ?(사항|항목|업무))?|제외 ?(범위|사항|대상|업무|항목)( ?업무)?|제외|비 ?범위|(적용 ?)?대상 ?외)$/],
  ['scope', /범위|대상 ?업무|업무 ?목록|하위 ?업무/],
  ['overview', /개요|요약|기본 ?정보|업무 ?정보/],
  // 「참여 주체」「참여 기관」(F23-4). 제목 전체가 이 말일 때만, 개요·범위보다 뒤: 「정보주체의 권리」「주체적 대응」「처리 주체별 책임」「참여자 교육」은 아니다(재검증 R2)
  ['people', /^((참여|업무|관련) ?)?주체$|^참여 ?(기관|자)$/],
  // 「담당」「주 담당」「담당 및 검토」「담당자/검토자」(W8). 제목 전체가 이 말일 때만: 「담당 업무」「담당 범위」는 아니다
  ['people', /^(주 ?)?담당(자)? ?(([및/·,]|과|와) ?(검토|승인|협조)(자)?)?$/, 'w8'],
];
// W8 전(승인된 12.9.1 v1)의 절 분류. 세 번째 값 'w8'이 붙은 규칙(W8에서 더한 제목 낱말)을 뺀 것. 그 절의 내용을 W8 이후 규칙으로 읽을지(s.viaW8) 가르는 데 쓴다(R12-1)
const SECTION_KINDS_V1 = SECTION_KINDS.filter((r) => r[2] !== 'w8');
// 「관련 문서」류 절. 그 절 자신의 제목만 본다. 이 절의 산출물은 기본으로 꼭지가 담고, 스위치 cr17j.relatedDocLink가 켜졌을 때만
// 업무가 하나뿐인 문서에서 대표 업무에 CONVERT_RULES.relatedDocEdge(references)로 잇는다(R12-6: 「대표 업무가 낸다」고 읽지 않는다)
// 문서 종류 접두어(W8): 「업무정의서: 이름」「업무 정의서 - 이름」「[업무정의서] 이름」. 구분 기호나 괄호가 있을 때만 뗀다
const DOC_KIND = '(?:업무 ?정의서|업무 ?기술서|업무 ?설명서|업무 ?매뉴얼|업무 ?지침서)';
const DOC_PREFIX = new RegExp(`^\\s*(?:[\\[【(（]\\s*${DOC_KIND}\\s*[\\]】)）]\\s*[:：\\-–—]?|${DOC_KIND}\\s*[:：\\-–—])\\s*`);
/** 제목에서 문서 종류 접두어를 뗀 업무 이름. 뗀 뒤 이름이 없으면 그대로 */
export function stripDocPrefix(title) {
  const t = String(title || '');
  const rest = t.replace(DOC_PREFIX, '').trim();
  return rest && /\p{L}/u.test(rest) ? rest : t.trim();
}
/** 업무 이름이 없어 문서 제목으로 만든 업무의 이름(접두어를 떼고, 40자 넘으면 줄임). 가져오기 미리 보기가 이름 변경을 따라가는 데도 쓴다 */
export function docWorkLabel(title) {
  const base = stripDocPrefix(title);
  return base.length > CONVERT_RULES.workLabelMax ? `${base.slice(0, CONVERT_RULES.workLabelMax - 1)}…` : base;
}

// 작성 주체 줄에서 조직 낱말을 고른다(W8). 「가상재무팀 류다온 / 2026-09-01」 → 가상재무팀, 날짜는 따로
const ORG_WORD = /(팀|부서|본부|센터|파트|그룹|실|부|처)$/;
const NOT_ORG_WORD = /^(외부|내부|일부|전부|상부|하부|세부|실제|실무|총무|부|실|팀|처)$/;
// strict: 조직 낱말로 끝나는 덩어리가 없으면 작성 주체 없음(null) — 값 그대로 쓰지 않는다(CR-17 J ⑤: 키가 「작성」·「작성 부서」일 때)
export function authorOf(value, { strict = false } = {}) {
  const date = findDate(value);
  const rest = String(value).replace(DATE_SPAN, ' ').replace(/(^|\s)(작성|작성일|작성일자)(\s|$)/g, ' ').replace(/^[\s/,·|:：-]+|[\s/,·|:：-]+$/g, '');
  // 괄호 꼬리(「(초안)」「(류다온)」)는 조직 판정에서 뺀다
  const judged = rest.replace(/\([^)]*\)|（[^）]*）/g, ' ');
  // 「/」「,」「·」「|」로 나뉜 덩어리마다 보고, 조직 낱말이 든 첫 덩어리에서 그 낱말까지를 작성 주체로 한다(「류다온 / 가상정산팀」은 사람 덩어리를 건너뜀)
  for (const group of judged.split(/\s*[/,·|]\s*/)) {
    const tokens = group.split(/\s+/).filter(Boolean);
    const at = tokens.findIndex((t) => t.length >= 3 && ORG_WORD.test(t) && !NOT_ORG_WORD.test(t));
    // 「가상 재무팀」처럼 조직 이름이 두 낱말이면 앞 낱말까지(최대 3낱말), 아니면 조직 낱말 하나
    if (at >= 0) return { owner: at <= 2 ? tokens.slice(0, at + 1).join(' ') : tokens[at], date };
  }
  return { owner: strict ? null : rest || null, date };
}
// 한 줄에 키가 여럿인 작성 줄(「작성자: 류다온 / 작성 부서: 가상팀」)을 칸으로 나눈다. 첫 칸은 줄의 키, 나머지는 구분 기호 뒤에 「키:」가 이어지는 곳부터
const CELL_SPLIT = /\s*[/|·,，]\s*(?=[^:：/|·,，[\]]{1,12}[:：])/;
export function authorCells(key, value) {
  const [first, ...more] = String(value).split(CELL_SPLIT);
  const cells = [{ key: String(key).replace(/\s/g, ''), text: first }];
  for (const c of more) {
    const m = /^([^:：]{1,12})[:：]\s*(.*)$/.exec(c);
    cells.push(m ? { key: m[1].replace(/\s/g, ''), text: m[2] } : { key: '', text: c });
  }
  return cells;
}
/**
 * CR-17 J ⑤: 작성 줄에서 작성 주체를 조직 낱말로 고른다. 적용 범위는 키가 「작성」·「작성 부서」일 때만(「작성자」·「작성 주체」는 값 그대로 — 이 함수를 거치지 않는다).
 * 칸이 여럿이면 「작성 부서」 칸의 값만 쓴다. 조직 낱말로 끝나는 덩어리가 없으면 null(입력받음).
 * 「작성자」 키의 줄이어도 같은 줄에 「작성 부서」 칸이 있으면 그 칸을 쓴다(없으면 null이 아니라 호출한 쪽이 값 그대로 쓴다 → undefined)
 */
export function orgOwnerOf(key, value) {
  const cells = authorCells(key, value);
  const dept = cells.find((c) => c.key === '작성부서');
  const own = cells[0].key;
  if (dept) return authorOf(dept.text, { strict: true }).owner;
  if (own === '작성' || own === '작성부서') return authorOf(cells[0].text, { strict: true }).owner;
  return undefined;
}

// 개요 문장에서 분명한 주기·마감 구절을 원문 그대로 고른다(W8). 확실하지 않으면 null(지어내지 않기)
const PERIOD_PATTERNS = [
  /(?:매년|매해)(?:\s?\d{1,2}월(?:\s?(?:초|중순|말))?)?/,
  /매월(?:\s?(?:초|중순|말|\d{1,2}일))?/,
  /매\s?분기(?:\s?(?:초|말))?|분기\s?마다/,
  /매\s?반기(?:\s?(?:초|말))?|반기\s?마다/,
  /매주(?:\s?[월화수목금토일]요일)?|매일|(?:주|월|연)\s?\d{1,2}회/,
];
const DEADLINE_PATTERNS = [
  /\d{1,2}월\s?\d{1,2}일\s?(?:까지|이내|전까지)/g,
  /(?:익월|매월|매달|다음\s?달)?\s?(?:\d{1,2}일|말일|월말)\s?(?:까지|이내|전까지)/g,
  /\d{1,3}\s?영업일\s?(?:이내|전까지|까지)/g,
  /(?:익|다음)\s?영업일\s?(?:까지|이내|전까지)/g,
  /\d{1,3}\s?(?:일|주|개월)\s?이내/g,
];
const oneSpace = (s) => s.replace(/\s+/g, ' ').trim();
/** 글에서 가장 먼저 나오는 주기 구절(「매년 8월」「매월 말」「분기마다」). 없으면 null */
export function periodIn(text) {
  const s = String(text || '');
  let best = null;
  for (const re of PERIOD_PATTERNS) {
    const m = re.exec(s);
    if (m && (!best || m.index < best.index)) best = { index: m.index, text: oneSpace(m[0]) };
  }
  return best ? best.text : null;
}
/** 여러 글에서 마감 구절(「8월 31일까지」「5영업일 이내」)을 모은다. 서로 다른 구절이 둘 이상이면 어느 것이 업무의 마감인지 알 수 없어 null */
export function deadlineIn(texts) {
  const found = new Set();
  for (const text of texts) {
    const s = String(text || '');
    const hits = [];
    for (const re of DEADLINE_PATTERNS) for (const m of s.matchAll(re)) hits.push({ a: m.index + (m[0].length - m[0].trimStart().length), b: m.index + m[0].length, t: oneSpace(m[0]) });
    // 다른 구절 안에 들어 있는 구절(「8월 31일까지」 안의 「31일까지」)은 버린다
    for (const h of hits) if (!hits.some((o) => o !== h && o.a <= h.a && o.b >= h.b && (o.a < h.a || o.b > h.b))) found.add(h.t);
  }
  return found.size === 1 ? [...found][0] : null;
}
/** 글의 첫 문장(마침표·물음표·느낌표 뒤 공백에서 끊음). 마침표가 없으면 전체 */
export const firstSentence = (text) => {
  const s = oneSpace(String(text || ''));
  const m = /^.*?[.!?。](?=\s|$)/.exec(s);
  return m ? m[0] : s;
};
// 산출물 이름 뒤 괄호가 설명이 아니라 보관 위치로 보이는 경우(경로 기호 > \ 주소·드라이브 글자·a/b/c 꼴·보관처 낱말)
const PLACE_LIKE = /\s>\s|[›»\\]|https?:\/\/|^[A-Za-z]:|\S\/\S+\/\S|^\/|드라이브|폴더|서버|경로|문서함/;
export const looksLikePlace = (s) => PLACE_LIKE.test(String(s));

// 담당 절의 「주 담당: 이름 / 검토: 이름」 꼴(W8). 키 앞은 줄 처음이거나 구분 기호여야 한다(「교부: …」의 부는 키가 아니다)
const ASSIGN_KEYS = '(?:주|정|부)? ?담당자?|정|부|검토자?|승인자?|협조자?|확인자?';
const ASSIGN_RE = new RegExp(`(^|[\\s/,;，、])(${ASSIGN_KEYS})\\s*[:：]\\s*`, 'g');
// 업무를 직접 맡는다고 읽는 키(주 담당·담당·정). 검토·부·협조·승인은 사람 노드만 만들고 업무에 잇지 않는다(D-P3·D3-33 기준 안)
const ASSIGN_STRONG = /^(주 ?담당자?|정 ?담당자?|담당자?|정)$/;
const NAME_LIKE = /^[가-힣]{2,4}$/;
const ROLE_WORD = /(담당|담당자|팀|역할|대리|사원|직원|고객|수강생|총무|대표|임원|이사|감사|매니저|장|자|사)$/; // model/import.js의 실명 판정과 같은 낱말
// 담당 절 값이 사람·역할 이름으로 쓸 만한지 볼 때의 역할 낱말(ROLE_WORD보다 넓다: 조직·직급 낱말 포함). 「외부」「총괄」 같은 한 낱말은 아니다(R11-2)
// 이름 모양(한글 2~4자)이지만 사람도 역할도 아닌 흔한 낱말(「담당: 외부」「담당: 총괄」). 이런 한 낱말은 사람 노드로 만들지 않는다
const NOT_PERSON_WORD = /^(외부|내부|총괄|전체|전원|전부|모두|공통|기타|해당|관련|각자|각각|미정|미확인|없음|별도|협의|일반|공용|담당|주관|검토|승인|협조|확인|참고|참조)$/;
const ASSIGNEE_ROLE_WORD = /(담당|담당자|팀|부서|본부|센터|파트|그룹|실|부|처|역할|대리|사원|직원|과장|차장|부장|주임|계장|책임자|관리자|운영자|리더|고객|수강생|총무|대표|임원|이사|감사|매니저|장|자|사|원|관|직|위)$/;
/** 사람 이름 모양(한글 2~4자, 역할 낱말로 끝나지 않음) */
export const looksLikePersonName = (s) => {
  const t = stripParens(stripMarks(String(s))).trim();
  return NAME_LIKE.test(t) && !ROLE_WORD.test(t);
};
// 문장 꼴(사람·역할·산출물 이름이 아닌 것)인지. 공백 없는 한글 2~4자는 「…다」로 끝나도 이름일 수 있다(「이다」「유다」「최다」「김보다」, R12-4):
// 3자 이상은 동사 끝(…한다·…된다·…있다·…이다 등)일 때만 문장. 「…함·…됨」도 같다(「이수함」은 이름, 「처리함」「진행함」은 문장).
// 마침표·물음표·느낌표로 끝나거나, 공백이 있는 줄이 …다·…함·…음·…됨으로 끝나면 문장
const VERB_END = /(한다|된다|있다|없다|하다|는다|린다|낸다|친다|이다)$/;
const VERBAL_STEM = /(처리|확인|검토|승인|수행|진행|관리|운영|접수|보고|작성|제출|발송|전달|공유|협의|조정|정리|등록|점검|지원|제공|수령|입력|계산|대사|정산|결재|통보|요청|배포|취합|수집|검증|분석|이관|변경|취소|확정|반영|보관|폐기|대응|조치|완료|담당)$/;
export function isAssigneeSentence(name) {
  const t = stripMarks(String(name)).trim();
  if (/[.?!]$/.test(t)) return true;
  const bare = /^[가-힣]{2,4}$/.test(t);
  if (/다$/.test(t)) return !bare || (t.length >= 3 && VERB_END.test(t));
  if (/\s/.test(t) && /[함음됨]$/.test(t)) return true;
  if (/^[가-힣]{2,}[함됨]$/.test(t)) return !bare || VERBAL_STEM.test(t.slice(0, -1));
  return false;
}
/** 「관련 문서」 절의 줄이 문서 이름이 아니라 문장인지(isAssigneeSentence). 「…모음」「…묶음」은 문서 이름으로 본다 */
// 「보관함」「결재함」처럼 상자 이름(…함)은 문서·보관 장소 이름이다(3차 재검증 R13-4)
export const isDocSentence = (t) => !/[모묶]음$/.test(String(t).trim()) && !/(보관|결재|접수|수신|발신|우편|사서|문서)함$/.test(String(t).trim()) && isAssigneeSentence(t);
/**
 * 담당 절 줄의 값이 사람·역할 이름으로 읽을 만한지(R11-2). 문장(isAssigneeSentence),
 * 공백 3개 초과, 40자 초과는 이름이 아니다. 한글 한 낱말이면 이름 모양이거나 역할 낱말로 끝나야 한다(「외부」「총괄」은 아니다).
 * 공백 없는 한글 5자는 복성(선우·남궁·황보·제갈·사공·독고·동방·서문·을지·어금 등)으로 시작하고 역할 낱말로 끝나지 않을 때만 이름 후보(「선우하늘이」, R12-4). 「월말정산업무」 같은 5자 명사구는 이름이 아니다(지어내지 않기, 메인 2026-10-24)
 */
export function looksLikeAssignee(name) {
  const t = stripMarks(String(name)).trim();
  if (!hasName(t)) return false;
  if (t.length > CONVERT_RULES.roleLabelMax || (t.match(/\s/g) || []).length > 3) return false;
  if (isAssigneeSentence(t)) return false;
  const core = stripParens(t).trim();
  if (/^[가-힣]+$/.test(core)) return !NOT_ORG.test(core) && !NOT_PERSON_WORD.test(core) && (looksLikePersonName(core) || ASSIGNEE_ROLE_WORD.test(core) || (/^(선우|남궁|황보|제갈|사공|독고|동방|서문|을지|어금)[가-힣]{3}$/.test(core) && !ROLE_WORD.test(core)));
  return true;
}
/**
 * 「주 담당: 류다온 / 검토: 가상재무팀장」 → {ok:[{key, name}], rejected:[{key, name}]}. 값 하나씩 이름으로 읽히는지 본다(R12-4: 한 값이 거부돼도 줄 안 다른 이름은 살린다).
 * 줄 처음이 담당 절의 키가 아니면 null
 */
export function assignmentParts(text) {
  const s = String(text);
  const marks = [...s.matchAll(ASSIGN_RE)];
  if (!marks.length || marks[0].index + marks[0][1].length !== 0) return null;
  const ok = [];
  const rejected = [];
  marks.forEach((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : s.length;
    for (const name of splitList(s.slice(from, to).replace(/[\s/,;，、]+$/, ''))) (looksLikeAssignee(name) ? ok : rejected).push({ key: m[2], name });
  });
  return { ok, rejected };
}
/** 「주 담당: 류다온 / 검토: 가상재무팀장」 → [{key, name}]. 이름으로 읽히는 값이 하나도 없으면 null(거부된 값은 assignmentParts로) */
export function assignmentsOf(text) {
  const p = assignmentParts(text);
  return p && p.ok.length ? p.ok : null;
}
// 주제 노드의 하위 유형(절 제목으로 고른다). 없으면 하위 유형 없이 둔다
const TOPIC_SUBTYPES = [['예외', /예외|장애|오류/], ['보안', /보안|개인정보|암호/], ['비기능', /비기능|성능|가용성/], ['요건', /요건|요구|규칙|기준|정책/]];

// 개요 표·"키: 값" 줄의 키 → 쓰임
const OVERVIEW_KEYS = [
  ['name', /^(업무명|업무 ?이름|이름|제목)$/],
  ['purpose', /^(목적|업무 ?개요|개요|설명)$/],
  ['background', /^배경$/],
  ['scope_out', /^(범위 ?제외|제외 ?범위|제외|범위 ?외|범위 ?밖)$/],
  ['scope', /^(범위|업무 ?범위|대상 ?업무|주요 ?업무)$/],
  ['people', /^(이해관계자|관계자|담당자|역할|담당)$/], // 「담당: 이름」도 사람으로(검토5 V-9: 목적에 섞이지 않게)
  ['date', /^(작성일|작성 ?일자|일자|날짜|기준일)$/],
  ['owner', /^(작성 ?주체|작성자|작성 ?부서|작성|주관|주관 ?부서|담당 ?부서|담당 ?팀)$/],
  ['work_attr', /^(주기|마감|사용 ?시스템|주의사항)$/], // 02-design 5.6 업무 속성 약속 → 대표 업무 속성
];
// 범위 절의 ※ 줄이 범위 제외를 말하는 꼴(「…다루지 않음」「…제외」「…별도 업무정의서」「…범위 밖」)
const SCOPE_OUT_NOTE = /다루지 않|제외|별도|범위 ?(밖|외)|포함하지 않|대상이 아|해당 없/;
const ORG_HINT = /(사|팀|부|처|실|센터|기관|은행|공단|VAN)$|\//; // 소속으로 볼 앞 낱말(A사, 당사, 카드사/VAN, …팀)
const NOT_ORG = /^(외부|내부|일부|전부|본부|상부|하부|세부|실제|실무)$/; // '부'·'실'로 끝나지만 기관이 아닌 낱말(검토5 V-10)
const ROLE_SUFFIX = /^(담당|담당자|팀|부서|책임자|역할)$/;
const MARK = /\[(가정|미확인)[^\]]*\]/;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

// ── 문서 읽기 ───────────────────────────────────────────────────────────

// 문서 안 링크(목차의 [제목](#앵커), 주소 링크)와 표 칸에 섞인 HTML 태그(<br> 등). [가정: …](…)처럼 괄호 안이 주소가 아니면 링크로 보지 않는다(F23-4)
// 주소 안 괄호 한 겹까지(…/a_(b)). 링크 글이 [가정]·[미확인] 표시면 표시를 지키려고 바꾸지 않는다(재검증 R8)
const MD_LINK = /\[([^\]]+)\]\((?:#|https?:\/\/|\.{0,2}\/)(?:[^()\s]|\([^()\s]*\))*\)/g;
const keepMarkLink = (m, text) => (/^(가정|미확인)/.test(text) ? m : text);
// 태그 이름 뒤에는 속성 문법(영문 이름[=값])만 온다: 「a<b 이고 c>d」「<p 95> 미만」은 태그가 아니다(재검증 R7)
const HTML_TAG = /<\/?(?:br|p|div|span|table|thead|tbody|tfoot|tr|td|th|b|i|u|strong|em|sup|sub|font|center)(?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/gi;

/** 굵게·기울임·코드 표시, 링크 표시, HTML 태그를 걷어 내고 공백을 한 칸으로 */
export function cleanText(s) {
  return String(s)
    .replace(MD_LINK, keepMarkLink)
    .replace(HTML_TAG, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const splitRow = (line) => {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => cleanText(c));
};
const isSeparatorRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

/**
 * 마크다운 비슷한 글을 절로 나눈다. 제목 없는 글은 머리말(preamble)에 모두 들어간다.
 * 마크다운 표시(# 제목, | 표)가 없는 글(한글·워드에서 복사한 글)은 "일반 글 방식"으로 읽는다(N-1, 2026-10-03):
 *   첫 줄 = 문서 제목, "1. 개요"·"4.1 예외"·"가. 범위"·"■ 개요"·"【개요】"처럼 짧고 문장이 아닌 줄 = 절 제목,
 *   □ ○ ● ▪ ※ 등 = 글머리표, 1) (1) ① 가. = 번호 목록, 탭으로 나뉜 줄 = 표
 * @returns {{title:string|null, preamble:object[], sections:{level:number, num:string|null, title:string, heading:string, blocks:object[], parent:object|null}[], plain:boolean}}
 */
export function parseDocument(text) {
  const src = String(text).replace(/\r\n?/g, '\n');
  // # 제목이 없으면 일반 글 방식(| 표가 섞여 있어도 제목 규칙을 쓴다). [ \t]: 줄바꿈을 넘지 않게(긴 빈 줄에서 느려지지 않게)
  const plain = !/^[ \t]{0,3}#{1,6}[ \t]/m.test(src);
  const out = { title: null, preamble: [], sections: [], plain };
  let cur = null;
  let table = null;
  let lastItem = null;
  const stack = [];
  const target = () => (cur ? cur.blocks : out.preamble);
  // 일반 글 제목의 차례: 마지막 "N." 번호, 그 안의 마지막 "가." 차례, Ⅰ·■·【】 같은 큰 제목을 본 적이 있는지
  const seq = { top: 0, sub: 0, major: false };
  const openSection = (level, num, title, heading, demote = 0) => {
    lastItem = null;
    table = null;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    cur = { level, num, title, heading, blocks: [], parent: stack[stack.length - 1] || null, ...(demote ? { demote } : {}) };
    stack.push(cur);
    out.sections.push(cur);
  };
  for (const raw of src.split('\n')) {
    const tabCells = raw.includes('\t') ? raw.split('\t').map((c) => cleanText(c)) : null;
    const line = raw.replace(/\t/g, '    ');
    const isPipeRow = /^\s*\|.*\|\s*$/.test(line);
    const isTabRow = !!tabCells && tabCells.filter(Boolean).length >= 2 && !listItem(line, plain); // "1)\t항목"은 목록
    if (!isPipeRow && !isTabRow) table = null;
    const h = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/.exec(line.trimEnd());
    if (h) {
      const level = h[1].length;
      const heading = cleanText(h[2].replace(/#+$/, ''));
      if (level === 1 && !out.title && !out.sections.length) {
        out.title = heading;
        lastItem = null;
        continue;
      }
      const m = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(heading);
      openSection(level, m ? m[1] : null, m ? m[2] : heading, heading);
      continue;
    }
    // 빈 줄, 마크다운 구분선(---, ***, ___)은 내용이 아니다(F23-4: 「---」가 이름 없는 항목으로 읽히던 문제). 표의 |---| 구분 줄은 위에서 표로 처리한다
    // 탭 표의 「---⇥---」 구분 줄도 구분선이 아니다(재검증 R5)
    if (/^\s*$/.test(line) || (!isPipeRow && !isTabRow && /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line))) {
      lastItem = null;
      continue;
    }
    if (plain) {
      const ph = plainHeading(line, seq);
      if (ph) {
        if (ph.major) Object.assign(seq, { top: 0, sub: 0, major: true }); // 큰 제목 아래에서는 번호가 1부터 다시
        if (ph.top) Object.assign(seq, { top: ph.top, sub: 0 });
        if (ph.sub) seq.sub = ph.sub;
        openSection(ph.level, ph.num, ph.title, ph.heading, ph.demote || 0);
        continue;
      }
      // 일반 글의 첫 줄(제목·목록·표가 아닌 것)은 문서 제목
      if (!out.title && !out.sections.length && !out.preamble.length && !isTabRow && !listItem(line, plain)) {
        out.title = cleanText(line);
        continue;
      }
    }
    if (isPipeRow || isTabRow) {
      lastItem = null;
      const cells = isPipeRow ? splitRow(line) : tabCells;
      if (isSeparatorRow(cells)) {
        if (table && table.rows.length === 1 && !table.header) table.header = table.rows.shift();
        continue;
      }
      if (!table) {
        table = { kind: 'table', header: null, rows: [] };
        target().push(table);
        // 탭 표는 머리글 구분줄이 없으므로 첫 줄의 첫 칸이 흔한 머리글 이름이면 머리글로 본다
        if (isTabRow && TAB_HEADER.test(cells[0])) {
          table.header = cells;
          continue;
        }
      }
      // 첫 칸이 빈 행은 병합 셀을 붙여 넣은 것이므로 앞 행에 이어 붙인다(이름 없는 노드가 생기지 않게)
      if (!cells[0] && table.rows.length) {
        const prev = table.rows[table.rows.length - 1];
        cells.forEach((c, i) => { if (i > 0 && c) prev[i] = prev[i] ? `${prev[i]} ${c}` : c; });
        continue;
      }
      if (!cells[0]) continue; // 이어 붙일 앞 행도 없으면 이름이 없어 노드로 만들 수 없다
      table.rows.push(cells);
      continue;
    }
    const item = listItem(line, plain);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    // 번호 항목 바로 뒤(빈 줄 없이)의 들여쓴 글머리표는 그 항목의 하위 글머리표다. 절차 절에서는 그 단계 글에 붙인다(corpus F9).
    // 번호 항목보다 더 깊게 들여쓴 것만(재검증 R4: 「  1) …」 아래 같은 깊이의 「  ○ …」는 별도 단계). 들여쓰기 칸 수를 항목마다 둔다
    if (item) item.indent = /^\s*/.exec(line)[0].length;
    if (item && item.kind === 'bullet' && /^\s{2,}/.test(line) && lastItem) {
      const anchor = lastItem.kind === 'num' ? lastItem.indent : lastItem.sub ? lastItem.anchor : undefined;
      if (anchor !== undefined && item.indent > anchor) Object.assign(item, { sub: true, anchor });
    }
    if (item) target().push((lastItem = item));
    else if (quote) target().push((lastItem = { kind: 'quote', text: cleanText(quote[1]) }));
    else if (lastItem && /^\s{2,}\S/.test(line)) lastItem.text = cleanText(`${lastItem.text} ${line}`); // 목록 항목의 이어지는 줄
    else target().push((lastItem = { kind: 'para', text: cleanText(line) }));
  }
  // 일반 글의 "N."·"가." 제목인데 내용도 하위 절도 없으면 목록 항목이었다고 보고 앞 절의 번호 목록으로 되돌린다(검토 2026-10-03:
  // "■ 업무 범위" 아래 "1. 카드 승인 정산", "1. 업무 범위" 아래 "가. …"가 제목으로 읽혀 업무가 사라지던 문제)
  for (let i = 0; i < out.sections.length; i += 1) {
    const sec = out.sections[i];
    if (!sec.demote || sec.blocks.length || out.sections.some((x) => x.parent === sec && !x.removed)) continue;
    const prev = out.sections.slice(0, i).reverse().find((x) => !x.removed);
    (prev ? prev.blocks : out.preamble).push({ kind: 'num', n: sec.demote, text: sec.title });
    sec.removed = true;
  }
  out.sections = out.sections.filter((x) => !x.removed);
  return out;
}

const HANGUL_ORDER = '가나다라마바사아자차카타파하';
const TAB_HEADER = /^(구분|항목|역할|이름|리스크|위험|단계|순서|번호|No\.?|산출물|질문|ID|작업 ?ID|코드)$/i; // ID·작업ID·코드: corpus F5(probe P2)
// 문장 끝(…다, …니다)이나 마침표·물음표, "키: 값"이면 제목이 아니다.
// '개요'·'필요'처럼 '요'로 끝나는 명사가 많아 '요·함·음'은 보지 않는다(번호 차례 확인이 목록과의 구분을 함께 맡는다)
const looksLikeSentence = (t) => /다\.?$|[.?!]$/.test(t) || /[:：]/.test(t);

/** 일반 글의 절 제목 줄이면 {level, num, title, heading}. 들여쓰기가 거의 없고 짧으며 문장이 아니어야 한다 */
function plainHeading(line, seq = { top: 0, sub: 0 }) {
  if (/^\s{2,}/.test(line)) return null;
  const t = cleanText(line);
  const ok = (title) => title && title.length <= 30 && !looksLikeSentence(title);
  const base = seq.major ? 1 : 0; // Ⅰ·■·【】 큰 제목이 있으면 번호 제목은 그 아래 단계
  let m = /^(\d+(?:\.\d+)+)\.?\s+(.+)$/.exec(t);
  if (m && ok(m[2]) && [seq.top, seq.top + 1].includes(Number(m[1].split('.')[0]))) return { level: base + 1 + m[1].split('.').length, num: m[1], title: m[2], heading: t };
  // "N."은 목록과 모양이 같으므로 바로 앞 제목 번호의 다음 차례일 때만 제목으로 본다(5. 산출물 아래의 "1. 교육 일정표"는 목록)
  m = /^(\d+)\.\s+(.+)$/.exec(t);
  if (m && ok(m[2]) && Number(m[1]) === seq.top + 1) return { level: base + 2, num: m[1], title: m[2], heading: t, top: Number(m[1]), demote: Number(m[1]) };
  m = /^([IVX]+|[Ⅰ-Ⅻ])\.\s+(.+)$/.exec(t);
  if (m && ok(m[2])) return { level: 2, num: null, title: m[2], heading: t, major: true };
  m = /^([가-하])\.\s+(.+)$/.exec(t);
  if (m && HANGUL_ORDER.indexOf(m[1]) === seq.sub && ok(m[2])) return { level: base + 3, num: seq.top ? seq.top + '-' + m[1] : null, title: m[2], heading: t, sub: seq.sub + 1, demote: seq.sub + 1 }; // 원문 §5-가
  m = /^[■◆▣]\s*(.+)$/.exec(t) || /^【\s*(.+?)\s*】$/.exec(t);
  if (m && ok(m[1])) return { level: 2, num: null, title: m[1], heading: m[1], major: true };
  return null;
}

/** 목록 한 줄이면 {kind:'num'|'bullet', n?, text}. 일반 글에서는 "가." "나)"도 번호 목록이다 */
function listItem(line, plain) {
  let m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line) || /^\s*\((\d+)\)\s*(.*)$/.exec(line);
  if (m) return { kind: 'num', n: Number(m[1]), text: cleanText(m[2]) };
  m = /^\s*([①-⑳])\s*(.*)$/.exec(line);
  if (m) return { kind: 'num', n: CIRCLED.indexOf(m[1]) + 1, text: cleanText(m[2]) };
  if (plain) {
    m = /^\s*([가-하])[.)]\s+(.*)$/.exec(line);
    if (m && HANGUL_ORDER.includes(m[1])) return { kind: 'num', n: HANGUL_ORDER.indexOf(m[1]) + 1, text: cleanText(m[2]) };
  }
  m = /^\s*[-*+]\s+(.*)$/.exec(line) || /^\s*[•□■○●◦▪▫▶▷◇◆∙※]\s*(.*)$/.exec(line) || /^\s*·\s+(.*)$/.exec(line);
  // ※ 줄은 본문이 아니라 덧붙임 글이다(범위 절의 「※ …다루지 않음」을 범위 제외로 읽는 데 쓴다)
  if (m) return { kind: 'bullet', text: cleanText(m[1]), ...(/^\s*※/.test(line) ? { note: true } : {}) };
  return null;
}

// ── 도우미 ──────────────────────────────────────────────────────────────

const refOf = (s) => (s.num ? `§${s.num}` : `「${s.title}」`);
// 괄호를 짝 맞춰 뗀다(안쪽부터). 「제42조(위탁받은 개인(신용)정보처리)」가 「제42조정보처리)」로 깨지던 문제(F23-4). 짝이 없는 괄호는 그대로
export function stripParens(s) {
  let t = String(s);
  for (let prev = null; prev !== t;) {
    prev = t;
    t = t.replace(/\([^()]*\)|（[^（）]*）/g, '');
  }
  // 겹괄호의 짝이 모자라면(「보안 (추가(협의)」) 남은 여는 괄호부터 끝까지 뗀다 — 옛 규칙과 같은 결과(재검증 R9). 닫는 괄호가 아예 없는 「정산 (미완」은 그대로
  const hasClose = /[)）]/.test(String(s));
  const open = Math.max(t.lastIndexOf('('), t.lastIndexOf('（'));
  if (hasClose && open >= 0 && t.length !== String(s).length) t = t.slice(0, open);
  return t;
}
// 제목의 맨 바깥 괄호 묶음과 [가정]·[미확인] 표시를 나온 순서대로(괄호 안의 표시는 괄호와 함께 한 번만)
function headNotes(title) {
  const found = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < title.length; i += 1) {
    const ch = title[i];
    if (ch === '(' || ch === '（') { if (depth === 0) start = i; depth += 1; }
    else if ((ch === ')' || ch === '）') && depth > 0) { depth -= 1; if (depth === 0) found.push([start, title.slice(start, i + 1)]); }
  }
  const inside = (at) => found.some(([s, t]) => at > s && at < s + t.length);
  for (const m of title.matchAll(new RegExp(MARK.source, 'g'))) if (!inside(m.index)) found.push([m.index, m[0]]);
  return found.sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}
const titleCore = (title) => stripParens(title).replace(MARK, '').trim();
// 조문 제목 「제1조(목적)」「제3조의2 (정의)」: 괄호 안이 조문의 이름이라 떼지 않는다(F23-4)
const ARTICLE = /^제\s*\d+\s*조(?:의\s*\d+)?\s*[(（]/;
// 목차 절: 노드로 만들지 않는다(F23-4)
const TOC_TITLE = /^(목\s*차|차례|contents|table of contents)$/i;
// 문장(…다. …니다 …?)이면 이름이 아니다. 「키: 값」은 따로 읽으므로 콜론은 보지 않는다(looksLikeSentence와 다름)
const isSentence = (t) => /다\.?$|[.?!]$/.test(stripMarks(String(t)).trim());
// 역할 절의 줄이 사람 이름이 아니라 문장인지: 「…다」로 끝나거나, 20자 넘는 줄이 마침표·물음표로 끝나거나, 40자를 넘으면.
// 「가상 운영 담당.」「가상 정산 담당 등.」처럼 짧은 줄의 끝 마침표만으로는 문장으로 보지 않는다(재검증 R6)
function isProse(t) {
  const s = stripMarks(String(t)).trim();
  return /다\.?$/.test(s) || (s.length > 20 && /[.?!]$/.test(s)) || s.length > CONVERT_RULES.roleLabelMax;
}
// 주제 노드 이름: 조문은 괄호까지, 그 밖은 괄호를 뗀 제목, 괄호뿐인 제목(「(참고)」)은 괄호 안 글자(재검증 R3·R10)
function topicLabel(s) {
  if (ARTICLE.test(stripMarks(s.title))) return stripMarks(s.title);
  const core = titleCore(s.title) || s.title;
  const inner = stripMarks(s.title).replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim();
  return hasName(core) ? core : inner || core;
}
// 글 속 날짜를 YYYY-MM-DD로. "2026-09-15", "2026.09.15", "2026. 9. 15.", "2026년 9월 15일", "2026/9/15"를 읽는다(검토5 V-6). 없으면 null
export function findDate(text) {
  // 앞 경계만 본다: 숫자·점·하이픈·빗금·v에 붙어 있으면 버전(v2026.1.2)·전화번호·긴 번호의 일부다(재검증 3).
  // 뒤쪽 글자(만원·건·회…)로 금액을 가려내려던 조건은 뺐다: "2026.09.15 회의록"·"2026.5.3건의"처럼 낱말·조사와 구분할 수 없어
  // 고칠 때마다 다른 쪽이 틀렸고(재검증 2·3차), 세 부분으로 된 수(2026.5.12)는 금액·개수 표기가 아니기 때문이다(금액은 "2026.5만원" — 날짜 꼴이 아님)
  const re = /(?<![\d.\-\/vV])(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})(?!\d)/g;
  for (const m of String(text || '').matchAll(re)) {
    const [, y, mo, d] = m;
    // 실제 달력 날짜만(2026.2.31 같은 값은 건너뛰고 다음 후보를 본다)
    const t = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (t.getUTCFullYear() !== Number(y) || t.getUTCMonth() !== Number(mo) - 1 || t.getUTCDate() !== Number(d)) continue;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}
// 제목·머리말(「키: 값」이 아닌 글)의 작성일(corpus F4: 「문서번호 제2026-3-12호 / 작성일 2026.09.18」이 알림 없이 3월 12일이 되던 문제).
// 키워드가 붙은 날짜를 키워드 순위로 고른다(재검증 R5: 위치 순서로 고르면 「2026.09.18 작성. 데이터 기준일 2026.06.30」이 기준일이 됨):
// 작성일·작성 일자 → 작성 → 기준일·일자. 같은 순위면 먼저 나온 것. 「작성」은 날짜 앞(「작성 2026.09.18」)·뒤(「2026.09.18 작성」) 모두.
// 키워드 붙은 날짜가 없을 때만 첫 날짜를 쓴다. 이때 문서 번호(제…호, 문서번호 …) 자리는 뺀다.
// findDate의 정규식은 건드리지 않는다(35.2: 세 번 흔들린 규칙). DATE_SPAN은 후보 자리를 찾을 뿐이고 날짜인지는 findDate가 정한다
const DATE_SPAN = /\d{4}\s*[.\-\/년]\s*\d{1,2}\s*[.\-\/월]\s*\d{1,2}/g;
const DATE_BEFORE = [[0, /(작성 ?일자|작성일)\s*[:：]?\s*$/], [1, /작성\s*[:：]?\s*$/], [2, /(기준일|일자)\s*[:：]?\s*$/]];
const DATE_AFTER = /^\s*[.일]?\s*작성/; // 「2026.09.18 작성」 「2026년 9월 18일 작성」
// 날짜 꼴을 느슨하게 읽는 후보(isDateOnly 전용. 날짜를 뽑는 findDate의 정규식은 건드리지 않는다).
// 「26-09-05」(두 자리 해)·「2026. 9. 5.」·「2026년 9월」(일 없음)·「2026.09」·「9월 5일」. 앞 경계는 findDate와 같다(R13-5)
const LOOSE_DATE = /(?<![\d.\-\/vV])(?:(?:\d{4}|\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*일?|(?:\d{4}|\d{2})\s*년\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일?)?|\d{4}\s*[.\-\/]\s*(\d{1,2})(?!\d|\.\d)|(\d{1,2})\s*월\s*(\d{1,2})\s*일?)\.?/g;
/** 값이 날짜뿐인가(「2026-09-05」「26-09-05」「2026년 9월」「2026년 9월 5일 작성」「2026-09-05 (초안)」). 작성 주체로 쓸 글자가 없다. 괄호 꼬리는 보지 않는다 */
export function isDateOnly(value) {
  const v = String(value || '').replace(/\([^)]*\)|（[^）]*）/g, ' ');
  let hit = !!findDate(v);
  const rest = v.replace(DATE_SPAN, ' ').replace(LOOSE_DATE, (m, ...g) => {
    const [a, b, c, d, e, f, h] = g; // 달·일 후보(앞 두 개는 해 다음 숫자들)
    const month = Number([a, c, e, f].find((x) => x !== undefined));
    const day = Number([b, d, h].find((x) => x !== undefined) || 1);
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return m; // 달력에 없는 값은 날짜로 치지 않는다
    hit = true;
    return ' ';
  });
  return hit && !/\p{L}/u.test(rest.replace(/작성(일자|일)?|[일월년]/g, ' '));
}
const DOC_NUMBER = /제\s*\d[\d\s.\-\/]*호|(문서 ?번호|번호)\s*[:：]?\s*\S+/g;
function headDate(text) {
  let best = null;
  for (const m of text.matchAll(DATE_SPAN)) {
    const end = m.index + m[0].length;
    const d = findDate(text.slice(Math.max(0, m.index - 1), end + 1)); // 앞뒤 한 글자를 함께 줘서 findDate의 경계 확인을 그대로 쓴다
    if (!d) continue;
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    const hit = DATE_BEFORE.find(([, re]) => re.test(before));
    const rank = hit ? hit[0] : DATE_AFTER.test(text.slice(end)) ? 1 : null;
    if (rank !== null && (!best || rank < best.rank)) best = { rank, d };
  }
  return best ? best.d : findDate(text.replace(DOC_NUMBER, ' '));
}
// 이름에 글자(한글·영문 등)가 하나도 없으면 — [가정]·[미확인] 표시, 번호(「3.」「1」), 괄호(「(양식)」)뿐이면 — 이름 없는 것으로 본다(corpus F11)
const hasName = (s) => /\p{L}/u.test(stripParens(stripMarks(String(s))));

// 표에서 이름으로 쓸 칸(검토5 V-1): 머리글에 이름 칸이 있으면 그 칸, 첫 머리글이 구분·순서·번호면 그다음 칸, 아니면 첫 칸.
// 이름 칸 후보는 절 종류별로 다르다(corpus F5: 범위 표의 「담당」 열이 업무 이름이 되던 문제). 범위의 이름·내용은 전에도 후보였다
const NAME_HEADER = {
  scope: /^(업무|업무명|업무 ?이름|작업|작업명|항목|명칭|이름|내용)$/,
  people: /^(역할|담당|담당자|이름)$/,
  artifacts: /^(산출물|산출물명|문서|문서명|이름|명칭)$/,
};
const INDEX_HEADER = /^(구분|분류|유형|순서|번호|단계|no\.?|#)$/i;
// 산출물 표는 구분·유형 대체 규칙을 쓰지 않는다(재검증 R2: 「구분 | 형식」의 형식 칸이 이름이 되던 문제).
// 이름 칸 머리글이 없으면 첫 칸, 첫 칸 값이 숫자일 때만 다음 칸(머리글 없는 「1 ⇥ 가상 보고서 ⇥ 엑셀」)
const isNumberCell = (c) => /^\d+$/.test(String(c || '').trim());
// 사람 표의 주체·기관 칸(F23-4). 「주체 | 역할」은 주체 칸이 이름(역할 칸은 하는 일), 그 밖에는 역할·담당 칸이 먼저이고
// 이름 칸이 없을 때만 주체·기관 칸(재검증 R4: 「기관 | 담당자 | 하는 일」에서 기관이 역할 이름이 되던 문제)
const SUBJECT_HEADER = /^(주체|참여자)$/;
const ORG_NAME_HEADER = /^(주체|참여자|기관|기관명)$/;
function nameCellIndex(header, kind, cells) {
  const named = header && header.length ? header.findIndex((h) => NAME_HEADER[kind].test(cleanText(h))) : -1;
  if (kind === 'people' && header && header.length) {
    const subject = header.findIndex((h) => SUBJECT_HEADER.test(cleanText(h)));
    if (subject >= 0 && (named < 0 || cleanText(header[named]) === '역할')) return subject;
    if (named < 0) {
      const org = header.findIndex((h) => ORG_NAME_HEADER.test(cleanText(h)));
      if (org >= 0) return org;
    }
  }
  if (named >= 0) return named;
  if (kind === 'artifacts') return cells && cells.length > 1 && isNumberCell(cells[0]) ? 1 : 0;
  if (!header || !header.length) return 0;
  return INDEX_HEADER.test(cleanText(header[0])) && header.length > 1 ? 1 : 0;
}
// 표 행에서 이름 칸과 나머지(설명)로 나눈다. 구분 칸 같은 앞 칸은 "머리글: 값"으로 설명에 넣는다
const NUMBER_HEADER = /^(순서|번호|단계|no\.?|#)$/i;
const DUTY_HEADER = /^(하는 ?일|담당 ?업무|업무|역할 ?내용|책임)$/;
// 돌려주는 값: name(이름 칸. 비어 있으면 null — 구분 값을 이름으로 쓰지 않는다, 재검증 5), desc(나머지 칸), duty(「하는 일」 칸. 없으면 desc)
function nameAndRest(cells, header, kind) {
  const i = nameCellIndex(header, kind, cells);
  const name = (cells[i] || '').trim() || null;
  const head = (k) => (header && header[k] ? cleanText(header[k]) : '');
  const rest = cells.map((c, k) => {
    if (k === i || !c || !c.trim()) return '';
    if ((NUMBER_HEADER.test(head(k)) || (!head(k) && k < i)) && isNumberCell(c)) return ''; // 번호 칸(머리글 없는 앞 번호 칸 포함)은 설명에 넣지 않는다
    return head(k) && k < i ? `${head(k)}: ${c}` : c;
  }).filter(Boolean);
  const dutyAt = header ? header.findIndex((h, k) => k !== i && DUTY_HEADER.test(cleanText(h))) : -1;
  const desc = rest.join(' — ') || null;
  return { name, desc, duty: dutyAt >= 0 ? (cells[dutyAt] || '').trim() || null : desc };
}
export const statusOf = (...texts) => {
  const all = texts.filter(Boolean).join(' ');
  if (/\[미확인/.test(all)) return '미확인';
  if (/\[가정/.test(all)) return '가정';
  return null;
};
export const marksOf = (t) => (String(t).match(new RegExp(MARK.source, 'g')) || []);
export const stripMarks = (s) => s.replace(new RegExp(MARK.source, 'g'), '').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compact = (s) => normalizeLabel(s).replace(/\s/g, '');
const contains = (hay, needle) => needle.length >= 2 && compact(hay).includes(compact(needle));
const circled = (i) => CIRCLED[i] || `(${i + 1})`;

// 장 제목 아래의 「1. CMS 개요 / 2. …」처럼 아래 절 제목을 늘어놓기만 한 절(목차 구실)이면 주제로 만들지 않는다(내용은 하위 절에서, F23-4).
// 조건: 하위 절이 있고, 줄이 모두 짧은 비문장(표 없음)이며, 앞 번호를 뗀 줄이 하위 절 제목과 **같아야** 한다 —
// 모든 줄이 같거나, 장 제목(CHAPTER·PART·제N장·N장·Ⅰ.)이면서 하나 이상 같을 때. 부분 일치는 보지 않는다(재검증 R3: 「보안」 절의 글이 사라지던 문제)
const CHAPTER_TITLE = /^(chapter|part|section)\b|^제\s*\d+\s*(장|편|부)|^\d+\s*장|^([IVX]+|[Ⅰ-Ⅻ])\.?\s/i;
function isOutline(section, lines, all) {
  const below = all.filter((x) => { for (let p = x.parent; p; p = p.parent) if (p === section) return true; return false; });
  if (!below.length) return false;
  if (!lines.every((l) => !l.cells && l.text.length <= 40 && !isSentence(l.text))) return false;
  const titles = new Set(below.map((x) => compact(titleCore(x.title))).filter(Boolean));
  const same = lines.filter((l) => titles.has(compact(titleCore(l.text.replace(/^\d+(?:\.\d+)*\.?\s*/, ''))))).length;
  return same === lines.length || (same > 0 && (CHAPTER_TITLE.test(section.heading) || CHAPTER_TITLE.test(section.title)));
}

function sectionKind(section) {
  // 목차는 그 절 자신의 제목만 본다(재검증 R1: 「# 목차」·「【목차】」 아래 이어지는 본문 절까지 목차가 되어 사라지던 문제)
  if (TOC_TITLE.test(titleCore(section.title))) return 'toc';
  const walk = (rules) => {
    for (let s = section; s; s = s.parent) {
      const core = titleCore(s.title);
      const hit = rules.find(([, re]) => re.test(core));
      if (hit) return hit[0];
    }
    return 'topic';
  };
  const kind = walk(SECTION_KINDS);
  // W8에서 더한 제목 낱말(「담당」「관련 문서」…) 때문에 분류가 바뀐 절만 표시한다. 이런 절만 W8 읽기(담당 줄 해석·문장 거르기)를 쓰고,
  // 원래부터 이해관계자·역할·산출물 절이던 것은 W8 전과 똑같이 읽는다(R12-1)
  section.viaW8 = kind !== walk(SECTION_KINDS_V1);
  return kind;
}

function overviewKey(key) {
  const k = cleanText(key).replace(/[:：]$/, '');
  const hit = OVERVIEW_KEYS.find(([, re]) => re.test(k));
  return hit ? hit[0] : null;
}

// 표 한 줄을 글로: 머리글이 있으면 "머리글: 값", 없으면 첫 칸 + 나머지
function rowText(row, header) {
  let cells = row.map((c) => c.trim());
  let numbered = false;
  // 「단계 | 내용」 표의 번호 칸은 글에 넣지 않는다(검토5 V-11: "① 1: …"처럼 번호가 겹치지 않게)
  if (header && header.length === cells.length && cells.length > 1 && /^(단계|순서|번호|no\.?|#)$/i.test(cleanText(header[0])) && /^\d+$/.test(cells[0])) {
    cells = cells.slice(1);
    header = header.slice(1);
    numbered = true;
  }
  if (header && header.length === cells.length && cells.length > 2) {
    return `${cells[0]} — ${cells.slice(1).map((c, i) => (c ? `${header[i + 1]}: ${c}` : '')).filter(Boolean).join(' / ')}`;
  }
  // 번호 칸을 뺀 「내용 | 담당」은 머리글을 남긴다(corpus F10: 「…보낸다: 결산 담당」 → 「…보낸다 — 담당: 결산 담당」)
  if (numbered && cells.length === 2) return cells[1] ? `${cells[0]} — ${header[1]}: ${cells[1]}` : cells[0];
  const rest = cells.slice(1).filter(Boolean);
  return rest.length ? `${cells[0]}: ${rest.join(' — ')}` : cells[0];
}

// 절의 내용을 줄 목록으로. 각 줄은 {text, n?(번호 목록 번호), row?(표 행 번호), cells?}
function linesOf(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (b.kind === 'table') b.rows.forEach((row, i) => lines.push({ text: rowText(row, b.header), row: i + 1, cells: row, header: b.header }));
    else lines.push({ text: b.text, n: b.kind === 'num' ? b.n : undefined, kind: b.kind, ...(b.sub ? { sub: true } : {}), ...(b.note ? { note: true } : {}) });
  }
  return lines.filter((l) => l.text);
}

// "키: 값" 꼴(개요 표의 2칸 행, 글머리표·문단의 "키: 값")을 [키, 값]으로
// tables=false(범위 절): 모든 행이 개요 키인 표만 읽는다
function keyValues(blocks, tables = true) {
  const out = [];
  for (const b of blocks) {
    if (b.kind === 'table') {
      // 범위 절의 표는 모든 행의 첫 칸이 개요 키일 때만 「키: 값」 표로 읽는다(재검증 R1: 「대상 업무 | …」「범위 제외 | …」 표).
      // 하나라도 아니면 업무 표다(corpus F8: 구분 칸 「마감」「주기」로 표가 통째로 사라지던 문제)
      // 머리글 첫 칸이 「업무」「업무명」처럼 업무 이름 칸이면 행 값과 상관없이 업무 표다(수렴 검증 R1: 업무 이름이 「설명」「마감」뿐인 표)
      if (!tables && b.header && /^(업무|업무명|업무 ?이름|작업|작업명)$/.test(cleanText(b.header[0]))) continue;
      if (!tables && !b.rows.every((row) => row.length >= 2 && overviewKey(row[0]))) continue;
      for (const row of b.rows) {
        // 머리줄 「문서번호: …⇥작성일: …⇥작성 부서: …」(탭으로 나뉜 칸마다 「키: 값」)은 칸마다 읽는다(탭 표로 읽힌 머리말)
        if (tables && row.length >= 2 && row.every((c) => /^[^:：[]{1,20}[:：]\s*\S/.test(c))) {
          for (const c of row) { const m = /^([^:：[]{1,20})[:：]\s*(.+)$/.exec(c); out.push([m[1], m[2], b]); }
        } else if (row.length >= 2 && row[0]) out.push([row[0], row.slice(1).filter(Boolean).join(' — '), b]);
      }
    } else {
      const m = /^([^:：[]{1,20})[:：]\s*(.+)$/.exec(b.text); // 키에 "["가 들면 표시([미확인: …]) 안의 콜론이다
      if (m) out.push([m[1], m[2], b]);
    }
  }
  return out;
}

// 쉼표 목록 나누기. [미확인: 카드사, VAN]처럼 괄호 안의 쉼표에서는 나누지 않는다(검토 2026-10-03)
function splitList(s) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if ('[(（'.includes(ch)) depth += 1;
    if ('])）'.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && ',，、;'.includes(ch)) {
      out.push(buf);
      buf = '';
    } else buf += ch;
  }
  out.push(buf);
  return out.map((x) => x.trim()).filter(Boolean);
}

// "당사 운영·보안·정산 담당" → 당사 운영 담당, 당사 보안 담당, 당사 정산 담당
function expandRoles(item) {
  const marks = marksOf(item).join(' ');
  const tokens = stripMarks(item).split(' ').filter(Boolean);
  if (marks) return expandRoles(stripMarks(item)).map((x) => `${x} ${marks}`);
  const i = tokens.findIndex((t) => t.includes('·'));
  if (i < 0 || tokens.length < 2) return [item];
  return tokens[i].split('·').filter(Boolean).map((p) => [...tokens.slice(0, i), p, ...tokens.slice(i + 1)].join(' '));
}

// 역할 이름에서 소속(앞)과 핵심 낱말(담당·팀 등 바로 앞)을 나눈다
function roleParts(label) {
  const tokens = stripMarks(label).split(' ').filter(Boolean);
  if (tokens.length > 1 && ROLE_SUFFIX.test(tokens[tokens.length - 1])) tokens.pop();
  const core = tokens[tokens.length - 1] || label;
  // 앞 낱말이 기관처럼 보일 때만 소속으로 본다(A사, 당사, 카드사/VAN, …팀). '교육 운영 담당'의 '교육'은 소속이 아니다
  const org = tokens.length > 1 && ORG_HINT.test(tokens[0]) && !NOT_ORG.test(tokens[0]) ? tokens.slice(0, -1).join(' ') : '';
  return { core, org };
}

function truncate(s, max, notes, where) {
  if (s.length <= max) return s;
  notes.push({ code: 'C-TRUNCATED', where, max });
  return `${s.slice(0, max - 1)}…`;
}

// ── 변환 ────────────────────────────────────────────────────────────────

/**
 * @param {string} text 문서 원문(마크다운 또는 일반 글)
 * @param {{now:string, random?:()=>number}} ctx now: ISO 8601 시각(기록 시각·변환일)
 * @returns {{ok:true, doc:object, report:object} | {ok:false, error:{code:string, field:string, too_long?:number}}}
 *   report: {rules_version, node_count, target, sections:[{ref, title, kind, made}], notes:[{code,...}]}
 */
export function convertDocument(text, ctx) {
  const src = typeof text === 'string' ? text : '';
  if (!src.trim()) return { ok: false, error: { code: 'E-REQUIRED', field: 'document' } };
  if (src.length > CONVERT_RULES.maxInput) return { ok: false, error: { code: 'E-SCHEMA', field: 'document', too_long: CONVERT_RULES.maxInput } };

  const random = ctx.random || Math.random;
  const sw = { ...CONVERT_RULES.cr17j, ...(ctx.cr17j || {}) }; // CR-17 J 스위치(기본값은 CONVERT_RULES.cr17j)
  const today = ctx.now.slice(0, 10);
  const parsed = parseDocument(src);
  const notes = [];
  const sections = [];

  // 1) 개요(머리말·개요 절의 "키: 값")
  const info = { name: null, purpose: null, background: null, scope: [], scope_out: [], people: [], date: null, owner: null, work_attrs: {}, root_attrs: {}, refs: new Set() };
  const intro = []; // 유니버스 설명에 붙일 머리말 글
  const readOverview = (blocks, ref, tables = true) => {
    let used = 0;
    for (const [key, value, block] of keyValues(blocks, tables)) {
      const k = overviewKey(key);
      const v = cleanText(value);
      if (!k || !v) continue;
      // 키가 그냥 「작성」이면 작성 주체로 읽지 않는다(R12-2: 「작성: 2026-09-05」「작성: 가상구매팀 / 2026.09.05 / 검토 전」이 문자열 통째로 작성 주체가 되던 문제).
      // W8 전과 같게 머리말 글로 남기고 날짜만 작성일 후보로 읽는다(F4). 「작성」 키를 작성 주체로 읽는 것은 CR-17 J 스위치 authorPickOrg가 켜졌을 때만
      if (k === 'owner' && cleanText(key).replace(/[\s:：]/g, '') === '작성' && !sw.authorPickOrg) {
        block.authorLine = true; // 작성 줄은 개요 문장(⑦ 설명·⑧ 주기·마감)을 고를 때 뺀다(R13-6). 줄 자체는 예전처럼 머리말·목적 글로 남는다
        continue;
      }
      used += 1;
      block.used = true;
      info.refs.add(ref);
      if (k === 'scope') info.scope.push({ text: v, ref: `${ref} 범위` });
      else if (k === 'scope_out') info.scope_out.push(v);
      else if (k === 'people') info.people.push({ text: v, ref: `${ref} ${cleanText(key)}` });
      else if (k === 'work_attr') {
        // 속성 이름은 02-design 5.6 약속의 표기로 맞춘다: 「사용시스템」(띄어쓰기 없음)도 「사용 시스템」으로 저장해야 초안이 읽는다(여섯 번째 검토 C-8)
        const wk0 = cleanText(key).replace(/\s/g, '');
        const wk = wk0 === '사용시스템' ? '사용 시스템' : wk0;
        if (!(wk in info.work_attrs)) info.work_attrs[wk] = truncate(v, TEXT_MAX, notes, wk); // 이미 있는 속성은 덮어쓰지 않는다(corpus F8). 긴 값은 잘라 알린다(검증 상한 2000자, C-6)
      }
      else if (k === 'date') info.date = info.date || findDate(v);
      else if (k === 'owner' && isDateOnly(v)) {
        // 날짜뿐인 값은 어떤 키든 작성 주체가 아니다(R12-2) → 작성 주체는 입력받는다(C-NO-OWNER). 날짜는 스위치(authorDate)·키 「작성」일 때만 작성일로 읽는다(스위치가 켜진 W8 동작 그대로)
        if (sw.authorDate) info.date = info.date || findDate(v);
        if (cleanText(key).replace(/[\s:：]/g, '') === '작성') info.authorLineDate = headDate(v);
      }
      else if (k === 'owner' && (sw.authorPickOrg || sw.authorDate) && /^작성/.test(cleanText(key).replace(/\s/g, ''))) {
        // CR-17 J 스위치(꺼짐 = D-P6: 값 그대로). 「작성: 가상재무팀 류다온 / 2026-09-01」
        //   authorDate: 날짜를 작성일로 / authorPickOrg: 키가 「작성」·「작성 부서」일 때만 조직 낱말(…팀·…부·…실·…본부·…센터…)까지를 작성 주체로
        //   (조직 낱말이 없으면 작성 주체 없음 → 입력받기, 값 그대로 쓰지 않는다). 「작성자」·「작성 주체」는 값 그대로(D-P6).
        //   한 줄에 키가 여럿이면(「작성자: 류다온 / 작성 부서: 가상팀」) 「작성 부서」 칸의 값만 쓴다(R13-6)
        const a = authorOf(v);
        if (cleanText(key).replace(/\s/g, '') === '작성') info.authorLineDate = headDate(v); // 스위치가 꺼진 쪽과 같게: 키가 그냥 「작성」이면 같은 줄 날짜는 예전처럼(F4) 작성일 후보
        if (sw.authorDate && a.date) info.date = info.date || a.date;
        const picked = sw.authorPickOrg ? orgOwnerOf(key, v) : undefined; // undefined: 조직 고르기 대상 키가 아님 → 값 그대로
        const owner = picked === undefined ? v : picked;
        if (owner && !info.owner) info.owner = owner;
      }
      else if (!info[k]) {
        info[k] = v;
        if (k === 'purpose') info.purposeRef = ref;
        // 「작성: 가상팀 / 2026.09.05」: 작성 주체는 값 그대로(D-P6)이고, 키가 그냥 「작성」이면 같은 줄의 날짜는 예전처럼(F4) 작성일 후보로 읽는다
        if (k === 'owner' && cleanText(key).replace(/\s/g, '') === '작성') info.authorLineDate = headDate(v);
      }
    }
    return used;
  };
  readOverview(parsed.preamble, '머리말');
  for (const b of parsed.preamble) if (!b.used && b.kind !== 'table') intro.push(b.text);

  for (const s of parsed.sections) {
    s.kind = sectionKind(s);
    if (s.kind === 'overview') {
      const used = readOverview(s.blocks, refOf(s));
      const rest = s.blocks.filter((b) => !b.used && b.kind !== 'table');
      if (!info.purpose && rest.length) {
        info.purpose = rest.map((b) => b.text).join(' ');
        info.purposeRef = refOf(s);
        info.purposeProse = rest.filter((b) => !b.authorLine).map((b) => b.text).join(' '); // 작성 줄을 뺀 글: ⑦⑧이 문장을 고를 때 쓴다(R13-6)
      }
      if (s.blocks.length) sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'overview', made: used });
    }
  }
  if (!info.date) info.date = info.authorLineDate || headDate([parsed.title, ...intro].filter(Boolean).join(' '));
  const docDate = info.date || today;
  if (!info.date) notes.push({ code: 'C-DATE-ASSUMED', date: today });

  const rawName = info.name || parsed.title || cleanText(src.split('\n').find((l) => l.trim()) || '');
  const name = truncate(stripMarks(rawName) || '이름 없는 문서', LABEL_MAX, notes, '이름');
  const nameMarks = marksOf(rawName); // 이름에 붙은 [가정]·[미확인]은 꼭지의 표시·상태로 남긴다

  // 2) 노드 모으기. 같은 유형·이름은 하나로 합치고 원문 근거를 잇는다(12.1 중복 규칙)
  const nodes = [];
  const byKey = new Map();
  let seq = 0;
  const pushNode = (core_type, label, { ref, description, subtype, attrs = {}, status } = {}) => {
    // 이름이 100자를 넘으면 …로 자르고 알리며, 설명이 없으면 전체 이름을 설명에 남긴다(여섯 번째 검토 C-7)
    const full = stripMarks(label) || label;
    const longName = full.length > LABEL_MAX;
    const clean = longName ? truncate(full, LABEL_MAX, notes, '이름') : full;
    if (longName && !description) description = full;
    const key = `${core_type}|${normalizeLabel(clean)}`;
    const found = byKey.get(key);
    const marks = marksOf(label).join(' ');
    if (found) {
      if (ref && !found.attrs.원문.split(', ').includes(ref)) found.attrs.원문 += `, ${ref}`;
      // 앞서 이름만 나온 노드(머리말 「담당: 이름」 등)에 뒤에서 설명이 붙으면 채운다(검토5 V-9)
      if (description && !found.description) found.description = truncate(description, TEXT_MAX, notes, clean);
      if (status && !found.attrs.상태) found.attrs.상태 = status;
      if (marks && !String(found.attrs.표시 || '').includes(marks)) found.attrs.표시 = [found.attrs.표시, marks].filter(Boolean).join(' ');
      return found;
    }
    seq += 1;
    const n = {
      id: `N-${String(seq).padStart(3, '0')}`,
      core_type,
      label: clean,
      ...(subtype ? { subtype } : {}),
      ...(description ? { description: truncate(description, TEXT_MAX, notes, clean) } : {}),
      attrs: { 원문: ref, ...attrs, ...(status ? { 상태: status } : {}), ...(marks ? { 표시: marks } : {}) },
      hidden: false,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
    nodes.push(n);
    byKey.set(key, n);
    return n;
  };

  // 업무: 개요의 범위 + 범위 절의 목록
  for (const s of parsed.sections.filter((x) => x.kind === 'scope')) {
    readOverview(s.blocks, refOf(s), false);
    const lines = linesOf(s.blocks.filter((b) => !b.used));
    let outCount = 0;
    for (const l of lines) {
      // 「※ 수수료 계산은 이 문서에서 다루지 않음(별도 업무정의서)」: 범위 제외는 노드로 만들지 않는다(12.9 표 「범위 제외」)
      if (!l.cells && l.note && SCOPE_OUT_NOTE.test(l.text)) { info.scope_out.push(l.text); outCount += 1; continue; }
      if (!l.cells) { info.scope.push({ text: l.text, ref: refOf(s), desc: null }); continue; }
      const { name: cellName, desc } = nameAndRest(l.cells, l.header, 'scope'); // 구분 열이 있는 표도 업무 이름 칸을 쓴다(검토5 V-1)
      if (!cellName) { notes.push({ code: 'C-ROW-NO-NAME', ref: refOf(s), row: l.row }); continue; }
      info.scope.push({ text: cellName, ref: refOf(s), desc });
    }
    if (lines.some((l) => l.cells && nameCellIndex(l.header, 'scope') > 0)) notes.push({ code: 'C-TABLE-NAME-COL', ref: refOf(s), col: nameCellIndex(lines.find((l) => l.cells).header, 'scope') + 1 });
    sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'scope', made: lines.length - outCount });
  }
  for (const s of parsed.sections.filter((x) => x.kind === 'scope_out')) {
    const lines = linesOf(s.blocks);
    for (const l of lines) info.scope_out.push(l.text);
    if (lines.length) sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'scope_out', made: 0 });
  }
  const works = [];
  for (const item of info.scope) {
    for (const part of item.desc ? [item.text] : splitList(item.text)) {
      if (!hasName(part)) { notes.push({ code: 'C-NO-NAME', ref: item.ref, text: part }); continue; }
      const w = pushNode('work', part, { ref: item.ref, status: statusOf(part), description: item.desc || undefined });
      if (!works.includes(w)) works.push(w);
    }
  }

  // 업무 흐름 → 대표 업무의 절차 속성
  const steps = [];
  const stepRefs = [];
  for (const s of parsed.sections.filter((x) => x.kind === 'steps')) {
    const lines = linesOf(s.blocks);
    const items = lines.filter((l) => l.n !== undefined || l.kind === 'bullet' || l.row);
    const use = items.length ? items : lines;
    // 번호 단계 아래 들여쓴 하위 글머리표는 따로 세지 않고 그 단계 글에 붙인다(corpus F9: 단계 번호가 밀리던 문제)
    for (const l of use) {
      if (l.sub && steps.length) steps[steps.length - 1] += ` — ${l.text}`;
      else steps.push(l.text);
    }
    if (use.length) stepRefs.push(refOf(s));
    sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'steps', made: use.filter((l) => !l.sub).length });
  }
  if (!works.length) {
    // 범위가 없으면 업무 하나(문서 이름)로 만든다
    // 이메일·뉴스처럼 업무정의서가 아닌 글이면 이름이 첫 줄 전체가 된다: 40자를 넘으면 앞부분만 이름으로 쓰고 전체는 설명에 둔다
    // 「업무정의서: …」 같은 문서 종류 접두어는 업무 이름에서 뗀다(꼭지 이름은 문서 제목 그대로, W8)
    const base = stripDocPrefix(name);
    const long = base.length > CONVERT_RULES.workLabelMax;
    works.push(pushNode('work', docWorkLabel(name), { ref: stepRefs[0] || (parsed.title ? '제목' : '전체'), ...(long ? { description: base } : {}) }));
    notes.push({ code: 'C-NO-SCOPE' });
  }
  const main = works[0];
  if (steps.length) {
    main.attrs.절차 = truncate(steps.map((t, i) => `${circled(i)} ${t}`).join(' '), TEXT_MAX, notes, '절차');
    for (const r of stepRefs) if (!main.attrs.원문.split(', ').includes(r)) main.attrs.원문 += `, ${r}`;
    if (!main.attrs.상태) {
      const st = statusOf(...steps);
      if (st) main.attrs.상태 = st;
    }
  }
  Object.assign(main.attrs, info.work_attrs);

  // 주의사항·유의사항 절 → 대표 업무의 주의사항 속성(02-design 5.6 약속, 초안 「주의사항·노하우」로 이어짐)
  for (const s of parsed.sections.filter((x) => x.kind === 'cautions')) {
    const lines = linesOf(s.blocks);
    if (!lines.length) continue;
    main.attrs.주의사항 = truncate([main.attrs.주의사항, ...lines.map((l) => l.text)].filter(Boolean).join(' / '), TEXT_MAX, notes, '주의사항');
    if (!main.attrs.원문.split(', ').includes(refOf(s))) main.attrs.원문 += `, ${refOf(s)}`;
    if (!main.attrs.상태) {
      const st = statusOf(...lines.map((l) => l.text));
      if (st) main.attrs.상태 = st;
    }
    sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'cautions', made: lines.length });
  }

  // 주제: 그 밖의 절(내용이 있는 것)마다 하나
  const topics = [];
  const subtypes = new Map();
  for (const s of parsed.sections.filter((x) => x.kind === 'toc')) sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'toc', made: 0 });
  for (const s of parsed.sections.filter((x) => x.kind === 'topic')) {
    const lines = linesOf(s.blocks);
    if (!lines.length) continue; // 하위 절만 있는 절
    if (isOutline(s, lines, parsed.sections)) { sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'outline', made: 0 }); continue; }
    // 괄호뿐인 제목(「7. (참고)」)은 괄호 안 글자를 이름으로(재검증 R3). 괄호 안도 비면 아래에서 C-NO-NAME
    const label = topicLabel(s);
    if (!hasName(label)) { notes.push({ code: 'C-NO-NAME', ref: refOf(s), text: s.title }); continue; } // 「## 3.」처럼 번호뿐인 제목
    const headNote = (ARTICLE.test(stripMarks(s.title)) ? marksOf(s.title) : headNotes(s.title)).join(' ');
    const description = [headNote, ...lines.map((l) => (l.kind === 'bullet' || l.n !== undefined || l.row ? `- ${l.text}` : l.text))].filter(Boolean).join('\n');
    const sub = TOPIC_SUBTYPES.find(([, re]) => re.test(label));
    if (sub) subtypes.set(`topic|${sub[0]}`, { core_type: 'topic', name: sub[0] });
    const t = pushNode('topic', label, { ref: refOf(s), description, subtype: sub ? sub[0] : undefined, status: statusOf(s.title, ...lines.map((l) => l.text)) });
    const same = topics.find((x) => x.node === t);
    if (same) {
      // 제목이 같은 절이 또 있으면(예: 2.1 예외, 3.1 예외) 노드는 하나, 설명을 이어 붙인다(연결이 두 번 생기지 않게)
      t.description = truncate(`${t.description || ''}\n${description}`.trim(), TEXT_MAX, notes, label);
      same.text += ` ${description}`;
      sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'topic', made: 0, merged: label });
    } else {
      topics.push({ node: t, text: `${label} ${description}`, known: !!sub });
      sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'topic', made: 1, ...(sub ? {} : { unknown: true }) });
    }
    // "망취소는 …" 처럼 업무 이름으로 시작하는 문장은 그 업무의 설명으로 쓴다
    for (const l of lines) {
      for (const w of [...works].sort((a, b) => b.label.length - a.label.length)) {
        if (w.description) continue;
        if (new RegExp(`^${escapeRe(w.label)}\\s?(은|는|이란|란)\\s`).test(l.text)) {
          w.description = truncate(l.text, TEXT_MAX, notes, w.label);
          if (!w.attrs.원문.split(', ').includes(refOf(s))) w.attrs.원문 += `, ${refOf(s)}`;
          break;
        }
      }
    }
  }
  if (topics.some((t) => !t.known)) notes.push({ code: 'C-TOPIC-GUESS', count: topics.filter((t) => !t.known).length });

  // 업무가 하나뿐인 문서: 개요의 첫 문장·주기·마감을 그 업무의 설명·속성으로(W8, CR-17 J 스위치 summaryToWork·periodDeadline — 기본 꺼짐, J 추천은 1차 후).
  // 여러 업무면 어느 업무의 것인지 알 수 없어 넣지 않는다. 주기·마감은 원문 구절 그대로이고, 분명하지 않으면(마감 구절이 서로 다르면) 넣지 않는다.
  // 개요 표의 「주기: …」 같은 명시 값이 먼저다
  const single = works.length === 1;
  if (single && (sw.summaryToWork || sw.periodDeadline)) {
    let fromOverview = false;
    const prose = info.purposeProse !== undefined ? info.purposeProse : info.purpose; // 「작성:」 줄은 업무 설명·주기·마감의 근거가 아니다(R13-6)
    if (sw.summaryToWork && !main.description && prose) { main.description = truncate(firstSentence(prose), TEXT_MAX, notes, main.label); fromOverview = true; }
    const per = sw.periodDeadline ? periodIn(prose) : null;
    if (per && !('주기' in main.attrs)) { main.attrs.주기 = per; fromOverview = true; }
    const dl = sw.periodDeadline ? deadlineIn([prose, ...steps]) : null;
    if (dl && !('마감' in main.attrs)) main.attrs.마감 = dl;
    if (fromOverview && info.purposeRef && !main.attrs.원문.split(', ').includes(info.purposeRef)) main.attrs.원문 += `, ${info.purposeRef}`;
  }

  // 이름이 아닌 문장(사람 절의 문장 줄, 「관련 문서」 절의 문장 줄)은 그 절의 주제 노드 설명으로 모은다. 만든 주제가 있으면 true
  const pushProseTopic = (s, prose, code) => {
    const label = topicLabel(s);
    if (!hasName(label)) { notes.push({ code: 'C-NO-NAME', ref: refOf(s), text: s.title }); return false; }
    const description = prose.map((l) => (l.kind === 'bullet' || l.n !== undefined ? `- ${l.text}` : l.text)).join('\n');
    const t = pushNode('topic', label, { ref: refOf(s), description, status: statusOf(s.title, ...prose.map((l) => l.text)) });
    if (!topics.some((x) => x.node === t)) {
      topics.push({ node: t, text: `${label} ${description}`, known: false });
      // 규칙 밖 주제 수에 넣는다(알림은 주제 절 다음에 이미 나갔을 수 있으므로 그 알림의 수를 늘린다)
      const guess = notes.find((n) => n.code === 'C-TOPIC-GUESS');
      if (guess) guess.count += 1;
      else notes.push({ code: 'C-TOPIC-GUESS', count: 1 });
    }
    notes.push({ code, ref: refOf(s), count: prose.length });
    return true;
  };

  // 사람(역할): 개요의 이해관계자 + 이해관계자 절
  const roleItems = [];
  for (const p of info.people) for (const part of splitList(p.text)) roleItems.push({ text: part, ref: p.ref });
  for (const s of parsed.sections.filter((x) => x.kind === 'people')) {
    const lines = linesOf(s.blocks);
    let extra = 0; // 한 줄에서 사람이 여럿 나온 만큼(「주 담당: A / 검토: B」)
    const prose = []; // 「참가기관은 담당자를 선임하여야 한다.」 같은 문장은 사람 이름이 아니다 → 이 절의 주제 설명으로(F23-4)
    // 담당 줄 읽기(키·값 뒤집기)는 W8에서 제목 낱말(「담당」…)로 새로 사람 절이 된 절에만 쓴다. 원래 이해관계자·역할 절은 W8 전과 똑같이
    // 「역할: 하는 일」로 읽는다(R12-1: 「- 담당: 가상 접수」는 역할 「담당」이 가상 접수를 한다는 12.9.1 v1 꼴)
    const assignSec = !!s.viaW8;
    // 담당 줄 한 줄(또는 두 칸 행)의 키·값을 값마다 읽는다(R12-4). 사람이 된 값은 roleItems로, 이름이 아닌 값은 prose로. 읽을 줄이면 true
    const takeAssign = (l, text) => {
      const p = assignmentParts(text);
      if (!p) return false;
      if (l.cells && (!p.ok.length || p.rejected.length)) return false; // 표 행은 값이 모두 이름일 때만 담당 줄로 읽는다(아니면 역할 행)
      if (!p.ok.length) { prose.push(l); return true; } // 「주 담당: 접수는 총괄 부서가 수행한다」처럼 값이 이름이 아니면 사람을 만들지 않고 절의 주제 설명으로(R11-2)
      for (const a of p.ok) roleItems.push({ text: a.name, ref: refOf(s), desc: a.key, assign: a.key });
      if (p.rejected.length) {
        prose.push({ ...l, text: p.rejected.map((x) => `${x.key}: ${x.name}`).join(' / '), cells: undefined, row: undefined });
        extra += p.ok.length; // 한 줄이 prose로도 세어지므로 사람 수만큼 더한다
      } else extra += p.ok.length - 1;
      return true;
    };
    for (const l of lines) {
      // 「주 담당: 류다온 / 검토: 가상재무팀장」(W8): 키마다 이름을 뽑아 사람으로. 주 담당·담당·정은 (스위치 assignPerforms가 켜지면) 업무에 잇고, 검토·부·협조는 사람만 만든다
      // 「주 담당 | 류다온」 두 칸 행도 같다
      if (assignSec && (l.cells ? l.cells.length === 2 && (!l.header || INDEX_HEADER.test(cleanText(l.header[0]))) && takeAssign(l, `${l.cells[0]}: ${l.cells[1]}`) : takeAssign(l, l.text))) continue;
      if (l.cells) {
        const { name: cellName, desc, duty } = nameAndRest(l.cells, l.header, 'people');
        if (!cellName) { notes.push({ code: 'C-ROW-NO-NAME', ref: refOf(s), row: l.row }); continue; }
        roleItems.push({ text: cellName, ref: refOf(s), desc: desc || '', duty: duty || '' });
      }
      else {
        // 「이름: 설명」, 「이름 — 설명」을 먼저 나눈다(재검증 R6: 「가상 정산 담당 — 매월 대사를 한다.」는 역할)
        const kv = /^([^:：[]{1,30})[:：]\s*(.+)$/.exec(l.text) || /^([^—–[]{1,30}?)\s+(?:—|–|-)\s+(.+)$/.exec(l.text);
        if (!kv && isProse(l.text)) { prose.push(l); continue; }
        roleItems.push(kv ? { text: kv[1], ref: refOf(s), desc: kv[2] } : { text: l.text, ref: refOf(s) });
      }
    }
    sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'people', made: lines.length - prose.length + extra });
    if (prose.length) pushProseTopic(s, prose, 'C-PEOPLE-PROSE');
  }
  const roles = [];
  const roleDuty = new Map(); // 역할 노드 → [{text, ref}] 원문에 적힌 하는 일(담당 추정의 근거)
  const assigns = []; // 담당 절에서 「주 담당·담당·정」으로 적힌 사람: {r, key, ref}
  let hasRoleNode = false;
  for (const item of roleItems) {
    for (const label of item.desc ? [item.text] : expandRoles(item.text)) {
      if (!hasName(label)) { notes.push({ code: 'C-NO-NAME', ref: item.ref, text: label }); continue; }
      const { org } = roleParts(label);
      // 담당 절에서 뽑은 이름은 하위 유형 「역할」 사람(12.9.1 v1: 이해관계자는 역할. 라벨은 원문 이름 그대로).
      // CR-17 J 스위치 namedPersonPlain: 이름 모양(한글 2~4자)이면 하위 유형 없는 사람
      const named = sw.namedPersonPlain && !!item.assign && looksLikePersonName(label);
      const r = pushNode('person', label, { ref: item.ref, subtype: named ? undefined : SUBTYPE_ROLE, description: item.desc, attrs: org && !named ? { 소속: org } : {}, status: statusOf(label, item.desc) });
      if (!roles.includes(r)) roles.push(r);
      if (!named) hasRoleNode = true;
      if (sw.assignPerforms && item.assign && ASSIGN_STRONG.test(item.assign)) assigns.push({ r, key: item.assign, ref: item.ref });
      if (item.desc && !item.assign) {
        if (!roleDuty.has(r)) roleDuty.set(r, []);
        roleDuty.get(r).push({ text: item.duty !== undefined ? item.duty : item.desc, ref: item.ref }); // 표면 「하는 일」 칸만, 아니면 설명 전체
      }
    }
  }
  if (hasRoleNode) subtypes.set(`person|${SUBTYPE_ROLE}`, { core_type: 'person', name: SUBTYPE_ROLE });

  // 산출물: "가 → 나 → 다", 목록, 표의 이름 칸(산출물·문서·이름 칸, 첫 칸이 번호면 다음 칸 — corpus F5)
  const artifacts = [];
  const related = new Set(); // 「관련 문서」 절에서 나온 산출물(업무가 하나뿐이면 그 업무에 잇는다)
  for (const s of parsed.sections.filter((x) => x.kind === 'artifacts')) {
    let order = 0;
    let made = 0;
    const prose = []; // 「관련 문서」 절 아래의 문장(「이 문서는 매년 고친다.」)은 문서 이름이 아니다 → 이 절의 주제 설명으로(R12-3). W8에서 제목 낱말로 새로 산출물 절이 된 절만
    for (const l of linesOf(s.blocks)) {
      const cell = l.cells ? nameAndRest(l.cells, l.header, 'artifacts') : null;
      if (cell && !cell.name) { notes.push({ code: 'C-ROW-NO-NAME', ref: refOf(s), row: l.row }); continue; }
      if (s.viaW8 && isDocSentence(cell ? cell.name : l.text)) { prose.push(l); continue; }
      const parts = cell ? [cell.name] : l.text.includes('→') ? l.text.split(/\s*→\s*/) : l.n !== undefined || l.kind === 'bullet' ? [l.text] : splitList(l.text);
      const ordered = l.text.includes('→') || l.n !== undefined;
      for (const p of parts.filter(Boolean)) {
        const m = /^(.+?)\s*\(([^)]*)\)\s*$/.exec(p);
        let label = m ? m[1] : p;
        let desc = m ? m[2] : cell ? cell.desc || '' : '';
        // 괄호 안이 보관 경로 모양(>, \, a/b/c, 드라이브·폴더…)이면 설명이 아니라 「위치」 속성으로(CR-17 J 스위치 pathToLocation. 꺼짐 = 괄호는 설명, 12.9.1 v1)
        const place = sw.pathToLocation && m && looksLikePlace(m[2]) ? m[2].trim() : '';
        if (place) desc = '';
        if (!hasName(label)) { notes.push({ code: 'C-NO-NAME', ref: refOf(s), text: p }); continue; }
        if (label.length > CONVERT_RULES.artifactLabelMax) {
          desc = [p, desc].filter(Boolean).join(' — ');
          label = `${label.slice(0, CONVERT_RULES.artifactLabelMax - 1)}…`;
        }
        if (ordered) order += 1;
        const a = pushNode('artifact', label, { ref: refOf(s), description: desc || undefined, attrs: { ...(ordered ? { 순서: order } : {}), ...(place ? { 위치: place } : {}) }, status: statusOf(p) });
        if (!artifacts.includes(a)) { artifacts.push(a); if (RELATED_DOC_TITLE.test(titleCore(s.title))) related.add(a); }
        made += 1;
      }
    }
    sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'artifacts', made });
    if (prose.length) pushProseTopic(s, prose, 'C-ARTIFACT-PROSE');
  }

  // 꼭지

  const rootId = 'N-000';
  const rootAttrs = { 원문: info.refs.size ? [...info.refs].join(', ') : parsed.title ? '제목' : '전체' };
  if (info.background) rootAttrs.배경 = truncate(info.background, TEXT_MAX, notes, '배경');
  if (nameMarks.length) Object.assign(rootAttrs, { 표시: nameMarks.join(' '), 상태: statusOf(...nameMarks) });
  rootAttrs.변환 = `규칙 기반 초벌(규칙 ${CONVERT_RULES.version}, ${today})`;
  const root = {
    id: rootId, core_type: 'root', label: name,
    ...(info.purpose ? { description: truncate(info.purpose, TEXT_MAX, notes, '목적') } : {}),
    attrs: rootAttrs, hidden: false, created_at: ctx.now, updated_at: ctx.now,
  };

  // 3) 연결
  const edges = [];
  const pushEdge = (source, target, core_type, note) => {
    edges.push({ id: `L-${String(edges.length + 1).padStart(3, '0')}`, source, target, core_type, ...(note ? { note } : {}), hidden: false, created_at: ctx.now });
  };
  for (const w of works) pushEdge(rootId, w.id, 'contains');
  for (const t of topics) {
    const hits = works.filter((w) => contains(t.text, w.label));
    if (hits.length) for (const w of hits) pushEdge(w.id, t.node.id, 'relates_to', '규칙 기반 추정: 주제 내용에 업무 이름이 나옴');
    else pushEdge(rootId, t.node.id, 'contains');
  }
  let performs = 0;
  let assignedPerforms = 0; // 그중 담당 절의 「주 담당·담당·정」으로 만든 것
  let assignSkipped = 0;
  for (const r of roles) {
    const { core } = roleParts(r.label);
    const hits = topics.filter((t) => contains(t.node.label, core));
    for (const t of hits) pushEdge(r.id, t.node.id, 'relates_to', '규칙 기반 추정: 역할 이름과 주제 이름이 겹침');
    // 담당(수행): 원문이 그 역할의 하는 일로 업무 이름을 적은 경우만. 기간은 원문에 없으므로 두지 않는다(= 지금 담당으로 계산)
    // 하는 일을 쉼표로 나눈 항목이 업무 이름과 같을 때만 잇는다(D3-33). "결과 승인"처럼 업무 이름이 일부만 들어간 항목(결재·수강)은 담당이 아니다
    const duties = roleDuty.get(r) || [];
    const bare = (t) => compact(stripParens(stripMarks(t)).replace(/[.。·\s]+$/, ''));
    const dutyItems = duties.flatMap((d) => splitList(d.text).map((t) => ({ text: t, ref: d.ref })));
    // 글자 그대로 같은 업무가 먼저다. 그런 업무가 없을 때만 괄호를 뗀 값으로 비교한다(「승인(재처리)」 업무가 있으면 「승인」에 붙이지 않는다, 2차 B)
    const half = (t) => t.replace(/（/g, '(').replace(/）/g, ')'); // 전각 괄호는 반각과 같게 본다(3차 3)
    const exact = (t) => compact(half(stripMarks(t)).replace(/[.。·\s]+$/, ''));
    const dutyHit = (t, w) => exact(t.text) === exact(w.label) || (!works.some((x) => exact(t.text) === exact(x.label)) && bare(t.text) === compact(w.label));
    const done = works.filter((w) => dutyItems.some((t) => dutyHit(t, w)));
    for (const w of done) {
      const d = dutyItems.find((t) => dutyHit(t, w));
      pushEdge(r.id, w.id, 'performs', `규칙 기반 추정: 원문 ${d.ref}의 하는 일에 「${w.label}」${josa(w.label, '이/가')} 나옴(기간 미기재)`);
      performs += 1;
    }
    // CR-17 J 스위치 assignPerforms(켬이 승인안. 꺼짐 = 연결 없음, D-P3): 담당 절의 「주 담당·담당·정」은 이 문서가 정의하는 업무의 담당으로 직접 적힌 것이다.
    // 업무가 하나뿐일 때만 잇는다(여러 업무면 어느 업무인지 알 수 없어 연결하지 않고 알림)
    const mine = assigns.find((x) => x.r === r);
    let assigned = false;
    if (mine && single) {
      if (!done.includes(works[0])) {
        pushEdge(r.id, works[0].id, 'performs', `규칙 기반 추정: 원문 ${mine.ref}의 「${mine.key}」 칸에 적힘(기간 미기재)`);
        performs += 1;
        assignedPerforms += 1;
      }
      assigned = true;
    } else if (mine) assignSkipped += 1;
    if (!hits.length && !done.length && !assigned) pushEdge(rootId, r.id, 'contains');
  }
  if (performs) notes.push({ code: 'C-PERFORMS-GUESS', count: performs, ...(assignedPerforms ? { assigned: assignedPerforms } : {}) });
  if (assignSkipped) notes.push({ code: 'C-ASSIGN-SKIPPED', count: assignSkipped });
  for (const a of artifacts) {
    // CR-17 J 스위치 relatedDocLink: 「관련 문서」 절의 문서는 업무가 하나뿐이면 그 업무에 잇는다(CONVERT_RULES.relatedDocEdge). 꺼짐·그 밖에는 꼭지가 담는다(12.9.1 v1)
    if (sw.relatedDocLink && related.has(a) && single) pushEdge(works[0].id, a.id, CONVERT_RULES.relatedDocEdge, '규칙 기반 추정: 「관련 문서」 절에 적힌 문서(만든 문서인지 참고한 문서인지는 원문에 없음)');
    else pushEdge(rootId, a.id, 'contains');
  }

  // 4) 메모: 미확정 질문·리스크(원문 번호를 앞에)
  const events = [];
  const pushEvent = (type, payload, note, occurred_at = docDate) => {
    events.push({ id: `E-${String(events.length + 1).padStart(3, '0')}`, type, occurred_at, recorded_at: ctx.now, source: 'system', payload, ...(note ? { note } : {}) });
  };
  pushEvent('created', { target_kind: 'node', target_id: rootId }, `문서에서 규칙 기반 초벌 변환으로 만듦(규칙 ${CONVERT_RULES.version})`, today);
  const byLength = [...works].sort((a, b) => b.label.length - a.label.length);
  for (const s of parsed.sections.filter((x) => x.kind === 'memos')) {
    const lines = linesOf(s.blocks);
    const caution = /리스크|위험|주의/.test(titleCore(s.title));
    lines.forEach((l, i) => {
      const no = l.n !== undefined ? l.n : l.row !== undefined ? l.row : i + 1;
      const kind = caution ? '리스크' : '질문';
      const note = truncate(`[원문 ${refOf(s)}-${no} ${kind}] ${l.text}`, TEXT_MAX, notes, `${refOf(s)}-${no}`);
      const target = byLength.find((w) => contains(l.text, w.label));
      const topicIds = topics.filter((t) => contains(l.text, t.node.label)).map((t) => t.node.id);
      pushEvent('memo', { target_id: target ? target.id : rootId, category: caution ? 'caution' : 'issue', ...(topicIds.length ? { topic_ids: topicIds } : {}) }, note);
    });
    if (lines.length) sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'memos', made: lines.length });
  }

  // 5) 유니버스
  const descParts = [];
  if (info.purpose) descParts.push(info.purpose);
  if (info.scope_out.length) descParts.push(`범위 제외: ${info.scope_out.join(', ')}`);
  if (intro.length) descParts.push(`머리말: ${intro.join(' ')}`);
  descParts.push('문서에서 규칙 기반으로 초벌 변환한 업무 지도.');
  const universe = {
    id: newId(ID_PREFIX.universe, random),
    name,
    level: '업무',
    owner: info.owner ? truncate(info.owner, LABEL_MAX, notes, '작성 주체') : '',
    description: truncate(descParts.join(' '), TEXT_MAX, notes, '업무 지도 설명'),
    root_node_id: rootId,
    subtypes: [...subtypes.values()],
    tags: ['문서 변환'],
    is_sample: false,
    created_at: ctx.now,
  };
  if (!info.owner) notes.push({ code: 'C-NO-OWNER' });
  if (!parsed.sections.length) notes.push({ code: 'C-NO-STRUCTURE' });

  const doc = { schema_version: SCHEMA_VERSION, universe, nodes: [root, ...nodes], edges, events, refs: [], identity_links: [] };
  const nodeCount = doc.nodes.length;
  const { min, max } = CONVERT_RULES.nodeTarget;
  if (nodeCount > max) notes.push({ code: 'C-TOO-MANY', count: nodeCount, max });
  if (nodeCount < min) notes.push({ code: 'C-TOO-FEW', count: nodeCount, min });
  const unused = parsed.sections.filter((s) => s.kind === 'overview' && s.blocks.some((b) => !b.used && b.kind === 'table'));
  if (unused.length) notes.push({ code: 'C-UNUSED', refs: unused.map(refOf) });

  return {
    ok: true,
    doc,
    // 절은 문서 순서로 보여 준다
    report: { rules_version: CONVERT_RULES.version, node_count: nodeCount, target: { min, max }, steps: steps.length, sections: sections.sort((a, b) => a.order - b.order).map(({ order, ...x }) => x), notes },
  };
}
