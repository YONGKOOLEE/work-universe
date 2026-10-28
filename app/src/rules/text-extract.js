// 글로 추가(CR-19, D-37): 몇 문장짜리 줄글 → 항목·연결 「제안」(규칙 기반)과, 사용자가 고른 것 → applyBatch 명령.
// 순수 모듈 — DOM·저장소·네트워크를 쓰지 않는다(Node 단위 테스트: tests/cr19-text.test.js, tests/cr19-corpus.test.js).
//   extractFromText(text, view, opt)   글 → 제안 {method:'rule', nodes, edges, unread, partial, notes}
//   finalizeProposal(proposal, view)   지금 지도와 맞대어 match(있는 항목)·exists(이미 있는 연결)·방향·hold(확인할 것)를 채운다(규칙 읽기와 AI 읽기가 같은 함수를 쓴다)
//   defaultSelection / resolveSelection  사용자가 체크·고친 값 → 최종 유형·이름·연결 방향·넣을 수 있는지(화면과 proposalToOps가 같은 계산을 쓴다)
//   proposalToOps(proposal, selection, doc, opt)  → app.applyBatch에 넘길 명령 목록(전부 아니면 전무, 되감기 한 점)
// 지어내지 않는다: 아래 TEXT_PATTERNS 모양에 맞는 문장만 읽고, 나머지는 unread로 돌려준다. 모든 quote는 글에 있는 그대로의 부분 문자열이다.
// 원칙(R16, 2026-10-24): 애매하면 읽지 않는다. 놓치는 것은 괜찮고 잘못 읽는 것은 안 된다 — 현재형 동사 꼬리만 받고(TEXT_GUARDS·TEXT_WORDS.*Ok),
// 부정·시제·양태·날짜·나열·정지어(그녀·팀장 단독 …)가 하나라도 있으면 그 문장 전체를 읽지 않는다.
// 값(상한·단어 목록)은 이 파일 맨 위 상수 한 곳에 둔다.

import {
  BATCH_MAX_ROWS, CODES, EDGE_TYPES, LABEL_MAX, NODE_TYPES, hasKey, normalizeEmpNo, normalizeLabel, pairAllowed,
} from '../model/schema.js';

// ── 상수 ────────────────────────────────────────────────────────────────────

/**
 * R19: 처음 체크하는 범위의 기본은 'none'(아무것도 체크하지 않음 — 사용자가 「지도에 있는 것만 체크」「모두 체크」나 하나씩 체크). 규칙 읽기는 문장 안팎의 맥락을 다 알 수 없어서다.
 * R17: 'existing-only' = 지도에 이미 있는 항목(match)과 두 끝이 모두 지도에 있는 연결만(읽지 못한 문장이 같은 글에 있으면 연결은 체크하지 않음). 'all' = hold·같은 이름 둘·이미 있음·일부만 읽은 문장·뒤집는 문장이 있는 글 말고는 모두.
 * 규칙 읽기는 구멍을 다 막을 수 없어, 새로 만드는 항목은 사람이 이름이 맞는지 보고 체크하게 해 피해를 묶는다.
 */
export const TEXT_DEFAULT_CHECK = 'none';
/** 처음 체크 모드 값: 'none'(기본, 아무것도 처음 체크하지 않음) · 'existing-only'(「지도에 있는 것만 체크」 단추) · 'all'(「모두 체크」 단추) */
export const TEXT_CHECK_MODES = Object.freeze(['existing-only', 'all', 'none']);

/** 글·항목 상한(넘으면 notes로 알린다). 항목·연결 상한은 applyBatch의 행 상한(BATCH_MAX_ROWS)과 맞춘다 */
export const TEXT_LIMITS = Object.freeze({
  maxChars: 4000, // 붙여 넣을 수 있는 글자 수. 넘으면 읽지 않고 안내(일부만 읽어 오해하지 않게)
  maxSentences: 60, // 읽는 문장 수. 넘는 문장은 읽지 않았다고 알린다
  sentenceMax: 300, // 한 문장의 길이. 넘으면 읽지 않고 「읽지 못한 문장」으로(인용 한도 300자와 같은 기준)
  nameMin: 2, // 이름 길이(조사를 뗀 뒤)
  nameMax: 20,
  nameTokens: 4, // 이름 하나를 이루는 최대 낱말 수
  maxNodes: BATCH_MAX_ROWS,
  maxEdges: BATCH_MAX_ROWS * 2,
});

/** 읽는 모양에 쓰는 낱말(바꾸려면 여기 한 곳만 고친다) */
export const TEXT_WORDS = Object.freeze({
  artifactSuffixes: ['보고서', '계획서', '자료', '문서', '양식', '파일', '대장', '결과', '표', '서'],
  orgSuffixes: ['본부', '센터', '팀', '실', '부', '과'],
  titles: ['님', '씨', '팀장', '실장', '부장', '차장', '과장', '대리', '사원', '주임', '책임', '매니저', '선임', '본부장', '센터장', '팀원'],
  /** 직함 앞의 일반 낱말(신입 사원·담당 대리·협력 직원 …)이 붙으면 사람 이름이 아니다 */
  stopNames: ['담당자', '이것', '그것', '저것', '우리', '저희', '본인', '해당', '다음', '이후', '모두', '각자', '여기', '거기', '그분', '이분'],
  /** R16-8: 사람 이름으로 만들지 않는 낱말(대명사·불특정·역할·직함 단독·미정 표시). 이런 낱말이 이름 자리에 있으면 그 모양으로 읽지 않는다 */
  stopPersons: ['그녀', '그', '그분', '이분', '이', '저', '사람', '누군가', '누구', '인원', '담당자', '시스템', '팀원', '직원', '다들', '모두', '각자', '본인', '우리', '저희', '해당',
    '관리자', '책임자', '운영자', '작성자', '검토자', '승인자', '확인자', '사용자', '신청자', '참석자', '수신자', '발신자', '요청자', '접수자', '작업자', '이용자', '참가자', '대표자', '전임자', '후임자',
    '고객', '고객사', '거래처', '협력사', '외주사', '공급사', '본사', '지사', '부서', '파트', '외부', '내부', '신규', '기존', '아무', '아무도',
    '미정', '미지정', '미배정', '미확정', '공석', '없음', 'tbd', 'n/a', '아직',
    '팀장', '부장', '과장', '대리', '사원', '실장', '차장', '주임', '매니저', '선임', '책임', '본부장', '센터장', '님', '씨',
    // R17 A·B: 직함 낱말 더(대표·사장·이사 …)와 직함 앞에 붙는 일반 낱말(신입·담당·외부·협력 …), 사람이 아닌 출처(본사·감사 …)
    '대표', '사장', '부사장', '회장', '이사', '상무', '전무', '임원', '파트장', '그룹장', '조직장', '팀리더', '리더',
    '신입', '경력', '담당', '협력', '외주', '파견', '현장', '계약직', '정규직', '인턴', '감사', '감사인', '세무사', '회계사'],
  /** R18 허용 목록: 읽은 모양에 쓰이지 않은 낱말은 이음말(leading)과 이 낱말뿐이다. 이 밖의 낱말이 문장에 하나라도 남으면 그 문장 전체를 읽지 않는다 */
  /** 이름 떼기에는 쓰지만(leading) 허용 판정에서는 뺀다: 앞 문장 맥락에 기대어 뜻이 바뀌는 이음말 */
  contextWords: ['그때', '이때', '이후', '우선'],
  allowedWords: ['지금은', '요즘', '요즘은', '현재', '현재는'],
  /** 개조식 머리(「- 」「· 」「• 」「1)」「1.」) */
  listHead: /^(?:[-·•▪‣◦*]|\d{1,2}[.)])$/,
  /** 이름 첫머리에 오면 읽지 않는 지시어 */
  demonstratives: ['이', '그', '저', '해당', '본', '위', '아래', '각', '전', '구', '옛'],
  leading: ['그리고', '그러면', '그다음', '다음으로', '이어서', '먼저', '우선', '또', '또한', '바로', '즉시', '다시', '이때', '그때', '이후'],
  performVerb: /^(맡|담당|처리|진행)/,
  produceVerb: /^(만들|만든|만듭|작성|산출|낸다|내고|내며|냅니다|낸|내는)/,
  referenceVerb: /^(공유|문의|협업|보고|전달)/,
  verbLike: /(?:니다|한다|했다|된다|있다|없다|이다|하고|하며|하면|해서|[해려어아]요|드려요|세요|예요|에요|올림|드림)$/, // 「바다」처럼 이름이 「다」로 끝날 수 있어 서술어 끝은 두 글자 이상으로만 본다
  /** R16-1: 현재형 동사 꼬리만 받는다. 여기에 없는 꼬리(맡았다·맡지 않는다·맡을 예정·맡게 되면·맡나요 …)는 그 문장 전체를 읽지 않는다 */
  performOk: /^(?:맡는다|맡습니다|맡아요|맡아서?|맡고|맡으며|담당(?:한다|합니다|함|해요|하고|하며)|처리(?:한다|합니다|해요|하고|하며)|진행(?:한다|합니다|해요|하고|하며))$/,
  performProgress: /^(?:담당|처리|진행)$/, // 뒤에 「중이다」류가 올 때만(진행 중이다)
  progressTail: /^(?:중이다|중입니다|중임|중이에요|중이며)$/, // 「진행 중이다」「맡는 중이다」
  produceOk: /^(?:만든다|만듭니다|만들어요?|만들고|만들며|작성(?:한다|합니다|해요|하고|하며)|산출(?:한다|합니다|해요|하고|하며)|낸다|냅니다|내고|내며|내요)$/,
  referenceOk: /^(?:공유|문의|협업|보고|전달)(?:한다|합니다|해요|하고|하며|드립니다|드린다|드려요)$/,
  referenceNoun: /^(?:공유|문의|협업|보고|전달)$/, // 문장 끝에 놓인 명사형(메모체)
  belongOk: /^소속(?:이다|입니다|임|이에요|예요|이며|이고)?$/,
  /** R16-3: 「Y이 끝나면 Z가 …」에서 Z가 주어일 때, 뒤에 이 서술어 하나만 오면 선후행으로 읽는다 */
  startVerb: /^(?:시작(?:된다|됩니다|한다|합니다)|이어진다|이어집니다)$/,
  /** R16-7: 「X에게 공유」의 업무를 앞 문장에서 가져올 때, 문장에 남아도 되는 말(목적어는 이 낱말들뿐) */
  genericObject: /^(?:결과|내용|현황|상황|진행 상황|진행상황|이 건|해당 건|건)(?:을|를|은|는)?$/,
  /** T1: 「X에게 <지도 업무 이름> 결과를 공유한다」의 끝말(업무 이름 뒤에 오는 이 낱말 + 목적격). 업무 이름은 지도에 있을 때만 쓴다 */
  workResultTail: /^(.+?)\s+(?:결과|내용|현황|상황|진행\s?상황)(?:을|를|은|는)?$/,
  referenceAdverbs: ['따로', '별도로', '바로', '먼저', '꼭', '반드시', '직접', '함께'],
  /** 서술 꼬리(함·됨·임 …)는 이름이 아니다 */
  nominalTail: /(?:했음|됐음|됨|함|임|있음|없음|올림|드림)$/,
  /** R17 D: 「Y 끝나면 Z」 뒤에 Z를 받는 서술어 하나(그 뒤에 이어지는 말은 없어야 한다). 「하고/하며」는 절이 이어지므로 읽은 절 뒤가 남으면 일부만 읽음 */
  laterTail: /^(?:한다|합니다|해요|진행한다|진행합니다|진행해요|올린다|올립니다|올림|시작한다|시작합니다)$/,
  laterTailConnect: /^(?:하고|하며|진행하고|진행하며|올리고|올리며)$/,
  copula: /(?:입니다|이다|이에요|예요|이며)$/,
  /** R17: 읽은 절 뒤에 남아도 되는 꼬리(맡고 있다·맡아 왔다·진행 중이다). 이 밖의 말(하더라·단 …·(확정 전)·→ 취소)이 뒤따르면 뜻이 달라질 수 있어 그 문장을 읽지 않는다 */
  trailOk: /^(?:있다|있습니다|있어요|계십니다|계신다|계세요|왔다|왔습니다|중이다|중입니다|이다|입니다|임)$/,
});

/**
 * R16-1·4·9: 이 모양이 문장에 하나라도 있으면 그 문장 전체를 읽지 않는다(애매하면 읽지 않는다). 바꾸려면 이 표 한 곳만 고친다.
 *  sentence: 문장 글자 전체에서 찾는다 / token: 낱말마다(조사·사번·부호를 뗀 core) 찾는다
 */
export const TEXT_GUARDS = Object.freeze({
  sentence: Object.freeze([
    // R16-4 날짜·기간(숫자+월/일/년, 숫자/숫자, 지난·다음·이번 달·주, 올해·내년·예전 …)
    { id: 'date', why: '날짜·기간', known: true, re: /\d\s*(?:월|일|년|주차|분기)|\d{1,2}\s*[/.]\s*\d{1,2}|\d{4}\s*-\s*\d{1,2}|예전|작년|올\s?해|내년|지난\s?(?:달|주|해|분기)|다음\s?(?:달|주|해|분기)|이번\s?(?:달|주|분기)|금주|차주|전월|익월|당월|내일|어제|그저께|모레|상반기|하반기|[월화수목금토일]요일/ },
    // R16-9 나열(쉼표·빗금·가운뎃점)
    { id: 'list', why: '나열', known: true, re: /[,，、/／·ㆍ&+]/ },
    // R18: 확인 표시·취소 표시([ ] [x] ❌ ✔ …)가 있으면 사실 문장이 아니다
    { id: 'mark', why: '표시', re: /\[\s*[xX✓✔]?\s*\]|[❌✔✅✓✗✘✖☐☑☒🚫⛔👎🙅]/u },
  ]),
  token: Object.freeze([
    { id: 'neg', why: '부정', re: /않|못|아니|아님|아닌|없|말고|말아|^안$/ },
    { id: 'tense', why: '시제', re: /[았었였겼했랐렸쳤됐냈썼섰봤줬갔났뗐뒀졌]|던|예정/ },
    { id: 'modal', why: '양태·의문', re: /^수(?:도|가|는)?$|^것|싶|어렵|어려|(?:을지|는지|인지|할지|될지|갈지|볼지|줄지|올지|말지|길지)$|까요?$|나요$|가요$|냐$|^되(?:면|어|었|는|고|지|어서)/ },
    { id: 'question', why: '의문', re: /^(?:누구|무엇|뭐|어디|언제|어떻|어떤|어느|왜|얼마|몇)/ },
    { id: 'adverb', why: '시점·가정', re: /^(?:대신|위해|위한|때문|경우|만약|혹시|아직|아마|추후|향후|나중|앞으로|이제|일단|임시|잠시|한때|당시|과거|이전|넘기|넘겨|넘긴|넘김|바뀌|바뀐|바꿔|바꾼|퇴사|휴직|이번|당분간|원래|평소|가끔|주로|보통|기간|동안|말씀|곧|조만간|퍽이나|설마|어쩌면|가령|예컨대|잘도|담주|낼$|대행|부재)|동안$|^(?:월말|월초|연말|연초)(?:에는|에도|엔|에)$|^(?:휴가|부재|출장)(?:중|기간|시|때|에는|엔)$/ },
    // R17 C: 조건 어미 「~면」(세 글자 이상이거나 오면·하면·되면). 선후행 표지(끝나면·마치면)는 예외
    // R17: 전해 들은 말·추측·초안 표시
    { id: 'hearsay', why: '전해 들음·추측', re: /(?:더라|네요|죠|지요|군요|래요|대요|라는|이래|한대|듯하다|같다|같아요|모양이다)$|^듯|^\[?(?:초안|가안|예시|참고|가정|TODO|WIP)\]?$/i },
    { id: 'cond', why: '조건', re: /^(?!(?:끝나면|끝나면은|마치면|마치면은)$)(?:[가-힣A-Za-z0-9]{2,}면(?:은)?|오면|하면|되면)$|^(?!(?:화면|지면|단면|표면|평면|측면|장면|국면|이면|전면|후면|외면|내면|사면|방면|수면|분면)$)[가-힣]면(?:은)?$/ },
    { id: 'range', why: '날짜·기간', re: /(?:까지|부터)(?:는|도|만|의)?$/ },
    // R16-9 나열(및·또는·「서하늘하고」「서하늘이랑」). 동사 「담당하고」 같은 것은 제외
    { id: 'list', why: '나열', re: /^(?:및|또는|혹은|겸|vs|VS|or|OR|아니면)$|^(?!맡|담당|처리|진행|만들|작성|산출|공유|문의|협업|전달|보고).{2,}(?:하고|이랑|랑)$/ },
  ]),
});

/** 이름 끝의 조사(긴 것부터). 이름 자체가 이 글자로 끝날 수 있어, 떼고 남은 이름이 한 글자면 떼지 않고, 앞 글자의 받침과 맞지 않는 조사(「인사평가」의 가)도 떼지 않는다 */
const JOSA = ['께서', '에게서', '에게는', '에게', '에서는', '에서도', '에서', '으로는', '으로', '로는', '에는', '에도', '은', '는', '이', '가', '을', '를', '로', '의', '와', '과', '도'];
const JOSA_EXTRA = ['에', '께서', '께', '보다', '처럼', '만', '까지', '부터'];
const SUBJ = new Set(['은', '는', '이', '가', '께서']);
const OBJ = new Set(['을', '를']);
const DIR = new Set(['에서', '에서는', '에서도', '으로', '으로는', '로', '로는']);
const Z_JOSA = new Set(['을', '를', '은', '는', '이', '가', '도']);
const TO_PERSON = new Set(['에게', '에게는']);
const TITLE_RE = new RegExp(`^(${TEXT_WORDS.titles.join('|')})(?:님)?(은|는|이|가|을|를|에게|에서|의|와|과|도|께서)?(?:입니다|이다|이에요|예요)?$`);
const EMP_RE = /\(([A-Za-z0-9]+-\d+)\)/;
const COPULA_RE = TEXT_WORDS.copula;
const STOP_PERSON = new Set(TEXT_WORDS.stopPersons.map((x) => x.toLowerCase()));
const DEMON = new Set(TEXT_WORDS.demonstratives);
/** 조사 없이 사람 이름으로 받는 꼴: 한글 세 글자(2·4글자 낱말은 「일정」「협력업체」 같은 일반 명사일 위험이 커 지도에 같은 사람이 있을 때만 받는다) */
const PLAIN_PERSON_RE = /^[가-힣]{3}$/;

/** 규칙 한 줄 설명(화면 도움말·단위 테스트용). 읽는 모양 표 */
export const TEXT_PATTERN_DOC = Object.freeze([
  { id: 'perform_sv', relation: 'performs', shape: 'X(이/가/은/는) Y(을/를) 맡는다·맡고 있다·담당한다·처리한다·진행한다 (현재형만)', example: '서하늘이 대사 확인을 맡는다' },
  { id: 'perform_ws', relation: 'performs', shape: 'Y(은/는) X(이/가) 맡는다·담당한다·처리한다·진행한다 (현재형만, 대상이 앞)', example: '대사 확인은 서하늘이 맡는다' },
  { id: 'perform_vs', relation: 'performs', shape: 'Y 담당(은/는/:) X (X 뒤는 문장 끝이나 「이다」뿐)', example: '대사 확인 담당: 서하늘' },
  { id: 'produce', relation: 'produces', shape: 'Y(에서/으로/로) Z(을/를) 만든다·작성한다·산출한다·낸다', example: '보고에서 월말 정산 보고서를 만든다' },
  { id: 'precedes_a', relation: 'precedes', shape: 'Y(이/가) 끝나면·끝난 뒤·다음에·뒤에·후에 Z', example: '대사 확인이 끝나면 보고를 한다' },
  { id: 'precedes_b', relation: 'precedes', shape: 'Y(을/를) 마치면·마친 뒤·하고 나서 Z', example: '대사 확인을 마치면 보고를 한다' },
  { id: 'belongs_a', relation: 'belongs_to', shape: 'X(은/는) T 소속 · T 소속 X(T가 팀·실·부·과·센터·본부로 끝날 때)', example: '도하람은 감사팀 소속이다' },
  { id: 'belongs_b', relation: 'belongs_to', shape: 'T의 X(T가 팀·실·부·과·센터·본부로 끝날 때) — 같은 문장에 다른 모양(맡는다 등)이 함께 있어야 한다', example: '감사팀의 도하람이 보고를 맡는다' },
  { id: 'reference', relation: 'references', shape: 'X에게 공유·문의·협업·보고·전달 (그 문장의 업무가 하나일 때, 없으면 바로 앞 문장이 읽혔고 업무가 하나일 때, 또는 「X에게 <지도에 있는 업무 이름> 결과·내용·현황을 공유한다」)', example: '서하늘이 보고를 맡는다. 도하람에게 결과를 공유한다' },
  { id: 'reference_doc', relation: 'references', shape: 'Y에서 Z(을/를) 참고한다·참조한다 (Z가 지침·보고서·양식처럼 문서로 끝날 때)', example: '대사 확인에서 처리 지침을 참고한다' },
  { id: 'emp_no', relation: null, shape: '이름(V-1234) → 사번이 있는 사람', example: '서하늘(V-1003)이 대사 확인을 맡는다' },
]);

/** 읽지 못한 문장이 있는데 읽은 연결이 있을 때의 안내(notes와 화면 맨 위) */
export const TEXT_UNREAD_CONTEXT_NOTE = '읽지 못한 문장이 있습니다 — 앞뒤 문장이 뜻을 바꾸지 않는지 확인한 뒤 체크하세요';

/**
 * R21: 읽지 못한 문장에 붙이는 이유(쉬운 말). 키는 TEXT_GUARDS의 why·sentenceVerdict의 why·sc.veto의 why 그대로
 */
export const TEXT_UNREAD_WHY = Object.freeze({
  '날짜·기간': '날짜·기간이 들어 있어 읽지 않음',
  '나열': '나열(쉼표·그리고·와/과 등)이라 누가 무엇인지 애매해 읽지 않음',
  '표시': '확인·취소 표시가 있어 읽지 않음',
  '부정': '부정(않다·없다 등)이 들어 있어 읽지 않음',
  '시제': '지난 일이거나 예정이라 읽지 않음',
  '양태·의문': '추측·가능·의문이라 읽지 않음',
  '의문': '의문이라 읽지 않음',
  '시점·가정': '임시·대신·가정 같은 말이 있어 읽지 않음',
  '전해 들음·추측': '전해 들은 말이거나 추측이라 읽지 않음',
  '조건': '조건(~면)이 들어 있어 읽지 않음',
  '기호': '기호만 있는 줄이라 읽지 않음',
  '너무 긴 문장': '문장이 너무 길어 읽지 않음',
  '물음': '물음이라 읽지 않음',
  '머리 문장 뒤': '「Q.」 같은 머리 문장 바로 뒤라 읽지 않음',
  '앞 내용을 뒤집는 문장': '앞 내용을 취소·정정하는 문장이라 읽지 않음',
  '동사 꼬리': '맡는다·만든다 같은 현재형이 아니라서 읽지 않음',
  '쓰이지 않은 낱말': '읽은 모양 밖의 말이 섞여 있어 뜻이 달라질 수 있어 읽지 않음',
  '선후행 뒤 주어': '「끝나면」 뒤에 다른 주어가 있어 읽지 않음',
});
/** 이유 키가 없거나 모르는 값이면 「모양 밖」 */
export const TEXT_UNREAD_SHAPE_WHY = '읽는 모양에 맞지 않음(아래 「규칙으로 읽는 모양」 참고)';
export const TEXT_UNREAD_PARTIAL_WHY = '이름은 읽었지만 연결 모양을 다 읽지 못함';
/** T1(c): 「X에게 결과를 공유한다」의 업무를 정할 수 없을 때(앞 문장 업무가 둘 이상이거나 없음)의 이유. work는 예시에 쓸 업무 이름(없으면 「업무 이름」), who는 대상 이름 */
export const unreadWhichWorkWhy = (work, who) => `어느 업무의 결과인지 정할 수 없습니다 — 「${work || '업무 이름'} 결과를 ${who}에게 공유한다」처럼 업무 이름을 넣으세요`;
export const unreadWhyText = (why) => (why && hasKey(TEXT_UNREAD_WHY, why) ? TEXT_UNREAD_WHY[why] : TEXT_UNREAD_SHAPE_WHY);

/** 묶은 지도에서 글로 추가를 쓰지 못한다는 안내(화면 단추 자리의 한 줄과 같은 뜻) */
export const TEXT_GROUPED_NOTE = '묶은 지도에서는 글로 추가를 쓸 수 없습니다 — 팀·업무 지도를 열어 넣으세요';

// ── 낱말·이름 다루기 ────────────────────────────────────────────────────────

const LETTER_RE = /[\p{L}\p{N}]/u;
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const endsWithAny = (name, list) => list.some((w) => name.endsWith(w) && (w.length >= 2 || name.length >= 3));

/** 이름 끝말이 산출물이면 true(보고서·자료·문서·양식·파일·대장·표·서·계획서·결과) */
export const looksArtifact = (name) => endsWithAny(name, TEXT_WORDS.artifactSuffixes);
/** 이름 끝말이 팀·실·부·과·센터·본부이면 true(세 글자 이상) */
export const looksOrg = (name) => name.length >= 3 && endsWithAny(name, TEXT_WORDS.orgSuffixes);

/** 이름으로 쓸 수 있는 글로 다듬는다. 쓸 수 없으면 '' (2~20자, 글자·숫자 포함, 지시어 제외) */
export function cleanName(raw) {
  let s = oneLine(String(raw ?? '').replace(/^["'“‘「『(\[<]+|["'”’」』\]>,，、]+$/g, ''));
  // R17 G: 이름 속에 「(」가 있으면 끝의 「)」는 떼지 않는다(짝 없는 「)」만 뗀다). 낱말 끝 부호 떼기로 사라진 「)」는 되돌린다 — 「매입 대사(카드사 건)」
  const count = (ch) => s.split(ch).length - 1;
  while (s.endsWith(')') && count(')') > count('(')) s = s.slice(0, -1);
  if (count('(') > count(')')) s += ')';
  if (s.length < TEXT_LIMITS.nameMin || s.length > TEXT_LIMITS.nameMax) return '';
  if (!LETTER_RE.test(s) || /^[\d\s.\-]+$/.test(s)) return '';
  if (TEXT_WORDS.stopNames.includes(s)) return '';
  return s;
}

/** 한글 글자의 받침: 0이면 없음, 8은 ㄹ, 한글이 아니면 -1 */
function batchimOf(ch) {
  const c = ch.charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : -1;
}

/** 조사가 앞 글자의 받침과 맞는가(이/은/을/과/으로는 받침 뒤, 가/는/를/와/로는 받침 없는 글자 뒤). 한글이 아니면 판단하지 않는다 */
function josaFits(j, stem) {
  const b = batchimOf(stem[stem.length - 1]);
  if (b < 0) return true;
  switch (j) {
    case '이': case '은': case '을': case '과': return b !== 0;
    case '가': case '는': case '를': case '와': return b === 0;
    case '으로': case '으로는': return b !== 0 && b !== 8;
    case '로': case '로는': return b === 0 || b === 8;
    default: return true;
  }
}

/** 낱말 하나 해석: 괄호 사번·앞뒤 부호·조사·「님/씨」를 떼어 낸다. josa는 받침이 맞는 것만, 「도」는 약한 조사(weak)로 둔다 */
function parseToken(raw) {
  let w = raw;
  let emp_no = '';
  const m = EMP_RE.exec(w);
  if (m) {
    emp_no = m[1];
    w = w.replace(EMP_RE, '');
  }
  w = w.replace(/^["'“‘「『(\[<]+/, '');
  let colon = false;
  w = w.replace(/[,，、"'”’」』)\]>.!?:：]+$/, (tail) => { if (/[:：]/.test(tail)) colon = true; return ''; });
  if (!w) return { empty: true, colon };
  const t = TITLE_RE.exec(w);
  if (t) return { raw, core: w, name: t[1], josa: t[2] || '', emp_no: '', titled: false, title: true, colon, weak: false };
  let josa = '';
  let name = w;
  for (const j of JOSA) {
    if (w.endsWith(j) && w.length - j.length >= 2 && josaFits(j, w.slice(0, w.length - j.length))) {
      josa = j;
      name = w.slice(0, w.length - j.length);
      break;
    }
  }
  let titled = false;
  if (/(님|씨)$/.test(name) && name.length >= 3) {
    name = name.slice(0, -1);
    titled = true;
  }
  return { raw, core: w, name, josa, emp_no, titled, title: false, colon, weak: josa === '도' };
}

/** 문장 → 낱말 목록. 「이름 (V-1)」의 띄어 쓴 사번을 붙이고, 이름 뒤 직함 낱말은 앞 낱말에 합친다 */
function parseTokens(sentence) {
  const s = sentence.replace(/\s+(\([A-Za-z0-9]+-\d+\))/g, '$1');
  const out = [];
  for (const raw of s.split(/\s+/).filter(Boolean)) {
    const t = parseToken(raw);
    if (t.empty) {
      if (t.colon && out.length) out[out.length - 1].colon = true;
      continue;
    }
    const prev = out[out.length - 1];
    if (t.title && prev && prev.josa === '' && !prev.title) {
      prev.titled = true;
      prev.josa = t.josa;
      prev.weak = false;
      prev.colon = prev.colon || t.colon;
      continue;
    }
    out.push(t);
  }
  // 「경영지원과 소속」처럼 조직 끝말인 과(뒤에 소속이 온다)는 조사가 아니다
  out.forEach((t, i) => {
    if (t.josa === '과' && looksOrg(t.core) && out[i + 1] && out[i + 1].core.startsWith('소속')) {
      t.josa = '';
      t.name = t.core;
    }
  });
  return out;
}

/** 조사가 없는(또는 이름 중간의 약한 「도」뿐인) 낱말 */
const bare = (t) => t.josa === '' || t.weak === true;

/** 앞쪽으로 조사 없는 낱말을 이어 붙여 이름이 시작하는 자리를 찾는다(끝 낱말 포함 최대 max개) */
function backStart(T, end, max) {
  let a = end;
  while (a - 1 >= 0 && end - (a - 1) + 1 <= max && bare(T[a - 1]) && !T[a - 1].colon && !T[a - 1].title && !isClauseVerb(T[a - 1])) a -= 1;
  return a;
}

/**
 * T[a..b] → {label, alts}. 맨 앞의 이음말(그리고·바로 …)은 뗀다. 끝 낱말만 조사를 뗀다(opt.strip, 기본: 조사가 있는 낱말만).
 * 조사를 뗐다면 떼지 않은 모양을 alts에 남겨, 지도에서 찾을 때 둘 다 본다(「늘봄이」). 쓸 수 없는 이름이면 null
 */
function phraseOf(T, a, b, opt = {}) {
  let s = a;
  while (s < b && (TEXT_WORDS.leading.includes(T[s].core) || TEXT_WORDS.allowedWords.includes(T[s].core))) s += 1; // R19-5: 이름 앞의 이음말·현재·요즘 …도 이름이 아니다
  const strip = opt.strip === undefined ? !bare(T[b]) : opt.strip;
  const head = [];
  for (let i = s; i < b; i += 1) head.push(T[i].core);
  const last = strip ? T[b].name : T[b].core;
  const label = cleanName([...head, last].join(' '));
  if (!label) return null;
  const alts = [];
  if (strip && T[b].name !== T[b].core) {
    const alt = cleanName([...head, T[b].core].join(' '));
    if (alt && alt !== label) alts.push(alt);
  }
  return { label, alts };
}

const hasDemonstrative = (n) => n.split(' ').some((x) => DEMON.has(x));
const isWorkName = (n) => !!n && !looksArtifact(n) && !looksOrg(n) && !hasDemonstrative(n);
const isPersonName = (n) => !!n && !looksArtifact(n) && !looksOrg(n) && !hasDemonstrative(n);
const stripCopula = (s) => s.replace(COPULA_RE, '');
/** 끝말 「업무」는 뗀다(「대사 확인 업무」→「대사 확인」) */
const stripWorkTail = (label) => {
  const m = /^(.*\S)\s+업무$/.exec(label);
  return m ? m[1] : label;
};

/** phraseOf 결과 → 업무 항목(없으면 null). 「업무」를 뗀 이름과 떼기 전 이름을 함께 지도와 맞댄다 */
function workSpec(p) {
  if (!p) return null;
  const label = stripWorkTail(p.label);
  if (!isWorkName(label) || STOP_PERSON.has(label.toLowerCase())) return null; // R17 D: 정지어(감사·본사 …)는 업무 이름이 아니다
  const alts = [...p.alts.map(stripWorkTail).filter((x) => x !== label)];
  if (label !== p.label) alts.push(p.label);
  return { type: 'work', label, ...(alts.length ? { alts } : {}) };
}

/**
 * 낱말 → 사람 항목(없으면 null). 정지어(R16-8)·산출물/조직 끝말은 사람이 아니다.
 * 사번이나 직함(님·씨·팀장 …)이 있으면 확실한 사람, 없으면 「확인 필요」 — 한글 세 글자(PLAIN_PERSON_RE)이거나 지도에 같은 이름의 사람이 있을 때만 받는다
 */
function personSpec(t, sc, name = t.name) {
  if (t.title) return null;
  const base = cleanName(stripCopula(name));
  if (!base || !isPersonName(base) || STOP_PERSON.has(base.toLowerCase())) return null;
  const certain = !!(t.emp_no || t.titled);
  const alt = name === t.name && t.name !== t.core ? cleanName(stripCopula(t.core)) : '';
  const alts = alt && alt !== base ? [alt] : [];
  if (certain) return { type: 'person', label: base, emp_no: t.emp_no, ...(alts.length ? { alts } : {}) };
  const known = sc && sc.known && sc.known.person;
  const pick = [base, ...alts].find((c) => known && known.has(normalizeLabel(c))) || (PLAIN_PERSON_RE.test(base) ? base : '');
  if (!pick) return null;
  const rest = [base, ...alts].filter((c) => c !== pick);
  return { type: 'person', label: pick, unsure: true, ...(rest.length ? { alts: rest } : {}) };
}

/** 뒤따르는 업무 이름(Z): 조사가 붙은 낱말까지, 조사가 없으면 서술어 앞까지. → {work: 항목|null, veto?: 사유} */
function laterWork(T, s) {
  let j = s;
  while (j < T.length && TEXT_WORDS.leading.includes(T[j].core)) j += 1;
  const start = j;
  let end = -1;
  let endJosa = '';
  let otherJosa = false;
  for (; j < T.length && j - start < TEXT_LIMITS.nameTokens; j += 1) {
    const t = T[j];
    if (t.josa !== '') {
      const endsHere = !t.weak || j + 1 >= T.length || TEXT_WORDS.verbLike.test(T[j + 1].core); // 약한 「도」는 뒤가 서술어일 때만 끝
      if (endsHere) {
        if (Z_JOSA.has(t.josa)) {
          end = j;
          endJosa = t.josa;
        } else otherJosa = true;
        break;
      }
    }
    if (TEXT_WORDS.verbLike.test(t.core)) break;
  }
  if (end < 0) {
    if (otherJosa) return { work: null };
    end = j - 1;
  }
  if (end < start) return { work: null };
  // R16-13: 서술 꼬리(함·됨·임 …)가 이름에 섞이면 읽지 않는다
  if (endJosa === '' && end === T.length - 1 && T[end].core.length >= 3 && TEXT_WORDS.nominalTail.test(T[end].core)) return { work: null };
  const rest = T.slice(end + 1).map((t) => t.core);
  // R16-3: Z가 주어(이/가/은/는)이면 다른 모양이 이어지는 문장이라 선후행으로 읽지 않는다(문장 전체)
  if (SUBJ.has(endJosa)) {
    if (!(rest.length === 1 && TEXT_WORDS.startVerb.test(rest[0]))) return { work: null, veto: '선후행 뒤 주어' };
  } else if (!(rest.length === 0 || (rest.length === 1 && TEXT_WORDS.laterTail.test(rest[0])) || (rest.length >= 1 && TEXT_WORDS.laterTailConnect.test(rest[0])))) {
    // R17 D: Z 뒤는 문장 끝이거나 「한다·합니다·해요·진행한다·진행합니다·올린다 …」 하나뿐이어야 한다(「정리 부탁드려요」「잠깐 쉬어요」「해야 한다」는 읽지 않는다)
    return { work: null };
  }
  const tail = rest.length >= 1 ? end + 1 : -1;
  return { work: workSpec(phraseOf(T, start, end, { strip: endJosa !== '' })), start, end, tail, connect: tail >= 0 && TEXT_WORDS.laterTailConnect.test(T[tail].core) ? tail : -1 };
}

// ── 제안을 쌓는 도구(규칙 읽기와 AI 읽기가 함께 쓴다) ─────────────────────

const typeName = (t) => (hasKey(NODE_TYPES, t) ? NODE_TYPES[t] : t);
const relName = (t) => (hasKey(EDGE_TYPES, t) ? EDGE_TYPES[t] : t);
/** 「사람으로」「업무로」: 마지막 글자 받침(ㄹ 제외)이 있으면 으로 */
const euro = (w) => {
  const b = batchimOf(w[w.length - 1]);
  return b > 0 && b !== 8 ? '으로' : '로';
};

/** 「을/를」: 마지막 글자가 한글이면 받침에 맞게, 아니면 「을(를)」 (R21 화면 문구용) */
export const eulReul = (w) => {
  const b = batchimOf(String(w).slice(-1) || ' ');
  return b < 0 ? '을(를)' : b > 0 ? '을' : '를';
};

/**
 * 항목·연결을 쌓는 도구. 같은 이름(공백·대소문자 무시)은 한 항목으로 합치고, 상한을 넘으면 flags로 알린다.
 * 같은 이름이 서로 다른 유형으로 확실하게 읽히면(R16-3) 덮어쓰지 않고 먼저 나온 유형을 두며 conflict를 남긴다(finalizeProposal이 체크를 풀고 알린다).
 * 항목 key는 n1, n2…, 연결 key는 e1, e2…(만든 순서)
 */
export function createBuilder(limits = TEXT_LIMITS) {
  const nodes = [];
  const byLabel = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const flags = { nodesCapped: false, edgesCapped: false };
  return {
    nodes,
    edges,
    flags,
    /** @param {{type:string, label:string, emp_no?:string, unsure?:boolean, alts?:string[]}} spec */
    addNode(spec, quote) {
      const k = normalizeLabel(spec.label);
      const old = byLabel.get(k);
      if (old) {
        if (spec.emp_no && !old.emp_no && old.type === 'person' && spec.type === 'person') old.emp_no = spec.emp_no;
        if (old.type !== spec.type) {
          if (old.unsure && !spec.unsure) {
            // 확실하지 않던 유형이 다른 문장에서 확실해지면 그 유형으로
            old.type = spec.type;
            delete old.unsure;
            if (spec.type !== 'person') delete old.emp_no;
            if (spec.emp_no && spec.type === 'person') old.emp_no = spec.emp_no;
          } else if (!old.unsure && !spec.unsure) old.conflict = `${typeName(old.type)}·${typeName(spec.type)}`; // 둘 다 확실한데 다르면 덮어쓰지 않는다
        } else if (old.unsure && !spec.unsure) delete old.unsure;
        if (spec.alts && spec.alts.length) old.alts = [...new Set([...(old.alts || []), ...spec.alts])];
        return old;
      }
      if (nodes.length >= limits.maxNodes) {
        flags.nodesCapped = true;
        return null;
      }
      const n = {
        key: `n${nodes.length + 1}`,
        type: spec.type,
        label: spec.label,
        ...(spec.emp_no && spec.type === 'person' ? { emp_no: spec.emp_no } : {}),
        quote,
        match: null,
        ...(spec.unsure ? { unsure: true } : {}),
        ...(spec.alts && spec.alts.length ? { alts: [...spec.alts] } : {}),
      };
      nodes.push(n);
      byLabel.set(k, n);
      return n;
    },
    addEdge(a, b, type, quote, verb = '') {
      if (!a || !b || a === b) return null;
      const k = `${a.key}>${b.key}>${type}`;
      if (edgeKeys.has(k)) return null;
      if (edges.length >= limits.maxEdges) {
        flags.edgesCapped = true;
        return null;
      }
      edgeKeys.add(k);
      const e = { key: `e${edges.length + 1}`, from: a.key, to: b.key, type, quote, ...(verb ? { verb } : {}) };
      edges.push(e);
      return e;
    },
  };
}

// ── 문장 나누기 ─────────────────────────────────────────────────────────────

/** 글자가 없는 조각 중 구분선(---, ===, ***, |---| …)·공백·점뿐인 것은 버린다. 이 밖의 기호(❌ ? ✗ ↑ × …)는 버리지 않고 「읽지 못한 조각」으로 돌려준다(R19-1) */
const SEPARATOR_RE = /^[\s\-–—_=*~#•·▪‣◦─━═│|+.:：;；。]+$/;

/**
 * splitSentences와 같되 각 문장을 끝낸 부호(마침표·물음표 …, 없으면 '')를 함께 돌려준다 — 물음표로 끝난 문장은 질문이라 읽지 않는다.
 * R19-1: 글자가 없고 기호만 있는 조각(「❌」「?」「(?)」「↑ ×」, 같은 줄 「…맡는다. ❌」)은 {symbol: true}로 돌려준다 — 앞 문장을 취소·의문하는 표시일 수 있어 조용히 버리지 않는다.
 * 같은 줄에서 이어진 기호 조각은 하나로 합친다(「(?)」). 구분선·공백뿐인 조각은 버린다
 */
export function splitSentencesEnd(text) {
  const out = [];
  for (const rawLine of String(text).split(/\r\n?|\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*•·▪‣◦]|\d{1,2}[.)])\s+/, '');
    let start = 0;
    let symStart = -1;
    let symEnd = -1;
    const flushSym = () => {
      if (symStart >= 0) {
        const t = line.slice(symStart, symEnd).trim();
        if (t && !SEPARATOR_RE.test(t)) out.push({ text: t, end: '', symbol: true });
      }
      symStart = -1;
    };
    const piece = (a, b, end) => {
      const t = line.slice(a, b).trim();
      if (t && LETTER_RE.test(t)) {
        flushSym();
        out.push({ text: t, end });
      } else if (symStart < 0) {
        symStart = a;
        symEnd = b + (end ? 1 : 0);
      } else symEnd = b + (end ? 1 : 0);
    };
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const stop = ch === ';' || ch === '；' || ch === '。'
        || ('.!?！？'.includes(ch) && (i + 1 === line.length || /[\s"')\]」』”’]/.test(line[i + 1])));
      if (stop) {
        piece(start, i, ch);
        start = i + 1;
      }
    }
    piece(start, line.length, '');
    flushSym();
  }
  return out;
}

/** 마침표·물음표·느낌표(뒤가 공백이거나 끝일 때)·줄바꿈·「;」로 나눈다. 목록 머리(「- 」「1. 」)는 뗀다. 모든 문장은 글의 부분 문자열이다. 기호뿐인 조각은 뺀다(그것까지 보려면 splitSentencesEnd) */
export const splitSentences = (text) => splitSentencesEnd(text).filter((x) => !x.symbol).map((x) => x.text);

// ── 문장 단위 보호(R16): 이런 문장은 모양을 보기 전에 읽지 않는다 ─────────────

/** 가드가 찾은 낱말이 모두 지도에 있는 이름의 일부(「2분기 보고」「강의실·강사 섭외」)이면 날짜·나열이 아니다(R17) */
function guardHit(g, s, known) {
  const ms = [...s.matchAll(new RegExp(g.re.source, g.re.flags.includes('g') ? g.re.flags : `${g.re.flags}g`))].map((m) => m[0]);
  if (!ms.length) return false;
  if (!g.known || !known) return true;
  return !ms.every((m) => known.labels.some((l) => l.includes(m) && s.includes(l)));
}

/** 읽지 않을 이유(없으면 ''). 날짜·기간, 나열, 부정·시제·양태·의문·조건, 시점·가정 낱말, 나열 조사(와/과) */
function sentenceVeto(s, T, known) {
  for (const g of TEXT_GUARDS.sentence) if (guardHit(g, s, known)) return g.why;
  for (let i = 0; i < T.length; i += 1) {
    const t = T[i];
    for (const g of TEXT_GUARDS.token) {
      if (g.id === 'list' && t.core === '그리고' && i === 0) continue;
      if (g.re.test(t.core)) return g.why;
    }
    if (t.josa === '와' || t.josa === '과') return '나열';
    if (t.core === '그리고' && i > 0) return '나열';
  }
  return '';
}

/** R19-1: 앞 문장을 취소하거나 되묻는 기호(❌ ✗ 🚫 ? ×…)만 있는 조각이면 글 전체의 맥락을 뒤집을 수 있다 */
const CANCEL_SYMBOL_RE = /[❌✗✘✖×🚫⛔👎🙅❓❔⁉‽?？]/u;

/**
 * 문장 하나를 모양을 보기 전에 거르는 판정(규칙 읽기와 Claude 읽기가 같이 쓴다).
 *  skip: 읽지 않는다 / why: 이유 / ctx: 앞 내용을 뒤집을 수 있는 문장이라 글 전체의 처음 체크를 풀어야 한다 / T: 낱말 목록(읽을 때 쓴다)
 * afterShort: 바로 앞 문장이 「Q.」「A.」 같은 한두 글자 머리 문장이었는가
 */
function sentenceVerdict(entry, afterShort, known, limits) {
  const { text: s, end } = entry;
  if (entry.symbol) return { skip: true, why: '기호', ctx: CANCEL_SYMBOL_RE.test(s), T: [] };
  if (s.length > limits.sentenceMax) return { skip: true, why: '너무 긴 문장', ctx: false, T: [] };
  if (end === '?' || end === '？' || /[?？‽⁈⁉]/.test(s)) return { skip: true, why: '물음', ctx: false, T: [] }; // 물음표로 끝난 문장은 질문이다
  if (afterShort) return { skip: true, why: '머리 문장 뒤', ctx: false, T: [] };
  const T = parseTokens(s);
  if (/^(?:농담|거짓|취소|철회|정정|사실이 아니)/.test(s)) return { skip: true, why: '앞 내용을 뒤집는 문장', ctx: true, T }; // 앞 내용을 뒤집는 문장
  const why = sentenceVeto(s, T, known);
  if (why) {
    // R18 D: 지도 이름이 없는 문장이 부정·시제·전언으로 걸리면 앞 내용을 뒤집는 문장일 수 있다 — 이 글의 연결은 처음에 하나도 체크하지 않는다
    const ctx = ['부정', '시제', '전해 들음·추측'].includes(why) && !known.labels.some((l) => nameInText(s, l));
    return { skip: true, why, ctx, T };
  }
  return { skip: false, why: '', ctx: false, T };
}

/**
 * 문장 목록(splitSentencesEnd 결과)을 차례로 판정한다 → 문장마다 {text, end, symbol?, skip, why, ctx, T}.
 * 「Q.」 같은 짧은 머리 문장 바로 뒤 문장은 읽지 않으므로 순서가 중요하다. 기호뿐인 조각은 그 흐름을 끊지 않는다
 */
export function classifySentences(sentences, known, limits = TEXT_LIMITS) {
  let shortHead = false;
  return sentences.map((entry) => {
    const afterShort = shortHead; // 「Q.」「A.」 같은 한두 글자 머리 문장 바로 뒤 문장은 읽지 않는다
    if (!entry.symbol) shortHead = entry.text.replace(/[:：]/g, '').length <= 2;
    return { ...entry, ...sentenceVerdict(entry, afterShort, known, limits) };
  });
}

/** 절을 끝내는 서술어(주어·이름 훑기를 여기서 멈춘다): 한다류·「이고/이며/으며/면서」·소속 꼬리·끝나/마치 */
const isClauseVerb = (t) => TEXT_WORDS.verbLike.test(t.core) || /(?:이고|이며|으며|면서)$/.test(t.core) || /^소속/.test(t.core) || /^(?:끝나|끝난|마치|마친)/.test(t.core) || /^(?:나서|난|뒤에?|후에?|다음에|이후에?)$/.test(t.core);

// ── 읽는 모양 표 ────────────────────────────────────────────────────────────
// 각 항목 run(sc)은 문장 한 개(sc.T = 낱말 목록)를 읽어 sc.node/sc.edge로 「쌓아 둔다」(문장을 다 읽은 뒤 한꺼번에 제안에 더한다).
// 모양에 안 맞으면 아무것도 쌓지 않고(sc.miss), 애매한 문장이면 sc.veto로 그 문장 전체를 버린다.
// sc.node는 이름 검사를 이미 통과한 것만 받는다. 연결의 유형 조합·방향은 finalizeProposal에서 PAIR_RULES로 검사한다.

/** 동사 꼬리 검사(R16-1): 현재형이면 true */
function performOk(T, i) {
  const c = T[i].core;
  if (TEXT_WORDS.performOk.test(c)) return true;
  if (c === '맡는' && T[i + 1] && TEXT_WORDS.progressTail.test(T[i + 1].core)) return true; // 「맡는 중이다」
  return TEXT_WORDS.performProgress.test(c) && !!T[i + 1] && TEXT_WORDS.progressTail.test(T[i + 1].core);
}

/** 「A는 X를 B는 Y를 맡는다」처럼 동사 없이 이어진 나열인가(R16-9): 주어(k) 앞에 목적어가 있고 그 사이에 절을 끝내는 낱말이 없으면 나열 */
function looksLikeList(T, k) {
  for (let m = k - 1; m >= 0; m -= 1) {
    if (!OBJ.has(T[m].josa)) continue;
    return !T.slice(m + 1, k).some((t) => /(?:고|며|서|면|데|지만|다|요|니다|음|함)$/.test(t.core));
  }
  return false;
}

function runPerformSV(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    if (!TEXT_WORDS.performVerb.test(T[i].core) || !OBJ.has(T[i - 1].josa)) continue;
    if (!performOk(T, i)) return sc.veto('동사 꼬리');
    const oe = i - 1;
    let k = oe - 1;
    // 주어를 찾아 거슬러 가다가 서술어(「끝나면」「마치고」「소속이고」 …)를 만나면 같은 절이 아니다 — 다른 모양(선후행·소속)이 읽는다
    while (k >= 0 && bare(T[k]) && !T[k].title && !isClauseVerb(T[k]) && oe - k <= TEXT_LIMITS.nameTokens) k -= 1;
    if (k >= 0 && isClauseVerb(T[k])) continue;
    if (k < 0 || !SUBJ.has(T[k].josa) || oe - k > TEXT_LIMITS.nameTokens) { sc.miss(); continue; }
    if (looksLikeList(T, k)) return sc.veto('나열');
    const who = personSpec(T[k], sc);
    const what = workSpec(phraseOf(T, k + 1, oe));
    if (!who || !what) { sc.miss(); continue; }
    sc.edge(sc.node(who), sc.node(what), 'performs');
    sc.use(k, i);
  }
  return undefined;
}

/** FU9-3: 「A는 X가 맡는다·담당한다」 — 대상(업무)이 앞에서 은/는, 사람이 이/가, 목적어(을/를) 없이 동사 */
function runPerformWS(sc) {
  const { T } = sc;
  for (let i = 2; i < T.length; i += 1) {
    if (!TEXT_WORDS.performVerb.test(T[i].core) || OBJ.has(T[i - 1].josa)) continue;
    const pj = T[i - 1].josa;
    if (pj !== '이' && pj !== '가') continue;
    const k = i - 2;
    if (T[k].josa !== '은' && T[k].josa !== '는') continue;
    if (!performOk(T, i)) { sc.miss(); continue; }
    const who = personSpec(T[i - 1], sc);
    const ys = backStart(T, k, TEXT_LIMITS.nameTokens);
    const what = workSpec(phraseOf(T, ys, k));
    if (!who || !what) { sc.miss(); continue; }
    sc.edge(sc.node(who), sc.node(what), 'performs');
    sc.use(ys, i);
  }
  return undefined;
}

const REFERENCE_DOC_SUFFIXES = ['지침', '규정', '매뉴얼', '가이드', '규칙', '기준'];

/** FU9-3: 「A에서 B를 참고한다」 — 업무 A가 문서(산출물처럼 끝나는 이름) B를 참조한다 */
function runReferenceDoc(sc) {
  const { T } = sc;
  for (let v = 2; v < T.length; v += 1) {
    if (!/^(?:참고|참조)/.test(T[v].core) || !OBJ.has(T[v - 1].josa)) continue;
    if (!/^(?:참고|참조)(?:한다|합니다|해요|하고|하며)$/.test(T[v].core)) { sc.miss(); continue; }
    const oe = v - 1;
    let k = oe - 1;
    while (k >= 0 && bare(T[k]) && !isClauseVerb(T[k]) && oe - k <= TEXT_LIMITS.nameTokens) k -= 1;
    if (k < 0 || isClauseVerb(T[k]) || !(T[k].josa === '에서' || T[k].josa === '에서는') || oe - k > TEXT_LIMITS.nameTokens) { sc.miss(); continue; }
    const ys = backStart(T, k, TEXT_LIMITS.nameTokens);
    const from = workSpec(phraseOf(T, ys, k));
    const bp = phraseOf(T, k + 1, oe);
    if (!from || !bp || hasDemonstrative(bp.label) || !(looksArtifact(bp.label) || endsWithAny(bp.label, REFERENCE_DOC_SUFFIXES))) { sc.miss(); continue; }
    sc.edge(sc.node(from), sc.node({ type: 'artifact', label: bp.label, ...(bp.alts.length ? { alts: bp.alts } : {}) }), 'references');
    sc.use(ys, v);
  }
  return undefined;
}

function runPerformVS(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length - 1; i += 1) {
    if (!(T[i].name === '담당' || T[i].name === '담당자') || !(SUBJ.has(T[i].josa) || T[i].colon)) continue;
    const x = T[i + 1];
    // R16-2: X 뒤에는 문장 끝이나 현재 이다류만(별도 낱말 「입니다」 포함)
    const tail = T.slice(i + 2);
    if (tail.length > 1 || (tail.length === 1 && !/^(?:이다|입니다|임|이에요|예요)$/.test(tail[0].core))) { sc.miss(); continue; }
    if (!['', ...SUBJ].includes(x.josa) || (TEXT_WORDS.verbLike.test(stripCopula(x.core)) && !x.emp_no)) { sc.miss(); continue; }
    if (!bare(T[i - 1])) { sc.miss(); continue; }
    const who = personSpec(x, sc);
    const ys = backStart(T, i - 1, TEXT_LIMITS.nameTokens);
    const what = workSpec(phraseOf(T, ys, i - 1, { strip: false }));
    if (!who || !what) { sc.miss(); continue; }
    sc.edge(sc.node(who), sc.node(what), 'performs');
    sc.use(ys, T.length - 1);
  }
}

function runProduce(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    if (!TEXT_WORDS.produceVerb.test(T[i].core) || !OBJ.has(T[i - 1].josa)) continue;
    if (!TEXT_WORDS.produceOk.test(T[i].core)) return sc.veto('동사 꼬리');
    const oe = i - 1;
    let k = oe - 1;
    while (k >= 0 && bare(T[k]) && !isClauseVerb(T[k]) && oe - k <= TEXT_LIMITS.nameTokens) k -= 1;
    if (k >= 0 && isClauseVerb(T[k])) continue;
    if (k < 0 || !DIR.has(T[k].josa) || oe - k > TEXT_LIMITS.nameTokens) { sc.miss(); continue; }
    const fs = backStart(T, k, TEXT_LIMITS.nameTokens);
    const from = workSpec(phraseOf(T, fs, k));
    const wp = phraseOf(T, k + 1, oe);
    if (!from || !wp || hasDemonstrative(wp.label)) { sc.miss(); continue; }
    // R17 E: 영문자뿐인 출처(ERP·SAP)는 지도에 같은 업무가 있을 때만 업무로 받는다(시스템 이름일 수 있다)
    if (/^[A-Za-z0-9 ._-]+$/.test(from.label) && !(sc.known && sc.known.work.has(normalizeLabel(from.label)))) { sc.miss(); continue; }
    sc.edge(sc.node(from), sc.node({ type: 'artifact', label: wp.label, ...(wp.alts.length ? { alts: wp.alts } : {}) }), 'produces');
    sc.use(fs, T[i + 1] && T[i + 1].core === '낸다' ? i + 1 : i); // 「만들어 낸다」
  }
  return undefined;
}

/** 「앞 일 → 뒤 일」 두 업무를 잇는다. 앞 일 끝 낱말 yEnd, 뒤 일은 laterWork(T, zStart) */
function precede(sc, yEnd, zStart) {
  const { T } = sc;
  if (isClauseVerb(T[yEnd])) return sc.miss(); // 앞 일의 끝이 서술어(「하고」)이면 일 이름이 아니다
  const ys = backStart(T, yEnd, TEXT_LIMITS.nameTokens);
  const y = workSpec(phraseOf(T, ys, yEnd));
  const zr = laterWork(T, zStart);
  if (zr.veto) return sc.veto(zr.veto);
  const z = zr.work;
  if (!y || !z || normalizeLabel(y.label) === normalizeLabel(z.label)) return sc.miss();
  sc.edge(sc.node(y), sc.node(z), 'precedes');
  sc.use(ys, zr.tail >= 0 ? zr.tail : zr.end);
  return undefined;
}

function runPrecedesA(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    const c = T[i].core;
    const ye = T[i - 1];
    if (/^(끝나면|끝나면은|끝나고|끝나자)$/.test(c)) {
      if ([...SUBJ, ''].includes(ye.josa) || ye.weak) precede(sc, i - 1, i + 1);
      else sc.miss();
    } else if (c === '끝난' && T[i + 1] && /^(뒤에?|후에?)$/.test(T[i + 1].core)) {
      if ([...SUBJ, ''].includes(ye.josa) || ye.weak) precede(sc, i - 1, i + 2);
      else sc.miss();
    } else if (/^(다음에|뒤에|후에|이후에)$/.test(c) && !['끝난', '마친', '난'].includes(ye.core) && (['', '의'].includes(ye.josa) || ye.weak)) {
      precede(sc, i - 1, i + 1);
    }
    if (sc.vetoed) return;
  }
}

function runPrecedesB(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    const c = T[i].core;
    if (!OBJ.has(T[i - 1].josa)) continue;
    if (/^(마치면|마치면은|마치고)$/.test(c)) precede(sc, i - 1, i + 1);
    else if (c === '마친' && T[i + 1] && /^(뒤에?|후에?)$/.test(T[i + 1].core)) precede(sc, i - 1, i + 2);
    else if (c === '하고' && T[i + 1] && /^나서는?$/.test(T[i + 1].core)) precede(sc, i - 1, i + 2);
    else if (c === '하고' && T[i + 1] && T[i + 1].core === '난' && T[i + 2] && /^(뒤에?|후에?)$/.test(T[i + 2].core)) precede(sc, i - 1, i + 3);
    if (sc.vetoed) return;
  }
}

/** 사람(또는 조직) X가 조직 T에 속한다. x는 낱말 */
function belong(sc, x, orgLabel) {
  const xLabel = cleanName(stripCopula(x.name));
  if (!xLabel || !orgLabel || normalizeLabel(xLabel) === normalizeLabel(orgLabel) || looksArtifact(xLabel)) return sc.miss();
  const xs = looksOrg(xLabel) ? { type: 'org', label: xLabel } : personSpec(x, sc);
  if (!xs) return sc.miss();
  sc.edge(sc.node(xs), sc.node({ type: 'org', label: orgLabel }), 'belongs_to');
  return undefined;
}

function runBelongsA(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    if (!T[i].core.startsWith('소속') || !bare(T[i - 1])) continue;
    if (!TEXT_WORDS.belongOk.test(T[i].core)) return sc.veto('동사 꼬리');
    const ta = backStart(T, i - 1, 3);
    const org = (phraseOf(T, ta, i - 1, { strip: false }) || {}).label || '';
    if (!looksOrg(org)) { sc.miss(); continue; }
    const k = ta - 1;
    if (k >= 0 && SUBJ.has(T[k].josa)) {
      belong(sc, T[k], org);
      sc.use(k, i);
    } else if (T[i + 1] && (SUBJ.has(T[i + 1].josa) || T[i + 1].emp_no || T[i + 1].titled) && !TEXT_WORDS.verbLike.test(T[i + 1].core)) {
      belong(sc, T[i + 1], org);
      sc.use(ta, i + 1); // 소속 모양이 실제로 쓴 낱말만(뒤의 서술은 쓰이지 않은 낱말이라 문장을 읽지 않는다)
    } else sc.miss();
  }
  return undefined;
}

function runBelongsB(sc) {
  const { T } = sc;
  for (let i = 0; i < T.length - 1; i += 1) {
    if (T[i].josa !== '의' || !looksOrg(T[i].name)) continue;
    const x = T[i + 1];
    if (!(SUBJ.has(x.josa) || x.emp_no || x.titled)) continue;
    const org = (phraseOf(T, backStart(T, i, 2), i) || {}).label;
    if (!org) { sc.miss(); continue; }
    belong(sc, x, org);
    sc.use(i, i + 1);
  }
}

/** 문장에서 참조 동사를 찾는다 → 낱말 번호 | -1(없음) | -2(참조 동사로 보이지만 현재형이 아님) */
function referenceVerbAt(T, i) {
  for (let j = i + 1; j < T.length; j += 1) {
    const c = T[j].core;
    if (!TEXT_WORDS.referenceVerb.test(c)) continue;
    if (OBJ.has(T[j].josa)) continue; // 「보고를」 같은 명사
    if (TEXT_WORDS.referenceOk.test(c)) return j;
    if (j === T.length - 1 && TEXT_WORDS.referenceNoun.test(c)) return j;
    return -2;
  }
  return -1;
}

/** R16-7: 앞 문장의 업무를 쓰려면 이 문장에 사람(과 앞의 조직 이름)·동사·부사·일반 목적어(결과·내용 …) 밖의 말이 없어야 한다 */
function onlyGenericAround(T, i, vi) {
  const rest = [];
  for (let j = 0; j < T.length; j += 1) {
    if (j === i || j === vi) continue;
    if (j === i - 1 && bare(T[j]) && looksOrg(T[j].core)) continue;
    if (TEXT_WORDS.referenceAdverbs.includes(T[j].core)) continue;
    rest.push(T[j].core);
  }
  const phrase = rest.join(' ');
  return phrase === '' || TEXT_WORDS.genericObject.test(phrase);
}

/**
 * T1(a): 「X에게 <업무 이름> 결과를 공유한다」·「<업무 이름> 결과를 X에게 공유한다」 — 대상·동사·앞 조직 이름·부사를 뺀 나머지가 「지도에 있는 업무 이름 + 결과·내용·현황」뿐이면 그 업무.
 * 나머지 낱말은 서로 이어져 있고 대상(X에게)의 한쪽에만 있어야 한다. 업무 이름이 지도에 없으면 읽지 않는다(없는 업무를 지어내지 않는다)
 * → {label, idxs(쓴 낱말 번호)} | null
 */
function namedWorkAround(T, i, vi, known) {
  if (!known || !known.work || !known.work.size) return null;
  const idxs = [];
  for (let j = 0; j < T.length; j += 1) {
    if (j === i || j === vi) continue;
    if (j === i - 1 && bare(T[j]) && looksOrg(T[j].core)) continue;
    if (TEXT_WORDS.referenceAdverbs.includes(T[j].core)) continue;
    idxs.push(j);
  }
  if (idxs.length < 2) return null;
  if (idxs.some((j, k) => k > 0 && j !== idxs[k - 1] + 1)) return null; // 이어진 낱말만
  if (idxs[0] < i !== idxs[idxs.length - 1] < i) return null; // 대상(X에게)의 한쪽에만
  const m = TEXT_WORDS.workResultTail.exec(idxs.map((j) => T[j].core).join(' '));
  if (!m) return null;
  const g = m[1].replace(/\s+/g, ' ');
  for (const c of [g, g.replace(/의$/, ''), stripWorkTail(g), stripWorkTail(g.replace(/의$/, ''))]) {
    if (c && known.work.has(normalizeLabel(c))) return { label: c, idxs };
  }
  return null;
}

function runReference(sc) {
  const { T } = sc;
  let found = false;
  for (let i = 0; i < T.length; i += 1) {
    // 「X에게」, 또는 대상이 조직 끝말이면 「감사팀에」도 받는다
    const orgEe = T[i].josa === '' && /에$/.test(T[i].core) && looksOrg(T[i].core.slice(0, -1));
    if (!TO_PERSON.has(T[i].josa) && !orgEe) continue;
    const vi = referenceVerbAt(T, i);
    if (vi === -2) return sc.veto('동사 꼬리');
    if (vi < 0) continue;
    found = true;
    const label = cleanName(orgEe ? T[i].core.slice(0, -1) : T[i].name);
    if (!label || looksArtifact(label)) { sc.miss(); continue; }
    let spec;
    if (looksOrg(label)) {
      const org = orgEe ? label : (phraseOf(T, backStart(T, i, 2), i) || {}).label;
      spec = { type: 'org', label: org || label };
    } else spec = personSpec(T[i], sc);
    if (!spec) { sc.miss(); continue; }
    // 업무: 이 문장에서 읽은 업무가 하나뿐이면 그것, 없으면 바로 앞 문장이 읽혔고 그 업무가 하나일 때만(R16-7)
    const works = sc.nodes.filter((n) => n.type === 'work' && !n.carried);
    let work;
    const named = works.length === 0 ? namedWorkAround(T, i, vi, sc.known) : null;
    if (works.length === 1) [work] = works;
    else if (named) {
      work = sc.node({ type: 'work', label: named.label }); // T1(a): 업무 이름이 문장에 있고 지도에도 있다
      for (const q of named.idxs) sc.use(q);
    } else if (works.length === 0 && sc.prev && sc.prev.works.length === 1 && onlyGenericAround(T, i, vi)) work = sc.node({ type: 'work', label: sc.prev.works[0].label, carried: true });
    else {
      // T1(c): 업무 이름 없이 「결과를」 같은 일반 목적어만 있고 앞 문장 업무로도 정할 수 없다(둘 이상이거나 없음) → 이유를 알려 준다
      if (works.length === 0 && onlyGenericAround(T, i, vi) && T.some((t, j) => j !== i && j !== vi && TEXT_WORDS.genericObject.test(t.core))) {
        sc.reason = unreadWhichWorkWhy(sc.prev && sc.prev.works.length ? sc.prev.works[0].label : '', spec.label);
      }
      sc.miss();
      continue;
    }
    // T1(b): 「감사팀 백서진에게」의 앞 조직 낱말은 허용 낱말로만 쓴다(소속 연결·조직 항목은 만들지 않는다 — 예시 글(감사팀 도하람에게 …)의 기존 결과와 같게. CR 후보: docs/decisions-pending)
    sc.edge(work, sc.node(spec), 'references');
    // 쓴 낱말: 대상(과 앞의 조직 이름)·동사, 그 사이의 일반 목적어·부사뿐(대상~동사 사이 전체를 쓴 것으로 치지 않는다)
    sc.use(i > 0 && bare(T[i - 1]) && looksOrg(T[i - 1].core) ? i - 1 : i, i);
    sc.use(vi);
    for (let q = i + 1; q < vi; q += 1) if (TEXT_WORDS.referenceAdverbs.includes(T[q].core) || TEXT_WORDS.genericObject.test(T[q].core)) sc.use(q);
    if (work.carried) sc.use(0, vi); // 앞 문장의 업무를 이어받은 문장은 (결과·내용 같은) 일반 목적어와 부사뿐이므로 앞쪽 낱말도 모두 쓴 것이다
  }
  // R17 S1: 현재형 참조 동사(공유한다·문의합니다 …)가 있는데 대상(X에게)을 찾지 못했다 → 일부만 읽음
  if (!found) {
    const vj = referenceVerbAt(T, -1);
    if (vj >= 0 && !sc.used.has(vj)) sc.miss();
  }
  return undefined;
}

function runEmpNo(sc) {
  sc.T.forEach((t, i) => {
    if (!t.emp_no) return;
    const spec = personSpec(t, sc);
    if (spec) {
      sc.node(spec);
      sc.use(i);
    }
  });
}

/** 읽는 모양 표. 순서가 곧 읽는 순서다(참조는 같은 문장의 업무를 먼저 알아야 하므로 맨 뒤쪽) */
export const TEXT_PATTERNS = Object.freeze([
  { id: 'perform_sv', run: runPerformSV },
  { id: 'perform_ws', run: runPerformWS },
  { id: 'perform_vs', run: runPerformVS },
  { id: 'produce', run: runProduce },
  { id: 'precedes_a', run: runPrecedesA },
  { id: 'precedes_b', run: runPrecedesB },
  { id: 'belongs_a', run: runBelongsA },
  { id: 'belongs_b', run: runBelongsB },
  { id: 'reference', run: runReference },
  { id: 'reference_doc', run: runReferenceDoc },
  { id: 'emp_no', run: runEmpNo },
]);

/** 문장 하나를 읽는 작업대: 항목·연결을 쌓아 두었다가 문장을 다 읽고 버리지 않을 때만 제안에 더한다 */
function makeScope(s, T, prev, known) {
  const sc = {
    s, T, prev, known, nodes: [], edges: [], vetoed: '', missed: false, reason: '', used: new Set(),
    node(spec) {
      let n = sc.nodes.find((x) => x.type === spec.type && normalizeLabel(x.label) === normalizeLabel(spec.label));
      if (!n) {
        n = { ...spec };
        sc.nodes.push(n);
      }
      return n;
    },
    edge(a, c, type) {
      if (!a || !c || a === c || sc.edges.some((e) => e.a === a && e.b === c && e.type === type)) return null;
      const e = { a, b: c, type };
      sc.edges.push(e);
      return e;
    },
    veto(why) { if (!sc.vetoed) sc.vetoed = why; },
    miss() { sc.missed = true; },
    /** 읽는 데 쓴 낱말 번호(a..b) */
    use(a, b = a) { for (let j = Math.max(0, a); j <= b; j += 1) sc.used.add(j); },
    /** R18 허용 목록: 읽은 모양에 쓰이지 않았고 허용된 말도 아닌 첫 낱말(없으면 ''). 허용: 이음말·지금은/요즘/현재·개조식 머리·마지막으로 쓴 낱말 뒤의 이다류/있다류 꼬리 */
    unusedWord() {
      const last = Math.max(...sc.used);
      for (let j = 0; j < T.length; j += 1) {
        if (sc.used.has(j)) continue;
        const t = T[j];
        if ((TEXT_WORDS.leading.includes(t.core) && !TEXT_WORDS.contextWords.includes(t.core)) || TEXT_WORDS.allowedWords.includes(t.core) || TEXT_WORDS.listHead.test(t.raw)) continue;
        if (j > last && TEXT_WORDS.trailOk.test(t.core)) continue;
        return t.core;
      }
      return '';
    },
    commit(b) {
      const real = new Map();
      for (const n of sc.nodes) {
        const { carried, ...spec } = n;
        real.set(n, b.addNode(spec, s));
      }
      for (const e of sc.edges) b.addEdge(real.get(e.a), real.get(e.b), e.type, s);
      return { works: [...new Set(sc.nodes.filter((n) => n.type === 'work' && !n.carried).map((n) => real.get(n)).filter(Boolean))] };
    },
  };
  return sc;
}

// ── 지금 지도와 맞대기 ──────────────────────────────────────────────────────

/** 묶은 지도(하위 지도를 묶은 지도)인가: 새 항목은 이 문서에만 만들 수 있어 글로 추가를 쓰지 않는다(R16-11) */
export const isGroupedView = (view) => !!(view && Array.isArray(view.ref_links) && view.ref_links.length > 0);

/** 지금 지도(view)의 이 유니버스 항목들(숨김·삭제·꼭지 제외). 새 항목은 이 문서에만 만들 수 있으므로 하위 지도의 항목은 맞대지 않는다 */
export function ownCandidates(view) {
  if (!view || !Array.isArray(view.raw_nodes)) return [];
  return view.raw_nodes
    .filter((n) => n.universe_id === view.universe_id && !n.hidden && !n.deleted && n.core_type !== 'root')
    .map((n) => ({ id: n.id, gid: n.gid, core_type: n.core_type, label: String(n.label ?? ''), emp_no: n.emp_no || '' }));
}

/** 문서(doc)의 항목들(ownCandidates와 같은 모양) */
export function docCandidates(doc) {
  return (doc.nodes || [])
    .filter((n) => !n.hidden && !n.deleted && n.core_type !== 'root')
    .map((n) => ({ id: n.id, gid: '', core_type: n.core_type, label: String(n.label ?? ''), emp_no: n.emp_no || '' }));
}

/**
 * 같은 사번(사람, 이름도 같을 때) 또는 같은 유형·이름(공백 무시)의 항목이 하나뿐이면 hit. 둘 이상이면 ambiguous.
 * 사번은 같은데 이름이 다르면 같은 사람으로 잇지 않는다(R16-6): empMismatch(그 사람)로 알린다.
 * 글에 사번이 있는데 같은 이름의 사람이 다른 사번이면 다른 사람이므로 맞대지 않는다. adopt: 유형이 확실하지 않은 이름은 다른 유형이라도 같은 이름 하나면 그 항목으로(유형을 따라간다)
 * @returns {{hit?:object, ambiguous?:boolean, empMismatch?:object}}
 */
export function findMatch(cands, { type, label, emp_no = '', adopt = false }) {
  const key = normalizeLabel(label);
  if (type === 'person' && emp_no) {
    const e = normalizeEmpNo(emp_no);
    const hs = cands.filter((c) => c.core_type === 'person' && c.emp_no && normalizeEmpNo(c.emp_no) === e);
    if (hs.length === 1) return normalizeLabel(hs[0].label) === key ? { hit: hs[0] } : { empMismatch: hs[0] };
    if (hs.length > 1) return { ambiguous: true };
  }
  const sameName = cands.filter((c) => normalizeLabel(c.label) === key);
  const ok = (c) => !(type === 'person' && emp_no && c.core_type === 'person' && c.emp_no && normalizeEmpNo(c.emp_no) !== normalizeEmpNo(emp_no));
  const same = sameName.filter((c) => c.core_type === type && ok(c));
  if (same.length === 1) return { hit: same[0] };
  if (same.length > 1) return { ambiguous: true };
  if (adopt) {
    const any = sameName.filter((c) => c.core_type !== type);
    if (any.length === 1) return { hit: any[0] };
    if (any.length > 1) return { ambiguous: true };
  }
  return {};
}

/** 관계 방향: a→b로 되면 'forward', b→a로만 되면 'backward', 안 되면 null */
export function orientRelation(type, aType, bType) {
  if (pairAllowed(type, aType, bType)) return 'forward';
  if (pairAllowed(type, bType, aType)) return 'backward';
  return null;
}

/** 같은 연결이 이미 있는가(숨김 제외, 수행은 끝나지 않은 담당만) */
const edgeIn = (edges, src, tgt, type) => edges.some((e) => !e.hidden && e.source === src && e.target === tgt && e.core_type === type && !(type === 'performs' && e.period && e.period.end));

/**
 * 제안을 지금 지도와 맞댄다(규칙 읽기와 AI 읽기가 같이 쓴다).
 *  - 항목: match(지도의 gid)·match_label. 지도에서 찾을 때는 조사를 뗀 이름과 떼지 않은 이름(alts) 둘 다 본다. 유형이 확실하지 않던 이름이 다른 유형의 항목과 맞으면 그 유형을 따라간다(unsure 해제).
 *    같은 이름이 둘 이상이면 ambiguous + notes
 *  - hold(처음 체크 해제 + notes): 사번은 같은데 이름이 다름(R16-6)·같은 이름의 다른 사번 사람이 있음·지도에 같은 이름이 다른 유형으로 있음(R16-12)·글에서 한 이름이 서로 다른 유형으로 읽힘(R16-3)
 *  - 연결: 두 항목 유형에 PAIR_RULES가 맞을 때만 둔다(반대 방향만 맞으면 뒤집는다). 안 맞으면 빼고 notes. 두 끝이 지도에 이미 있고 같은 연결이 있으면 exists. hold 항목에 걸린 연결은 hold
 * view가 없으면(null) 맞대지 않고 방향 검사만 한다.
 */
export function finalizeProposal(proposal, view) {
  const notes = [...(proposal.notes || [])];
  const cands = ownCandidates(view);
  const nodes = proposal.nodes.map((n) => {
    const out = { ...n };
    delete out.ambiguous;
    delete out.hold;
    delete out.alts;
    delete out.conflict;
    const look = (label) => findMatch(cands, { type: n.type, label, emp_no: n.emp_no || '', adopt: !!n.unsure });
    let m = look(n.label);
    for (const alt of n.alts || []) {
      const m2 = look(alt);
      if (!m2.hit) continue;
      if (!m.hit && !m.ambiguous && !m.empMismatch) {
        m = m2;
        out.label = alt;
      } else if (m.hit && m.hit.gid !== m2.hit.gid) m = { ambiguous: true };
      break;
    }
    let hold = '';
    if (m.hit) {
      out.match = m.hit.gid;
      out.match_label = m.hit.label;
      if (m.hit.core_type !== n.type) out.type = m.hit.core_type;
      if (out.type !== 'person') delete out.emp_no;
      delete out.unsure;
    } else {
      out.match = null;
      delete out.match_label;
      const key = normalizeLabel(out.label);
      if (m.empMismatch) hold = `사번은 「${m.empMismatch.label}」과 같고 이름이 다릅니다`;
      else if (n.type === 'person' && n.emp_no) {
        const clash = cands.find((c) => c.core_type === 'person' && normalizeLabel(c.label) === key && c.emp_no && normalizeEmpNo(c.emp_no) !== normalizeEmpNo(n.emp_no));
        if (clash) hold = `지도에 같은 이름의 사람(사번 ${clash.emp_no})이 있습니다 — 다른 사람인지 확인`;
      }
      // R18 F: 지도에 공백·괄호 차이만 다른 이름(대사확인↔대사 확인, 보고(report)↔보고)이 있으면 새로 만들지 않고 그 항목에 잇되 같은 항목인지 확인(hold)
      if (!hold && !m.ambiguous) {
        const sq = (x) => normalizeLabel(x).replace(/\([^)]*\)/g, '').replace(/\s+/g, '');
        const like = cands.filter((c) => c.core_type === n.type && sq(c.label) === sq(out.label) && normalizeLabel(c.label) !== key);
        if (like.length === 1) {
          out.match = like[0].gid;
          out.match_label = like[0].label;
          out.label = like[0].label;
          hold = `지도의 「${like[0].label}」과 같은 항목인지 확인`;
        }
      }
      if (!hold && !n.unsure && !m.ambiguous) {
        const other = cands.find((c) => c.core_type !== n.type && normalizeLabel(c.label) === key);
        if (other) hold = `지도에는 ${typeName(other.core_type)}${euro(typeName(other.core_type))} 있음`;
      }
    }
    if (m.ambiguous) {
      out.ambiguous = true;
      notes.push(`「${n.label}」: 지도에 같은 이름의 항목이 둘 이상 있어 어느 쪽인지 정하지 못했습니다(체크하면 새 항목으로 만듭니다)`);
    }
    if (!hold && n.conflict) hold = `글에서 서로 다른 유형(${n.conflict})으로 읽혔습니다`;
    if (hold) {
      out.hold = hold;
      notes.push(`「${out.label}」: ${hold}`);
    }
    return out;
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edges = [];
  const viewEdges = view && Array.isArray(view.edges) ? view.edges.filter((e) => e.universe_id === view.universe_id).map((e) => ({ source: e.source, target: e.target, core_type: e.core_type, hidden: e.hidden, period: e.period })) : [];
  for (const e of proposal.edges) {
    const a = byKey.get(e.from);
    const b = byKey.get(e.to);
    if (!a || !b) continue;
    const dir = orientRelation(e.type, a.type, b.type);
    if (!dir) {
      notes.push(`연결 「${a.label} — ${b.label}」(${relName(e.type)})은 두 항목의 유형(${typeName(a.type)}·${typeName(b.type)})에 맞지 않아 뺐습니다`);
      continue;
    }
    const [from, to] = dir === 'forward' ? [a, b] : [b, a];
    const out = { key: e.key, from: from.key, to: to.key, type: e.type, quote: e.quote, ...(e.verb ? { verb: e.verb } : {}) };
    // 연결 자체의 확인 사유(문자열, 예: Claude 읽기에서 인용이 든 원문 문장에 부정·조건이 있음)가 먼저, 없으면 끝 항목의 hold(true)
    if (typeof e.hold === 'string' && e.hold) out.hold = e.hold;
    else if (a.hold || b.hold) out.hold = true;
    if (from.match && to.match) {
      const c = (g) => (view && view.canonical ? view.canonical(g) : g);
      if (edgeIn(viewEdges, c(from.match), c(to.match), e.type)) out.exists = true;
    }
    edges.push(out);
  }
  return { ...proposal, nodes, edges, notes };
}

// ── 이름 찾기(낱말 경계) ────────────────────────────────────────────────────

const JOSA_ALL = [...JOSA, ...JOSA_EXTRA].sort((a, b) => b.length - a.length);

/** 이름 뒤가 낱말 끝인가: 끝·글자가 아닌 것(공백·부호) · (직함) + 조사 + 끝 · 이다류 */
function wordEndOk(rest) {
  let r = rest;
  if (!r || !LETTER_RE.test(r[0])) return true;
  r = r.replace(/^(?:님|씨)/, '');
  if (!r || !LETTER_RE.test(r[0])) return true;
  if (/^(?:이다|입니다|이에요|예요|이며|이고)(?![\p{L}\p{N}])/u.test(r)) return true;
  return JOSA_ALL.some((j) => r.startsWith(j) && (r.length === j.length || !LETTER_RE.test(r[j.length])));
}

/**
 * 글에 이름이 낱말로 있는가(R16-10): 앞이 글 시작·공백·부호이고 뒤가 조사·공백·부호·끝이다.
 * 「서하늘」 안의 「하늘」, 「보고서」 안의 「보고」는 없는 것으로 본다. 공백은 하나로 보고 대소문자는 무시한다
 */
export function nameInText(text, name) {
  const norm = (x) => oneLine(String(x).normalize('NFC')).toLowerCase();
  const hay = norm(text);
  const n = norm(name);
  if (!n) return false;
  for (let from = 0; ;) {
    const idx = hay.indexOf(n, from);
    if (idx < 0) return false;
    from = idx + 1;
    if (idx > 0 && LETTER_RE.test(hay[idx - 1])) continue;
    if (wordEndOk(hay.slice(idx + n.length))) return true;
  }
}

/** 글에 「이름(사번)」 꼴로 사번이 그 이름 바로 뒤에 있는가(R16-6, AI 읽기) */
export function empNoAfterName(text, name, empNo) {
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(oneLine(name))}\\s*\\(\\s*${esc(String(empNo).trim())}\\s*\\)`, 'iu');
  return re.test(String(text).normalize('NFC'));
}

// ── 글 → 제안 ───────────────────────────────────────────────────────────────

const emptyProposal = (notes) => ({ method: 'rule', nodes: [], edges: [], unread: [], unreadWhy: [], partial: [], notes });

/** 상한·잘림 안내를 notes에 더한다(규칙 읽기와 AI 읽기가 같은 문구를 쓴다) */
export function capNotes(flags, limits = TEXT_LIMITS) {
  const notes = [];
  if (flags.nodesCapped) notes.push(`항목이 너무 많아 앞의 ${limits.maxNodes}개만 담았습니다. 글을 나누어 넣으세요`);
  if (flags.edgesCapped) notes.push(`연결이 너무 많아 앞의 ${limits.maxEdges}개만 담았습니다. 글을 나누어 넣으세요`);
  return notes;
}

/** 글이 읽을 수 있는 크기인가 → null이면 통과, 아니면 notes에 쓸 안내 */
export function textSizeNote(text, limits = TEXT_LIMITS) {
  if (typeof text !== 'string' || !text.trim()) return '읽을 글이 비어 있습니다';
  if (text.length > limits.maxChars) return `글이 너무 깁니다(${limits.maxChars.toLocaleString()}자 이하로 나누어 넣으세요)`;
  return null;
}

/** 지도에 있는 사람 이름(공백·대소문자 무시): 한글 세 글자가 아니어도 이 이름이면 사람으로 받는다 */
export const knownNames = (view) => {
  const c = ownCandidates(view);
  return {
    person: new Set(c.filter((x) => x.core_type === 'person').map((x) => normalizeLabel(x.label))),
    work: new Set(c.filter((x) => x.core_type === 'work').map((x) => normalizeLabel(x.label))),
    labels: c.map((x) => x.label),
  };
};

/**
 * R21: 모양에 맞지 않는 문장의 이유. 「X이/가 Z를 만든다」(사람 등 업무가 아닌 것이 산출물을 만듦)는 스키마상 이을 수 없으므로 쓰는 법을 알려 준다
 * (산출은 업무 → 산출물만). 그 밖은 「모양 밖」
 */
function shapeWhy(T) {
  for (let i = 1; i < T.length; i += 1) {
    if (!TEXT_WORDS.produceVerb.test(T[i].core) || !OBJ.has(T[i - 1].josa)) continue;
    const oe = i - 1;
    let k = oe - 1;
    while (k >= 0 && bare(T[k]) && !isClauseVerb(T[k]) && oe - k <= TEXT_LIMITS.nameTokens) k -= 1;
    if (k < 0 || !SUBJ.has(T[k].josa) || oe - k > TEXT_LIMITS.nameTokens) continue;
    const z = phraseOf(T, k + 1, oe);
    if (!z) continue;
    return `사람이 만든 산출물은 이을 수 없습니다 — 「업무 이름에서 ${z.label}${eulReul(z.label)} 만든다」처럼 업무를 넣어 쓰세요`;
  }
  return TEXT_UNREAD_SHAPE_WHY;
}

/**
 * 줄글을 읽어 항목·연결 제안을 만든다. 모양(TEXT_PATTERNS)에 안 맞거나 애매한 문장은 unread에 둔다(지어내지 않는다).
 * 이름은 읽었는데 모양을 다 읽지 못한 문장(사번만 읽은 문장, 일부 모양이 빠진 문장)도 unread에 두고 partial에 표시한다(R16-5).
 * @param {string} text 붙여 넣은 글
 * @param {object|null} view 지금 지도(buildView 결과). 있으면 같은 이름·사번의 항목은 새로 만들지 않고 match로 잇는다. 묶은 지도면 읽지 않는다
 * @param {{limits?:object}} [opt]
 * @returns {{method:'rule', nodes:object[], edges:object[], unread:string[], partial:string[], notes:string[]}}
 *   nodes[]: {key, type, label, emp_no?, quote, match:gid|null, match_label?, unsure?, ambiguous?, hold?}, edges[]: {key, from, to, type, quote, exists?, hold?}
 */
export function extractFromText(text, view = null, opt = {}) {
  const limits = { ...TEXT_LIMITS, ...(opt.limits || {}) };
  const size = textSizeNote(text, limits);
  if (size) return emptyProposal([size]);
  if (isGroupedView(view)) return emptyProposal([TEXT_GROUPED_NOTE]);
  const notes = [];
  let sentences = splitSentencesEnd(text);
  let truncated = false;
  if (sentences.length > limits.maxSentences) {
    notes.push(`문장이 ${sentences.length}개라 앞의 ${limits.maxSentences}개만 읽었습니다`);
    sentences = sentences.slice(0, limits.maxSentences);
    truncated = true; // R19-2: 잘린 뒤쪽에 앞 내용을 뒤집는 문장이 있을 수 있다
  }
  const b = createBuilder(limits);
  const known = knownNames(view);
  const unread = [];
  const unreadWhy = []; // R21: unread와 같은 순서의 이유(쉬운 말)
  const partial = [];
  let ctxVeto = false;
  let prev = null; // 바로 앞 문장이 온전히 읽혔을 때만 {works}
  for (const v of classifySentences(sentences, known, limits)) {
    const { text: s, T } = v;
    const skip = (why) => { unread.push(s); unreadWhy.push(why); prev = null; };
    if (v.ctx) ctxVeto = true;
    if (v.skip) { skip(unreadWhyText(v.why)); continue; }
    const sc = makeScope(s, T, prev, known);
    for (const p of TEXT_PATTERNS) {
      p.run(sc);
      if (sc.vetoed) break;
    }
    if (!sc.vetoed && sc.edges.length && sc.unusedWord()) sc.veto('쓰이지 않은 낱말'); // R18 허용 목록(앞·사이·뒤 어디든 남으면 문장 전체)
    if (sc.vetoed || !sc.nodes.length) { skip(sc.vetoed ? unreadWhyText(sc.vetoed) : (sc.reason || shapeWhy(T))); continue; }
    const real = sc.commit(b);
    if (!sc.edges.length || sc.missed) {
      unread.push(s);
      const sw = sc.edges.length ? TEXT_UNREAD_SHAPE_WHY : shapeWhy(T); // 연결이 하나도 없으면 모양 밖의 이유(사람이 만든 산출물 등)가 있는지 본다
      unreadWhy.push(sc.reason || (sw === TEXT_UNREAD_SHAPE_WHY ? TEXT_UNREAD_PARTIAL_WHY : sw));
      partial.push(s);
      prev = null;
    } else prev = { works: real.works };
  }
  notes.push(...capNotes(b.flags, limits));
  if (ctxVeto && b.edges.length) notes.push('글에 앞 내용을 뒤집는 문장이 있어 처음 체크를 모두 풀었습니다');
  // R19 ①: 읽지 못한 문장(기호뿐인 줄, 문장 수 상한으로 잘린 뒷부분 포함)이 있는 글에서는 앞뒤 문장이 읽은 문장의 뜻을 바꿀 수 있다 — 'existing-only'에서도 연결을 처음 체크하지 않는다
  const unreadContext = (unread.length > 0 || truncated) && b.edges.length > 0;
  if (unreadContext) notes.push(TEXT_UNREAD_CONTEXT_NOTE);
  const proposal = { method: 'rule', nodes: b.nodes, edges: b.edges, unread, unreadWhy, partial, notes, ctxVeto, unreadContext };
  return finalizeProposal(proposal, view);
}

// ── 사용자가 고른 것 → 명령 ─────────────────────────────────────────────────

/**
 * 처음 선택(R17, R19): 기본 mode는 TEXT_DEFAULT_CHECK('none' — 아무것도 체크하지 않음). 'existing-only'(「지도에 있는 것만 체크」)는 지도에 이미 있는 항목(match)과, 두 끝이 모두 지도에 있는 연결만 체크한다. 새로 만드는 항목(사번이 글에 있는 사람 포함)과
 * 새 항목이 한쪽 끝인 연결은 사람이 이름이 맞는지 보고 체크한다. 어느 모드에서나 같은 이름이 둘 이상인 항목·확인할 것이 있는 항목(hold)·이미 있는 연결·hold 항목에 걸린 연결은 체크하지 않는다.
 * mode 'all'은 위 예외만 빼고 모두 체크한다(화면의 「모두 체크」).
 */
export function defaultSelection(proposal, mode = TEXT_DEFAULT_CHECK) {
  const nodes = {};
  const edges = {};
  const matched = new Map(proposal.nodes.map((n) => [n.key, !!n.match]));
  const quoteOf = new Map(proposal.nodes.map((n) => [n.key, n.quote]));
  const none = mode === 'none';
  const existing = mode === 'existing-only';
  const part = new Set(proposal.partial || []); // R18 C: 일부만 읽은 문장의 항목·연결은 체크하지 않는다
  // 'all'도 hold·같은 이름 둘·이미 있는 연결·일부만 읽은 문장·뒤집는 문장이 있는 글(ctxVeto)은 체크하지 않는다. 'existing-only'는 거기에 더해 지도에 있는 것만, 읽지 못한 문장이 있는 글(unreadContext)은 연결을 체크하지 않는다
  for (const n of proposal.nodes) nodes[n.key] = { include: !none && !n.ambiguous && !n.hold && !part.has(n.quote) && (!existing || !!n.match), type: n.type, label: n.label, emp_no: n.emp_no || '' };
  for (const e of proposal.edges) {
    // R21: 지도에 있는 항목(match, hold 아님)은 resolveSelection이 늘 연결의 끝으로 쓴다. 그래도 끝 항목이 일부만 읽은 문장에서 나왔으면(예전에는 항목 체크가 풀려 연결이 막혔다) 처음 체크에서는 그대로 뺀다
    const endsOk = !part.has(quoteOf.get(e.from)) && !part.has(quoteOf.get(e.to));
    edges[e.key] = { include: !none && !e.exists && !e.hold && !part.has(e.quote) && !proposal.ctxVeto && endsOk && (!existing || (matched.get(e.from) && matched.get(e.to) && !proposal.unreadContext)), type: e.type };
  }
  return { nodes, edges };
}

/**
 * R21: 「지도에 있는 항목끼리 연결 체크」('existing-only')가 맥락 안전 규칙(읽지 못한 문장·앞 내용을 뒤집는 문장)만 아니었다면 체크했을 연결의 수.
 * 화면이 「읽지 못한 문장이 있어 연결 n개는 체크하지 않았습니다」를 보이는 데 쓴다
 */
export function contextHeldBack(proposal) {
  if (!(proposal.unreadContext || proposal.ctxVeto)) return 0;
  const free = { ...proposal, unreadContext: false, ctxVeto: false };
  const sel = defaultSelection(free, 'existing-only');
  return proposal.edges.filter((e) => sel.edges[e.key].include).length;
}

const NEW_TYPES = Object.keys(NODE_TYPES).filter((k) => k !== 'root');
export const TEXT_NODE_TYPES = Object.freeze(NEW_TYPES);

/**
 * 제안 + 사용자의 선택 → 화면과 명령이 함께 쓰는 최종 값.
 *  nodes[key]: {include, fixed(지도에 있는 항목이라 체크 없이 연결의 끝으로 쓰임), type, label, emp_no, problem:''|'empty'|'too_long', match:{id,gid,label}|null, mapEmpNo(지도 사람의 사번, 없으면 ''), ambiguous}
 *  edges[key]: {include(실제로 넣을지), wanted(사용자가 체크했는지), type, source, target(방향 반영한 항목 key), reason:''|'pair'|'end_missing'|'same', exists}
 * @param {object} selection {nodes:{key:{include?,type?,label?,emp_no?}}, edges:{key:{include?,type?}}} 빠진 값은 defaultSelection
 * @param {{id:string, core_type:string, label:string, emp_no:string}[]} cands docCandidates(doc) 또는 ownCandidates(view)
 * @param {object[]} [docEdges] 같은 연결이 이미 있는지 볼 문서의 연결 목록(없으면 exists는 제안 값)
 */
export function resolveSelection(proposal, selection, cands, docEdges = null) {
  const def = defaultSelection(proposal);
  const nodes = {};
  for (const n of proposal.nodes) {
    const s = { ...def.nodes[n.key], ...((selection && selection.nodes && selection.nodes[n.key]) || {}) };
    const type = NEW_TYPES.includes(s.type) ? s.type : n.type;
    const label = oneLine(s.label ?? '');
    const emp_no = type === 'person' ? String(s.emp_no ?? '').trim() : '';
    const problem = !label ? 'empty' : label.length > LABEL_MAX ? 'too_long' : '';
    const m = problem ? {} : findMatch(cands, { type, label, emp_no });
    // R21: 지도에 이미 있는 항목(유일하게 맞고 확인할 것이 없음)은 체크 없이 늘 연결의 끝으로 쓴다(새로 만들지 않고 그 항목에 잇는다). 확인할 것(hold)이 있으면 사람이 체크해야 쓰인다
    const fixed = !!m.hit && !m.ambiguous && !n.hold;
    nodes[n.key] = {
      key: n.key,
      include: fixed || s.include !== false,
      fixed,
      type,
      label,
      emp_no,
      problem,
      match: m.hit ? { id: m.hit.id, gid: m.hit.gid, label: m.hit.label } : null,
      mapEmpNo: m.hit && m.hit.core_type === 'person' ? String(m.hit.emp_no || '') : '', // T6: 지도에 있는 사람의 사번(화면이 읽기 전용으로 보인다 — 글의 사번 칸 값과 다를 수 있다)
      ambiguous: !!m.ambiguous,
    };
  }
  const idOf = (key) => (nodes[key].match ? nodes[key].match.id : null);
  const edges = {};
  for (const e of proposal.edges) {
    const s = { ...def.edges[e.key], ...((selection && selection.edges && selection.edges[e.key]) || {}) };
    const type = hasKey(EDGE_TYPES, s.type) ? s.type : e.type;
    const a = nodes[e.from];
    const b = nodes[e.to];
    const dir = orientRelation(type, a.type, b.type);
    const source = dir === 'backward' ? e.to : e.from;
    const target = dir === 'backward' ? e.from : e.to;
    let reason = '';
    if (!dir) reason = 'pair';
    else if (!a.include || !b.include || a.problem || b.problem) reason = 'end_missing';
    else if ((a.match && b.match && a.match.id === b.match.id) || (a.type === b.type && normalizeLabel(a.label) === normalizeLabel(b.label))) reason = 'same';
    const sid = idOf(source);
    const tid = idOf(target);
    const exists = docEdges ? !!(sid && tid && edgeIn(docEdges, sid, tid, type)) : !!e.exists && type === e.type;
    const wanted = s.include !== false;
    edges[e.key] = { key: e.key, include: wanted && !reason, wanted, type, source, target, reason, exists };
  }
  return { nodes, edges };
}

/**
 * 제안 + 선택 → app.applyBatch 명령 목록(항목 먼저, 연결 나중). 한 번의 묶음이라 하나라도 오류면 아무것도 저장되지 않는다.
 *  - 지도에 이미 있는 항목(match)은 새로 만들지 않고 그 항목 id로 잇는다. 새 항목은 '@행번호'로 가리킨다(표로 추가의 연결 칸과 같은 방식)
 *  - 수행은 assign(담당 시작 이력 + 수행 연결, 오늘부터. 이미 담당 중이면 건너뜀), 나머지는 addEdge(skipDup: 이미 있으면 건너뜀)
 *  - 이름이 빈 항목은 invalid 명령(그 행 사유)으로 돌려 저장을 막는다
 * 명령마다 key(제안의 항목·연결 key)를 붙인다 — 오류 행을 화면 행에 되짚기 위한 것이고 applyBatch는 읽지 않는다.
 * @param {{attachRoot?: boolean|'work'}} [opt] attachRoot: 새 항목을 지도 중심에 포함으로 잇는 범위. 기본 'work'(표로 추가와 같음)
 */
export function proposalToOps(proposal, selection, doc, opt = {}) {
  const attach = opt.attachRoot === undefined ? 'work' : opt.attachRoot;
  const r = resolveSelection(proposal, selection, docCandidates(doc), doc.edges || []);
  const ops = [];
  const ref = new Map();
  let row = 1;
  for (const n of proposal.nodes) {
    const f = r.nodes[n.key];
    if (!f.include) continue;
    if (f.problem) {
      ops.push({ op: 'invalid', row, key: n.key, error: { code: CODES.REQUIRED, field: 'label', ...(f.problem === 'too_long' ? { too_long: LABEL_MAX } : {}) } });
      row += 1;
      continue;
    }
    if (f.match) {
      ref.set(n.key, f.match.id);
      continue;
    }
    const input = { core_type: f.type, label: f.label, ...(f.type === 'person' && f.emp_no ? { emp_no: f.emp_no } : {}) };
    ops.push({ op: 'addNode', row, key: n.key, input, attachRoot: attach === true || (attach === 'work' && f.type === 'work') });
    ref.set(n.key, `@${row}`);
    row += 1;
  }
  for (const e of proposal.edges) {
    const f = r.edges[e.key];
    if (!f.include || !ref.has(f.source) || !ref.has(f.target)) continue;
    if (f.type === 'performs') ops.push({ op: 'assign', row, key: e.key, input: { person_id: ref.get(f.source), work_id: ref.get(f.target) } });
    else ops.push({ op: 'addEdge', row, key: e.key, skipDup: true, input: { source: ref.get(f.source), target: ref.get(f.target), core_type: f.type, ...(e.verb ? { note: e.verb } : {}) } }); // Claude가 준 동사(작성·검토 …, 인용에 있는 것만)는 연결 메모로
    row += 1;
  }
  return ops;
}
