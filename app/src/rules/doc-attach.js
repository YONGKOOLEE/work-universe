// 문서로 더하기(CR-23): 지금 연 업무 지도의 업무 하나에 문서(회의록·매뉴얼·메모)를 붙여 지도를 키운다.
// 순수 모듈 — DOM·저장소·네트워크를 쓰지 않는다(Node 단위 테스트: tests/doc-attach.test.js).
//   readDocumentRule(text, {doc, targetId, today})   문서 글 → 계획 plan(문서 항목 1 + 할 일 업무 + 메모, 읽지 못한 줄)
//   defaultDocSelection(plan)                         처음 체크
//   planToOps(plan, selection, doc, {targetId})      계획 + 체크 → app.applyBatch 명령(전부 아니면 전무, 되감기 한 점)
//   splitDocument(text)                               글 → 제목·절(Claude 읽기가 절 단위로 나눌 때도 쓴다)
// 지어내지 않는다: 원문에 있는 것만 읽고, 확신이 없는 줄은 만들지 않고 「읽지 못한 줄」로 돌려준다(엉뚱한 업무를 만들지 않는 쪽).
// 저장 형식은 바꾸지 않는다: 산출물(문서) 1개 + 업무(할 일, 속성 「마감」) + 사람(하위 유형 「역할」, 담당=수행 연결) + 메모 이벤트(범주 issue·caution만).
// 값(낱말·상한)은 이 파일 맨 위 상수 한 곳에 둔다.

import { LABEL_MAX, SUBTYPE_ROLE, TEXT_MAX, normalizeLabel } from '../model/schema.js';
import { findDate } from './doc-convert.js';
import { defaultSelection, docCandidates, proposalToOps } from './text-extract.js';

// ── 상수 ────────────────────────────────────────────────────────────────────

/** 읽는 글·항목 상한(넘으면 notes로 알린다). 한 번에 넣는 행 수는 applyBatch의 BATCH_MAX_ROWS(100) 안이어야 한다: 1 + 업무 25 + 역할 25 + 메모 25 = 76 */
export const DOC_ATTACH_LIMITS = Object.freeze({
  maxChars: 200000, // 붙여 넣을 수 있는 글자 수. 넘으면 읽지 않고 안내
  maxTasks: 25,
  maxRoles: 25,
  maxMemos: 25,
  memoMax: 600, // 메모 한 건(문장)의 길이. 넘으면 줄임표로 줄인다(상한 TEXT_MAX 안)
  memoNameMax: 30, // 메모 앞의 「[문서명] 」에 쓰는 문서명 길이
  decisionMax: 200, // 설명에 넣는 결정 한 건의 길이
  historyMax: 90, // 설명에 넣는 이력 한 줄의 길이
  historyLines: 12,
  ownersPerTask: 4,
  headingMax: 40, // 절 제목으로 보는 줄의 길이
  joinMinPrev: 30, // 끊긴 줄 이어 붙이기: 앞 줄이 이 글자 수 이상일 때만(PDF 줄바꿈 폭 근처. 표 칸처럼 짧은 줄은 잇지 않는다)
  memoShortMax: 12, // 메모로 만들지 않는 짧은 줄(날짜·이름·부서 꼴, 문장 끝 없음)의 길이
  headerMax: 40, // 쪽 머리글(「A사 … | 업무기록」)로 보는 줄의 길이
});

/** 읽는 모양에 쓰는 낱말(바꾸려면 여기 한 곳만 고친다). 비교는 공백을 뺀 글자로 한다 */
export const DOC_ATTACH_WORDS = Object.freeze({
  decision: ['결정', '결론', '의결', '합의'],
  issue: ['미결', '미확정', '확인필요', '질문'], // → 메모 범주 issue
  caution: ['유의', '주의', '추적', '리스크', '위험'], // → 메모 범주 caution. 「쟁점」은 넣지 않음(「부서별 의견 및 쟁점」의 부서 의견이 주의사항 메모로 쏟아짐 — 메인 2026-10-28)
  /** 할 일 표 머리줄: 세 낱말이 모두 있어야 한다(낱말 하나가 낱말 전체여야 하므로 문장은 걸리지 않는다) */
  head: Object.freeze({
    task: /^(?:과제|조치|할일|작업|실행과제|업무)(?:명|사항|내용|항목)?$/,
    owner: /^(?:담당|책임|주관)(?:자|부서|팀|자명)?$/,
    due: /^(?:기한|일정|마감|시점)(?:일|일자|기한)?$/,
  }),
  /** 담당 칸에 있어도 사람(역할)으로 만들지 않는 값 */
  noOwner: ['미정', '미지정', '미배정', '없음', 'tbd', 'n/a', '-', '해당없음', '전원', '전체', '각팀', '각자'],
  skipLine: /^※/,
  /** 담당 칸 낱말이 동사·형용사 끝맺음(「검토한다」)이면 사람 이름이 아니다. 「윤바다」처럼 「다」로 끝나는 이름은 걸리지 않게 어미 꼴만 본다(지도에 있는 이름은 늘 받는다) */
  verbTail: /(?:[하한되된했됐있없이였간온갔왔]다|[는겠았었]다)$/,
  /** 쪽 머리글·바닥글: 쪽 번호만 있는 줄(「- 3 -」「3 / 12」「페이지 3」) */
  pageNumber: /^(?:[-–—]\s*\d{1,4}\s*[-–—]|\d{1,4}\s*[/／]\s*\d{1,4}|(?:페이지|쪽|page|p\.?)\s*\d{1,4}(?:\s*[/／]\s*\d{1,4})?)$/i,
  /** 담당 칸에 오면 사람(역할)이 아닌 낱말(접속사·흔한 말) → 그 행을 읽지 않는다 */
  stopOwner: ['그리고', '및', '예정', '등', '또는', '혹은', '이후', '이내', '별도', '공지', '모두', '기타', '관련', '해당', '위', '아래', '다음', '이상', '이하', '각', '및등'],
  /** 공백뿐인 표에서 담당 낱말이 조직·역할 꼴인지 보는 끝말(세 글자 이상일 때) */
  orgSuffix: /(?:팀|부서|본부|센터|파트|그룹|위원회|사업|담당|부|실|처|국|과)$/,
  /** 과제 이름의 끝 낱말이 조직 꼴이면 담당이 과제 이름 끝에 붙은 것이다(「고객 안내문 배포 영업팀」) */
  orgTail: /(?:팀|부서|본부|센터|파트|그룹|위원회)$/,
  /** 과제 이름이 문장 꼴(…다/…함/…예정)이면 할 일 이름이 아니다 */
  sentenceTail: /(?:다|함|음|임|됨|예정|것|중)\.?$/,
  uncertainTokens: 7, // 공백뿐인 표에서 과제 이름이 이 낱말 수 이상이면 문장일 수 있어 「확인 필요」(처음 체크 해제)
  issueQuestion: '질문', // 「질문」은 같은 제목에 「답변」이 있으면 미결이 아니다
});

/** 메모 범주: resolved·in_progress는 쓰지 않는다(resolved는 같은 대상의 열린 메모를 닫고, in_progress·issue는 매주 점검의 열린 항목으로 센다) */
export const DOC_ATTACH_MEMO_CATEGORIES = Object.freeze(['issue', 'caution']);

// ── 낱말·글 다루기 ───────────────────────────────────────────────────────────

const squash = (s) => String(s).replace(/\s+/g, '');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hasWord = (title, words) => { const t = squash(title); return words.some((w) => t.includes(w)); };
/** 절 제목 판정(한 절은 한 곳으로만): 미결 → issue, 유의·추적 → caution, 결정은 메모가 되지 않는 절만 */
export const isIssueTitle = (t) => {
  const sq = squash(t);
  if (DOC_ATTACH_WORDS.issue.some((w) => w !== DOC_ATTACH_WORDS.issueQuestion && sq.includes(w))) return true;
  return sq.includes(DOC_ATTACH_WORDS.issueQuestion) && !sq.includes('답'); // 「질문과 답변」은 이미 답이 있다
};
export const isCautionTitle = (t) => hasWord(t, DOC_ATTACH_WORDS.caution);
export const isDecisionTitle = (t) => hasWord(t, DOC_ATTACH_WORDS.decision) && !isIssueTitle(t) && !isCautionTitle(t) && !hasWord(t, ['미결정', '미확정']);
const BULLET = /^(?:[-·•▪‣◦*□○●■▶▷]|\(\d{1,2}\)|\d{1,2}\))\s+/;
const CIRCLED = /[①-⑳]/;

const pad2 = (n) => String(n).padStart(2, '0');
const validYmd = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 문장 나누기: 마침표 앞이 숫자가 아니고 뒤에 공백이 올 때만(「2024. 3. 15.」「1.로」는 자르지 않는다)
const sentencesOf = (line) => String(line).split(/(?<=[^\d\s][.!?])\s+/).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));

/** 줄 목록 → 항목(①②③ 표지가 있으면 그 단위로, 없으면 줄의 문장 단위로). 표지는 남긴다 */
export function itemsOf(lines, { speaker = false } = {}) {
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(BULLET, '').trim();
    if (!line) continue;
    if (CIRCLED.test(line)) {
      for (const p of line.split(/\s*(?=[①-⑳])/)) {
        const t = p.trim();
        if (/[\p{L}\p{N}]/u.test(t.replace(/[①-⑳]/g, ''))) out.push(t);
      }
    } else {
      const ss = sentencesOf(line);
      // speaker: 「메시징사업팀: 문장. 문장.」처럼 말한 주체가 앞에 붙은 줄은 뒤 문장에도 주체를 붙여 뜻이 끊기지 않게 한다
      const who = speaker && ss.length > 1 ? /^(\S{2,20}[:：])\s/.exec(ss[0]) : null;
      ss.forEach((x, i) => out.push(who && i > 0 ? `${who[1]} ${x}` : x));
    }
  }
  return out;
}

// ── 문서 나누기(제목·절) ─────────────────────────────────────────────────────

const WHOLE_BRACKET = /^[[【(（].*[\]】)）]$/;
const BRACKET_HEAD = /^\s*[[【][^\]】]{1,20}[\]】]\s*[:：\-–—]?\s*(?=\S)/;

/** 제목 줄에서 「제목:」·대괄호 머리를 정리한다 */
export function cleanTitle(raw) {
  let t = oneLine(raw).replace(/^#+\s*/, '').replace(/^제목\s*[:：]\s*/, '');
  const noHead = t.replace(BRACKET_HEAD, '').trim();
  if (noHead !== t && /[\p{L}\p{N}]/u.test(noHead) && noHead.length >= 2) t = noHead;
  else if (WHOLE_BRACKET.test(t)) t = t.slice(1, -1).trim(); // 「[회의록]」뿐인 줄은 대괄호만 뗀다
  return clip(t, LABEL_MAX);
}

/** 이 줄이 절 제목인가 → {num, title}|null. seq: 지금까지 본 마지막 번호 */
function headingOf(t, seq, hasMd) {
  let m = /^#{1,6}\s+(\S.*)$/.exec(t);
  if (m) return { num: null, title: oneLine(m[1]), md: true };
  if (hasMd) return null; // 마크다운 제목이 있는 글은 번호 줄을 제목으로 보지 않는다
  m = /^(\d{1,2})\s*[.)]\s+(\S.*)$/.exec(t);
  if (m && Number(m[1]) === seq + 1 && m[2].length <= DOC_ATTACH_LIMITS.headingMax && !/(?:다|요|음|함)?\.$|다$/.test(m[2])) return { num: Number(m[1]), title: oneLine(m[2]) };
  m = /^(?:[■□▣◆◇●○▶]\s*|[【[]\s*)(\S.{0,38}?)\s*[】\]]?$/.exec(t);
  if (m && t.length <= DOC_ATTACH_LIMITS.headingMax && !/[.다]$/.test(t) && /^[■□▣◆◇●○▶【[]/.test(t)) return { num: null, title: oneLine(m[1]) };
  return null;
}

/** 쪽 머리글 꼴: 짧고 「 | 」로 나뉜 줄(PDF를 복사하면 쪽마다 붙는다) */
const isHeaderLike = (l) => l.length <= DOC_ATTACH_LIMITS.headerMax && /\s[|｜]\s/.test(l);


// ── PDF에서 복사한 글 다듬기(쪽 머리글·끊긴 줄) ──────────────────────────────

const SENTENCE_END = /(?:[.!?。:：)）\]】]|다)$/;
const DATE_ONLY = /^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?$/;
const DATE_END = /(?:\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?|\d{1,2}월\s*\d{1,2}일?|\d{1,2}월\s*[말초중]|\d{1,2}[:：]\d{2})$/;
const BLOCK_START = /^(?:#{1,6}\s|\d{1,2}\s*[.)]\s*\S|[①-⑳]|[■□▣◆◇●○▶•·*【[]|[-–—]\s)/;
const LABEL_START = /^\S{2,20}[:：]\s/;
const pageKey = (l) => l.replace(/\s*\d{1,3}$/, ''); // 쪽 번호가 붙은 머리글(「… 업무기록1」)도 같은 줄로 본다

/** 쪽 머리글(짧고 「 | 」로 나뉜 줄)과 그 앞의 쪽 번호만 있는 줄(1~3자리 숫자)을 뺀다. 머리글은 앞이 쪽 번호이거나 되풀이될 때만 */
function dropPageHeaders(lines) {
  const count = new Map();
  for (const l of lines) count.set(pageKey(l), (count.get(pageKey(l)) || 0) + 1);
  const drop = new Set();
  lines.forEach((l, i) => {
    if (!isHeaderLike(l)) return;
    const prevNum = i > 0 && /^\d{1,3}$/.test(lines[i - 1]);
    if (!prevNum && count.get(pageKey(l)) < 2) return;
    drop.add(i);
    if (prevNum) drop.add(i - 1);
  });
  return lines.filter((_, i) => !drop.has(i));
}

/** 줄 끝이 문장 끝이 아닌 채 끊긴 줄을 다음 줄과 공백 하나로 잇는다(표·제목·글머리표·날짜만 있는 줄 앞에서는 잇지 않는다). 첫 줄(제목)은 잇지 않는다 */
function joinBrokenLines(lines) {
  const out = [];
  let inTable = false;
  lines.forEach((l, i) => {
    if (BLOCK_START.test(l) && /^(?:#{1,6}\s|\d{1,2}\s*[.)]\s)/.test(l)) inTable = false; // 새 절
    const prev = out.length ? out[out.length - 1] : null;
    const prevHeading = prev !== null && prev.length <= DOC_ATTACH_LIMITS.headingMax && BLOCK_START.test(prev) && !SENTENCE_END.test(prev);
    const can = i > 1 && prev !== null && !inTable && prev.length >= DOC_ATTACH_LIMITS.joinMinPrev && !SENTENCE_END.test(prev) && !DATE_END.test(prev) && !prevHeading
      && !BLOCK_START.test(l) && !LABEL_START.test(l) && !DATE_ONLY.test(l) && !taskHeader(l);
    if (can) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
    if (taskHeader(l) || /^(?:과제|할\s?일|실행\s?과제)$/.test(l)) inTable = true; // 표 머리줄 뒤에서는 줄을 잇지 않는다(칸이 한 줄씩 떨어진 표 포함)
  });
  return out;
}

/**
 * 글 → {title, titleLine, sections:[{num, title, lines[]}]}. 첫 절(title '')은 제목 앞 머리말이다.
 * 빈 줄·※ 줄은 버린다. 번호 절 제목은 앞 번호 다음 번호일 때만(목록의 「1. …」을 제목으로 보지 않게)
 */
export function splitDocument(text) {
  const all = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const hasMd = all.some((l) => /^#{1,6}\s+\S/.test(l));
  // 쪽 번호 줄과 두 번 이상 되풀이되는 짧은 머리글·바닥글 줄은 읽지 않는다(제목으로 잡히거나 본문에 섞이지 않게)
  const seen = new Map();
  for (const l of all) if (l) seen.set(l, (seen.get(l) || 0) + 1);
  const running = (l) => (seen.get(l) || 0) >= 2 && l.length >= 6 && l.length <= DOC_ATTACH_LIMITS.headerMax && !/^#{1,6}\s|^\d{1,2}\s*[.)]\s|^[■□▣◆◇●○▶【[]/.test(l) && !/[.다]$/.test(l) && !/	/.test(l) && !/\s{2,}/.test(l) && !taskHeader(l);
  const lines = joinBrokenLines(dropPageHeaders(all.filter(Boolean)).filter((l) => !DOC_ATTACH_WORDS.skipLine.test(l) && !DOC_ATTACH_WORDS.pageNumber.test(l) && !running(l)));
  const firstAt = lines.findIndex((l) => !isHeaderLike(l)); // 머리글 꼴 줄은 제목 후보에서 뺀다(본문에는 남긴다)
  const first = firstAt >= 0 && firstAt < 4 ? lines[firstAt] : lines[0] || '';
  const head8 = lines.slice(0, 8);
  const titleKey = head8.map((l) => /^제목\s*[:：]\s*(\S.*)$/.exec(l)).find(Boolean);
  let title = '';
  let rest = lines;
  if (first && !/^#{2,6}\s/.test(first)) {
    title = cleanTitle(WHOLE_BRACKET.test(first) && titleKey ? titleKey[1] : first);
    rest = lines.filter((l, i) => i !== (firstAt >= 0 && firstAt < 4 ? firstAt : 0));
  }
  const sections = [{ num: null, title: '', lines: [] }];
  let seq = 0;
  for (const t of rest) {
    const h = headingOf(t, seq, hasMd);
    if (h) {
      if (h.num !== null) seq = h.num;
      sections.push({ num: h.num, title: h.title, lines: [] });
    } else sections[sections.length - 1].lines.push(t);
  }
  return { title, sections };
}

// ── 문서 날짜·작성 부서 ──────────────────────────────────────────────────────

const DATE_KEY = /^(?:일시|작성일자|작성일|작성\s*일|회의\s*일시|회의일|일자|날짜)(?![\p{L}\p{N}])/u;

/** 문서 날짜(YYYY-MM-DD): 「일시」「작성일」 줄, 없으면 제목의 날짜. 없으면 '' */
export function docDateOf(text, title = '') {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40);
  for (const l of lines) {
    if (!DATE_KEY.test(l)) continue;
    const d = findDate(l);
    if (d) return d;
  }
  return findDate(title) || '';
}

/** 작성 부서(「작성부서: A사 메시징사업팀」). 없으면 '' */
export function authorDeptOf(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').slice(0, 40);
  for (const l of lines) {
    const m = /작성\s*부서\s*[:：]\s*([^|｜\n]+)/.exec(l);
    if (m) return clip(oneLine(m[1]), 60);
  }
  return '';
}

// ── 기한(날짜 꼴) ───────────────────────────────────────────────────────────

const FULL = '\\d{4}\\s*[.\\-/년]\\s*\\d{1,2}\\s*[.\\-/월]\\s*\\d{1,2}\\s*[.일]?';
const MEND = '\\d{4}\\s*[.\\-/년]\\s*\\d{1,2}\\s*월?\\s*(?:초|중|말)';
const MONTH = '\\d{4}\\s*[.\\-/년]\\s*\\d{1,2}\\s*[.월]?';
const ONE = `(?:${FULL}|${MEND}|${MONTH})`;
/** 줄 끝의 기한: 「2016. 11. 30.」「2017. 3월 말」「2026. 11.~2027. 1.」「2027. 1. 25. 이후」 */
const DATE_TAIL = new RegExp(`(?<![\\d.\\-/])(${ONE}(?:\\s*[~∼～]\\s*${ONE})?)(?:\\s*(이후|까지|이전|이내))?\\s*$`);

/** 기한 글 하나를 읽는다 → {text, iso, end}|null. iso: 날짜 하나뿐일 때만(그대로 「마감」에 쓴다). end: 지났는지 가를 마지막 날 */
export function parseDue(raw) {
  const text = oneLine(raw);
  const parts = text.replace(/\s*(이후|까지|이전|이내)$/, '').split(/\s*[~∼～]\s*/);
  const ends = [];
  let iso = null;
  for (const p of parts) {
    const nums = p.match(/\d+/g);
    if (!nums || nums.length < 2) return null;
    const y = Number(nums[0]);
    const m = Number(nums[1]);
    const hasDay = nums.length >= 3;
    if (m < 1 || m > 12) return null;
    let d;
    if (hasDay) {
      d = Number(nums[2]);
      if (!validYmd(y, m, d)) return null;
    } else d = lastDay(y, m); // 월 말·월만: 그 달의 마지막 날로 본다
    ends.push(`${y}-${pad2(m)}-${pad2(d)}`);
    if (ends.length > 1 && ends[ends.length - 1] < ends[ends.length - 2]) return null; // 거꾸로 된 범위
    if (parts.length === 1 && hasDay && !/(이후|까지|이전|이내)$/.test(text)) iso = ends[0];
  }
  return { text, iso, end: ends[ends.length - 1] };
}

// ── 할 일 표 ────────────────────────────────────────────────────────────────

const cellsOf = (line) => {
  const t = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  if (line.includes('|')) return t.split('|').map((c) => oneLine(c));
  if (line.includes('\t')) return line.split('\t').map((c) => oneLine(c));
  return null;
};
const isSeparator = (cells) => !!cells && cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');

/** 머리줄이면 {order:['task','owner','due'…], cells|null} (세 낱말을 모두 가진 짧은 줄). 아니면 null */
export function taskHeader(line) {
  if (line.length > 40 || /[.다요]$/.test(line)) return null;
  const cells = cellsOf(line);
  const norm = (line.replace(/할 일/g, '할일').replace(/실행 과제/g, '실행과제'));
  const tokens = (cells ? cells.map((c) => c.replace(/\s+/g, '')) : oneLine(norm).split(/\s+/)).filter(Boolean);
  if (tokens.length < 3 || tokens.length > 8) return null;
  const W = DOC_ATTACH_WORDS.head;
  const order = tokens.map((t) => (W.task.test(t) ? 'task' : W.owner.test(t) ? 'owner' : W.due.test(t) ? 'due' : ''));
  for (const k of ['task', 'owner', 'due']) if (order.filter((x) => x === k).length !== 1) return null;
  return { order, cells: cells ? tokens : null, tokens };
}

/** 칸이 한 줄씩 떨어진 표(PDF 복사)의 머리줄: 「과제」「담당」「기한」이 이 순서로 연속한 세 줄 → 첫 줄 위치(없으면 -1) */
function verticalHeaderAt(lines) {
  const W = DOC_ATTACH_WORDS.head;
  const one = (l) => squash(l.replace(/할 일/g, '할일').replace(/실행 과제/g, '실행과제'));
  return lines.findIndex((l, i) => i + 2 < lines.length && W.task.test(one(l)) && W.owner.test(one(lines[i + 1])) && W.due.test(one(lines[i + 2])));
}

const NAME_PIECE = /^[\p{L}\p{N}·()]{2,20}$/u;
/** 담당 칸 → 사람(역할) 이름들. 「/」「,」로 나눈다. 읽을 수 없으면 null(그 행을 읽지 않는다) */
export function ownersOf(cell, names = null) {
  const v = oneLine(cell);
  if (!v) return [];
  if (DOC_ATTACH_WORDS.noOwner.includes(squash(v).toLowerCase())) return [];
  const pieces = v.split(/\s*[/／,，、]\s*/).map((p) => p.trim()).filter(Boolean);
  if (!pieces.length || pieces.length > DOC_ATTACH_LIMITS.ownersPerTask) return null;
  const out = [];
  for (const p of pieces) {
    const known = !!(names && names.has(normalizeLabel(p))); // 지도에 있는 사람·조직 이름은 늘 받는다
    if (!NAME_PIECE.test(p) || (!known && DOC_ATTACH_WORDS.verbTail.test(p)) || !/\p{L}/u.test(p) || (!known && DOC_ATTACH_WORDS.stopOwner.includes(p))) return null; // 숫자뿐·접속사는 담당이 아니다
    if (DOC_ATTACH_WORDS.noOwner.includes(p.toLowerCase())) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** 과제 이름으로 쓸 수 있는가: 글자가 있고 문장 끝(다.)이 아니다 */
const taskNameOk = (s) => s.length >= 2 && s.length <= LABEL_MAX && /\p{L}/u.test(s) && !/다\.$/.test(s);

/** 공백뿐인 표의 행 → {task, ownerCell, dueCell}|null (줄 끝의 기한 → 그 앞 낱말 → 나머지) */
function splitSpaceRow(line) {
  const m = DATE_TAIL.exec(line);
  if (!m) return null;
  const om = /^(.*\S)\s+(\S+)$/.exec(line.slice(0, m.index).trim());
  return om ? { task: om[1].trim(), ownerCell: om[2], dueCell: m[0].trim() } : null;
}

const ownerPieces = (cell) => oneLine(cell).split(/\s*[/／,，、]\s*/).filter(Boolean);

/**
 * 행 하나 → {task, owners, due, uncertain?}|{why}|{skip}.
 * 공백뿐인 표(ctx.counts·ctx.names)는 칸 구분이 없어 담당·과제 경계가 흐리다 — 확신이 있을 때만 읽는다:
 *   담당 낱말이 「/」·「,」로 이은 덩어리이거나 · 지도에 있는 사람·조직 이름이거나 · 같은 표 다른 행에서도 담당이거나 · 세 글자 이상이고 조직 꼴(…팀·본부·사업 …)일 때,
 *   과제 이름이 문장 꼴이 아니고 끝 낱말이 조직 꼴이 아닐 때. 과제 이름이 7낱말 이상이면 만들되 「확인 필요」.
 */
function readRow(line, header, ctx = {}) {
  let task;
  let ownerCell;
  let dueCell;
  let spaced = false;
  if (header.cells) {
    const cells = cellsOf(line);
    if (!cells) return { why: '표의 칸으로 나뉘지 않는 줄' };
    if (isSeparator(cells)) return { skip: true };
    if (cells.length !== header.tokens.length) return { why: '칸 수가 머리줄과 다름' };
    task = cells[header.order.indexOf('task')];
    ownerCell = cells[header.order.indexOf('owner')];
    dueCell = cells[header.order.indexOf('due')];
  } else if (header.vertical) {
    ({ task, ownerCell, dueCell } = ctx.parts); // 칸이 한 줄씩 떨어진 표: 세 줄을 한 행으로 묶어 받는다
    spaced = true;
  } else {
    // 공백만 있는 표(PDF에서 복사한 글): 머리줄이 「과제 담당 기한」 순서일 때만
    if (header.order.join() !== 'task,owner,due') return { why: '공백만 있는 표는 「과제 담당 기한」 순서일 때만 읽음' };
    const sp = splitSpaceRow(line);
    if (!sp) return { why: DATE_TAIL.test(line) ? '담당과 과제를 나눌 수 없음' : '줄 끝에서 기한을 찾지 못함' };
    ({ task, ownerCell, dueCell } = sp);
    spaced = true;
  }
  task = oneLine(task || '');
  if (!taskNameOk(task)) return { why: '과제 이름을 읽을 수 없음' };
  const owners = ownersOf(ownerCell || '', ctx.names);
  if (owners === null) return { why: '담당을 사람·역할 이름으로 읽을 수 없음' };
  let uncertain = false;
  if (spaced) {
    const W = DOC_ATTACH_WORDS;
    const tokens = task.split(/\s+/);
    if (W.sentenceTail.test(task)) return { why: '과제 이름이 문장 꼴이라 할 일로 읽지 않음' };
    if (W.orgTail.test(tokens[tokens.length - 1]) || (tokens[tokens.length - 1].length >= 3 && /[부실처]$/.test(tokens[tokens.length - 1]))) return { why: '과제 이름 끝에 조직 이름이 붙어 담당과 나눌 수 없음' };
    const pieces = ownerPieces(ownerCell);
    const sure = pieces.length > 1 || pieces.every((p) => (ctx.names && ctx.names.has(normalizeLabel(p))) || (ctx.counts && ctx.counts.get(p) >= 2) || (p.length >= 3 && W.orgSuffix.test(p)));
    if (owners.length && !sure) return { why: '담당이 사람·역할 이름인지 확신할 수 없음' };
    uncertain = tokens.length >= W.uncertainTokens;
  }
  let due = null;
  if (oneLine(dueCell || '')) {
    due = parseDue(dueCell);
    if (!due) return { why: '기한을 날짜로 읽을 수 없음' };
  }
  return { task, owners, due, ...(uncertain ? { uncertain: true } : {}) };
}

// ── 계획 만들기 ──────────────────────────────────────────────────────────────

const todayDefault = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const findNode = (cands, type, label) => {
  const key = normalizeLabel(label);
  const same = cands.filter((c) => c.core_type === type && normalizeLabel(c.label) === key);
  return same.length === 1 ? { id: same[0].id, label: same[0].label } : same.length > 1 ? { ambiguous: true } : null;
};

/** from에서 contains 연결을 따라 to에 닿는가(상위·하위 관계 검사) */
function containsReach(edges, from, to) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (!e.hidden && e.core_type === 'contains' && e.source === cur) stack.push(e.target);
  }
  return false;
}

const edgeExists = (edges, s, t, type) => edges.some((e) => !e.hidden && e.source === s && e.target === t && e.core_type === type);

/**
 * 문서 글을 규칙으로 읽는다(키 없이). 만드는 것: ① 문서(산출물) 1개 ② 할 일 표의 행(업무) ③ 미결·유의 절의 문장(메모).
 * @param {string} text 붙여 넣은 문서 글
 * @param {{doc:object, targetId:string, today?:string}} ctx doc: 지금 지도의 문서(app.doc). targetId: 대상 업무의 노드 id
 * @returns {{ok:false, reason:string, max?:number} | {ok:true, source:'rule', plan:object}}
 */
export function readDocumentRule(text, { doc, targetId, today = todayDefault() } = {}) {
  const src = String(text ?? '');
  if (!src.trim()) return { ok: false, reason: 'empty' };
  if (src.length > DOC_ATTACH_LIMITS.maxChars) return { ok: false, reason: 'too_long', max: DOC_ATTACH_LIMITS.maxChars };
  const nodes = (doc && doc.nodes) || [];
  const edges = (doc && doc.edges) || [];
  const target = nodes.find((n) => n.id === targetId);
  if (!target || target.core_type !== 'work' || target.hidden) return { ok: false, reason: 'target' };
  const cands = docCandidates(doc);
  const names = new Set(cands.filter((c) => c.core_type === 'person' || c.core_type === 'org').map((c) => normalizeLabel(c.label)));
  const { title, sections } = splitDocument(src);
  const docLabel = title || '문서';
  const docDate = docDateOf(src, title);
  const dept = authorDeptOf(src);
  const notes = [];
  const unread = [];

  // 1) 문서 항목의 설명: 문서 날짜·작성 부서 + 결정 + 이력
  const decisions = [];
  const history = [];
  for (const s of sections) {
    if (s.title && isDecisionTitle(s.title)) decisions.push(...itemsOf(s.lines));
    for (const l of s.lines) {
      if (/^[-·•▪‣◦*□○●■▶▷]\s*\d{4}\s*[.\-/년]\s*\d{1,2}/.test(l)) history.push(oneLine(l.replace(/^[-·•▪‣◦*□○●■▶▷]\s*/, '')));
    }
  }
  const descParts = [];
  const head = [docDate ? `문서 날짜: ${docDate}` : '', dept ? `작성 부서: ${dept}` : ''].filter(Boolean).join(' · ');
  if (head) descParts.push(head);
  if (decisions.length) descParts.push(`결정: ${decisions.map((d) => clip(d, DOC_ATTACH_LIMITS.decisionMax)).join(' ')}`);
  if (history.length) {
    const shown = history.slice(0, DOC_ATTACH_LIMITS.historyLines).map((h) => clip(h, DOC_ATTACH_LIMITS.historyMax));
    descParts.push(`이력: ${shown.join(' / ')}${history.length > shown.length ? ` 외 ${history.length - shown.length}건` : ''}`);
  }
  const description = clip(descParts.join('\n'), TEXT_MAX);
  const docMatch = findNode(cands, 'artifact', docLabel);
  const docItem = {
    key: 'doc',
    label: docLabel,
    description,
    match: docMatch && !docMatch.ambiguous ? docMatch : null,
    ambiguous: !!(docMatch && docMatch.ambiguous),
    exists: !!(docMatch && docMatch.id && edgeExists(edges, targetId, docMatch.id, 'references')),
  };
  if (docItem.ambiguous) notes.push(`지도에 「${docLabel}」이라는 산출물이 둘 이상 있어 새 문서 항목으로 만듭니다`);
  if (!title) notes.push('문서 제목을 찾지 못해 「문서」로 이름 지었습니다 — 만든 뒤 이름을 고치세요');

  // 2) 할 일 표
  const tasks = [];
  const seenTask = new Set();
  const usedSections = [];
  for (const s of sections) {
    const hi0 = s.lines.findIndex((l) => taskHeader(l));
    const vi = verticalHeaderAt(s.lines);
    if (hi0 < 0 && vi < 0) continue;
    const vertical = vi >= 0 && (hi0 < 0 || vi < hi0);
    const hi = vertical ? vi + 2 : hi0;
    const header = vertical ? { cells: null, order: ['task', 'owner', 'due'], tokens: ['과제', '담당', '기한'], vertical: true } : taskHeader(s.lines[hi]);
    usedSections.push(s.title);
    const rowsOf = s.lines.slice(hi + 1);
    // 칸이 한 줄씩 떨어진 표는 세 줄씩 한 행으로 묶는다(꼴이 맞지 않는 첫 지점부터는 읽지 못한 줄로 둔다 — 억지로 짝을 맞추지 않는다)
    const units = vertical ? Array.from({ length: Math.ceil(rowsOf.length / 3) }, (_, k) => rowsOf.slice(k * 3, k * 3 + 3)).map((g) => ({ raw: g, line: g.join(' '), parts: g.length === 3 ? { task: g[0], ownerCell: g[1], dueCell: g[2] } : null })) : rowsOf.map((line) => ({ raw: [line], line }));
    // 공백뿐인 표: 담당 낱말이 같은 표의 다른 행에서도 담당으로 쓰였는지 세어 둔다(행마다 한 번)
    const counts = new Map();
    if (!header.cells) {
      for (const u of units) {
        const sp = u.parts ? { ownerCell: u.parts.ownerCell } : vertical ? null : splitSpaceRow(u.line);
        if (sp) for (const p of new Set(ownerPieces(sp.ownerCell))) counts.set(p, (counts.get(p) || 0) + 1);
      }
    }
    const rowCtx = { counts, names };
    let okRows = 0;
    for (let ui = 0; ui < units.length; ui += 1) {
      const { line, parts } = units[ui];
      const r = vertical && !parts ? { why: '표의 칸이 세 줄(과제·담당·기한)로 이어지지 않음' } : readRow(line, header, { ...rowCtx, parts });
      if (r.skip) continue;
      if (r.why) {
        if (vertical) { // 이 행부터 끝까지 읽지 못한 줄
          for (const u of units.slice(ui)) for (const raw of u.raw) unread.push({ text: clip(raw, 160), why: r.why, section: s.title });
          break;
        }
        unread.push({ text: clip(line, 160), why: r.why, section: s.title });
        if (okRows > 0) break; // 첫 성공 행 뒤에 읽지 못한 줄이 나오면 표는 거기서 끝난다(표 아래 산문을 할 일로 읽지 않게)
        continue;
      }
      okRows += 1;
      const key = normalizeLabel(r.task);
      if (seenTask.has(key)) { notes.push(`같은 이름의 할 일 「${r.task}」이 한 번 더 나와 하나만 읽었습니다`); continue; }
      if (tasks.length >= DOC_ATTACH_LIMITS.maxTasks) { unread.push({ text: clip(line, 160), why: `할 일은 ${DOC_ATTACH_LIMITS.maxTasks}개까지 읽습니다`, section: s.title }); continue; }
      seenTask.add(key);
      const match = findNode(cands, 'work', r.task);
      const ambiguous = !!(match && match.ambiguous);
      const m = match && !ambiguous ? match : null;
      let blocked = '';
      if (m && (m.id === targetId)) blocked = '대상 업무와 같은 이름입니다';
      else if (m && containsReach(edges, m.id, targetId)) blocked = '이미 대상 업무의 상위 업무입니다';
      const endDate = r.due ? r.due.end : '';
      const past = !!endDate && (endDate < today || (!!docDate && endDate < docDate));
      tasks.push({
        key: `t${tasks.length + 1}`,
        label: r.task,
        due: r.due ? { text: r.due.text, value: r.due.iso || r.due.text, end: r.due.end } : null,
        owners: r.owners.map((o) => {
          const f = findNode(cands, 'person', o);
          if (f && f.ambiguous) notes.push(`「${o}」: 지도에 같은 이름의 사람이 둘 이상 있어 어느 사람인지 몰라 담당으로 잇지 않았습니다(「수정」에서 직접 이으세요)`);
          return { label: o, match: f && !f.ambiguous ? f : null, ...(f && f.ambiguous ? { ambiguous: true } : {}) };
        }),
        ...(r.uncertain ? { uncertain: true } : {}),
        past,
        match: m,
        ambiguous,
        blocked,
        exists: !!(m && !blocked && edgeExists(edges, targetId, m.id, 'contains')),
        quote: clip(line, 160),
        section: s.title,
      });
      if (ambiguous) notes.push(`지도에 「${r.task}」 업무가 둘 이상 있어 새 업무로 만듭니다`);
    }
  }
  const ownerKeys = [...new Set(tasks.flatMap((t) => t.owners.map((o) => normalizeLabel(o.label))))];
  if (ownerKeys.length > DOC_ATTACH_LIMITS.maxRoles) notes.push(`담당(사람·역할)이 ${DOC_ATTACH_LIMITS.maxRoles}개를 넘어 앞의 것만 만듭니다`);

  // 3) 메모: 미결 절 → issue(날짜는 오늘), 유의·추적 절 → caution(날짜는 문서 날짜). 미결이 우선
  // issue는 오늘 날짜로 넣는다: 문서 날짜(옛날)로 넣으면 이후 날짜의 「해결됨」 메모가 같은 대상의 미결을 바로 닫아 버린다(rules/issues.js openMemos)
  const memos = [];
  const cautionDate = docDate && docDate <= today ? docDate : today;
  const nameForMemo = clip(docLabel.replace(/[[\]]/g, ''), DOC_ATTACH_LIMITS.memoNameMax);
  // 내용을 앞에, 출처를 뒤에(카드 「지금 볼 것」은 앞부분만 보여서 출처가 앞이면 내용이 잘린다 — 메인 2026-10-28 C 캡처 확인)
  const sourceOf = (category) => (category === 'issue' && docDate ? ` — 출처: 「${nameForMemo}」(문서 날짜 ${docDate})` : ` — 출처: 「${nameForMemo}」`);
  const usedMemoSections = [];
  let memoCapped = 0;
  for (const s of sections) {
    if (!s.title) continue;
    const category = isIssueTitle(s.title) ? 'issue' : isCautionTitle(s.title) ? 'caution' : '';
    if (!category) continue;
    if (usedSections.includes(s.title)) continue; // 할 일 표가 있는 절의 줄은 메모로 읽지 않는다
    usedMemoSections.push(s.title);
    for (const sentence of itemsOf(s.lines, { speaker: true })) {
      // 날짜만 있는 줄·짧은 이름/부서 꼴 줄(문장 끝 없음)은 표 칸이 밀려 들어온 조각이라 메모로 만들지 않는다
      if (DATE_ONLY.test(sentence) || (sentence.length <= DOC_ATTACH_LIMITS.memoShortMax && !/[.!?]$|다$|요$/.test(sentence))) { unread.push({ text: clip(sentence, 160), why: '날짜·이름만 있는 짧은 줄은 메모로 읽지 않음', section: s.title }); continue; }
      if (memos.length >= DOC_ATTACH_LIMITS.maxMemos) { memoCapped += 1; continue; }
      const note = `${clip(sentence, DOC_ATTACH_LIMITS.memoMax)}${sourceOf(category)}`;
      const exists = (doc.events || []).some((e) => e.type === 'memo' && e.payload && e.payload.target_id === targetId && String(e.note || '').trim() === note);
      memos.push({ key: `m${memos.length + 1}`, category, text: note, date: category === 'issue' ? today : cautionDate, section: s.title, exists });
    }
  }
  if (memoCapped) notes.push(`메모는 ${DOC_ATTACH_LIMITS.maxMemos}건까지 읽습니다(${memoCapped}건은 읽지 않음)`);

  const skippedSections = sections.filter((s) => s.title && !usedSections.includes(s.title) && !usedMemoSections.includes(s.title) && !isDecisionTitle(s.title)).map((s) => s.title);
  const plan = {
    title: docLabel,
    docDate,
    today,
    targetId,
    targetLabel: target.label,
    doc: docItem,
    tasks,
    memos,
    unread,
    sections: { tables: usedSections, memos: usedMemoSections, decisions: sections.filter((s) => s.title && isDecisionTitle(s.title)).map((s) => s.title), skipped: skippedSections },
    notes: [...new Set(notes)], // 같은 알림은 한 번만
  };
  return { ok: true, source: 'rule', plan };
}

// ── 체크와 명령 ──────────────────────────────────────────────────────────────

/** 처음 체크: 문서 항목·지난 기한이 아닌 할 일·이미 있지 않은 메모. 막힌 할 일(대상 업무와 같은 이름·상위 업무)은 체크할 수 없다 */
export function defaultDocSelection(plan) {
  const tasks = {};
  const memos = {};
  for (const t of plan.tasks) tasks[t.key] = !t.past && !t.blocked && !t.exists && !t.uncertain; // 확인 필요(경계 행)도 처음 체크하지 않는다
  for (const m of plan.memos) memos[m.key] = !m.exists;
  return { doc: !plan.doc.exists, tasks, memos };
}

/** 체크를 계획에 맞춰 다듬는다(막힌 할 일은 늘 해제) */
export function resolveDocSelection(plan, selection) {
  const def = defaultDocSelection(plan);
  const sel = selection || {};
  const tasks = {};
  for (const t of plan.tasks) tasks[t.key] = !t.blocked && ((sel.tasks && sel.tasks[t.key] !== undefined) ? !!sel.tasks[t.key] : def.tasks[t.key]);
  const memos = {};
  for (const m of plan.memos) memos[m.key] = (sel.memos && sel.memos[m.key] !== undefined) ? !!sel.memos[m.key] : def.memos[m.key];
  return { doc: sel.doc !== undefined ? !!sel.doc : def.doc, tasks, memos };
}

/**
 * 계획 + 체크 → app.applyBatch 명령(항목 먼저, 연결·담당·메모 나중). 한 번의 묶음이라 하나라도 오류면 아무것도 저장되지 않는다.
 *  - 지도에 이미 있는 항목(match)은 새로 만들지 않고 그 id로 잇는다. 새 항목은 '@행번호'로 가리킨다
 *  - 하위 유형 「역할」이 아직 없으면 같은 묶음에서 먼저 등록한다(addSubtype, 이미 있으면 건너뜀)
 *  - 대상 업무 → 문서(references), 대상 업무 → 할 일(contains, skipDup), 담당 → 할 일(assign), 메모(addMemo, 대상 = 대상 업무)
 * @returns {{ops:object[], counts:{doc:number, tasks:number, roles:number, memos:number}}}
 */
export function planToOps(plan, selection, doc, { targetId = plan.targetId } = {}) {
  const sel = resolveDocSelection(plan, selection);
  const ops = [];
  const counts = { doc: 0, tasks: 0, roles: 0, memos: 0 };
  let row = 1;
  const roleRef = new Map(); // 정규화한 역할 이름 → id 또는 '@행'
  const cands = docCandidates(doc);
  const needRole = plan.tasks.some((t) => sel.tasks[t.key] && t.owners.some((o) => !o.match && !o.ambiguous && !findNode(cands, 'person', o.label)));
  const hasSubtype = ((doc.universe && doc.universe.subtypes) || []).some((s) => s && s.core_type === 'person' && s.name === SUBTYPE_ROLE);
  if (needRole && !hasSubtype) ops.push({ op: 'addSubtype', aux: true, input: { core_type: 'person', name: SUBTYPE_ROLE } });

  if (sel.doc) {
    let ref;
    if (plan.doc.match) ref = plan.doc.match.id;
    else {
      ops.push({ op: 'addNode', row, key: 'doc', input: { core_type: 'artifact', label: plan.doc.label, ...(plan.doc.description ? { description: plan.doc.description } : {}) } });
      ref = `@${row}`;
      row += 1;
      counts.doc = 1;
    }
    ops.push({ op: 'addEdge', row, key: 'doc-edge', skipDup: true, input: { source: targetId, target: ref, core_type: 'references' } });
    row += 1;
  }

  for (const t of plan.tasks) {
    if (!sel.tasks[t.key]) continue;
    let ref;
    if (t.match) ref = t.match.id;
    else {
      const attrs = t.due ? { 마감: t.due.value } : undefined;
      ops.push({ op: 'addNode', row, key: t.key, input: { core_type: 'work', label: t.label, description: clip(`문서 「${clip(plan.title, 40)}」의 ${t.section ? `「${t.section}」` : '표'}에서 가져옴`, TEXT_MAX), ...(attrs ? { attrs } : {}) } });
      ref = `@${row}`;
      row += 1;
      counts.tasks += 1;
    }
    ops.push({ op: 'addEdge', row, key: `${t.key}-edge`, skipDup: true, input: { source: targetId, target: ref, core_type: 'contains' } });
    row += 1;
    for (const o of t.owners) {
      if (o.ambiguous) continue; // 같은 이름 사람이 둘 이상: 어느 사람인지 몰라 잇지도, 새로 만들지도 않는다
      const k = normalizeLabel(o.label);
      if (!roleRef.has(k)) {
        const found = o.match || findNode(cands, 'person', o.label);
        if (found && found.ambiguous) continue;
        if (found && found.id) roleRef.set(k, found.id);
        else if (counts.roles >= DOC_ATTACH_LIMITS.maxRoles) continue;
        else {
          ops.push({ op: 'addNode', row, key: `role-${k}`, input: { core_type: 'person', label: o.label, subtype: SUBTYPE_ROLE } });
          roleRef.set(k, `@${row}`);
          row += 1;
          counts.roles += 1;
        }
      }
      ops.push({ op: 'assign', row, key: `${t.key}-assign-${k}`, input: { person_id: roleRef.get(k), work_id: ref } });
      row += 1;
    }
  }

  for (const m of plan.memos) {
    if (!sel.memos[m.key]) continue;
    ops.push({ op: 'addMemo', row, key: m.key, input: { target_id: targetId, occurred_at: m.date, category: m.category, note: m.text } });
    row += 1;
    counts.memos += 1;
  }
  return { ops, counts };
}

/**
 * 알림 문구(「문서 1·업무 n·메모 n 더함 — 되돌리려면 지도 관리 → 편집 되감기」).
 * 메모·담당 기록(사용자 이력)은 편집 되감기로 지워지지 않는다 — 있으면 그 사실을 알리고, 이슈 메모가 있을 때만 「해결로 표시」로 닫을 수 있다고 덧붙인다
 * @param {{issues?:number, assigns?:number}} [extra] 이슈 메모 수·담당 시작 기록 수
 */
export function attachNotice(created, memoCount, { issues = 0, assigns = 0 } = {}) {
  const works = created.filter((n) => n.core_type === 'work').length;
  const docs = created.filter((n) => n.core_type === 'artifact').length;
  const parts = [`문서 ${docs}`, `업무 ${works}`, `메모 ${memoCount}`];
  const roles = created.filter((n) => n.core_type === 'person').length;
  const kept = [memoCount ? '메모' : '', assigns ? '담당' : ''].filter(Boolean);
  const tail = kept.length ? ` (${kept.join('·')} 기록은 되감아도 남습니다${issues ? ' — 이슈 메모는 「해결로 표시」로 닫을 수 있습니다' : ''})` : '';
  return `${parts.join('·')} 더함${roles ? `(담당 역할 ${roles}개 포함)` : ''} — 되돌리려면 지도 관리 → 편집 되감기${tail}`;
}

// ── Claude 읽기 결과를 더하기(같은 묶음) ──────────────────────────────────────────

/**
 * Claude가 읽은 제안(글로 추가와 같은 모양)에서 규칙 계획이 이미 다루는 것(문서 이름·할 일·담당)과 같은 이름의 항목을 빼고,
 * 그 항목에 걸린 연결도 뺀다(같은 이름은 한 번만 만든다). 새로 만들 항목 수는 그대로 두고 키는 바꾸지 않는다.
 */
export function dedupeAiProposal(proposal, plan) {
  const taken = new Set([
    `artifact|${normalizeLabel(plan.doc.label)}`,
    ...plan.tasks.map((t) => `work|${normalizeLabel(t.label)}`),
    ...plan.tasks.flatMap((t) => t.owners.map((o) => `person|${normalizeLabel(o.label)}`)),
    `work|${normalizeLabel(plan.targetLabel || '')}`,
  ]);
  const dropped = new Set();
  const nodes = proposal.nodes.filter((n) => {
    const hit = taken.has(`${n.type}|${normalizeLabel(n.label)}`);
    if (hit) dropped.add(n.key);
    return !hit;
  });
  const edges = proposal.edges.filter((e) => !dropped.has(e.from) && !dropped.has(e.to));
  return { ...proposal, nodes, edges, droppedSame: dropped.size };
}

/**
 * Claude가 찾은 새 항목(업무 제외)을 지도에서 떠돌지 않게 잇는 방식(바꾸려면 여기 한 곳만 고친다).
 * from 'doc': 문서 항목에서(문서 항목이 없고 만들지도 않으면 대상 업무에서). 주제는 topic, 사람·조직·산출물은 other 관계로.
 * 지도에 이미 있던 항목(맞춘 것)은 잇지 않는다(새 항목만 — 이미 지도에 이어져 있고, 문서가 쌓일수록 선이 늘어나므로. 사용자 결정 2026-10-28).
 */
export const DOC_ATTACH_AI_LINK = Object.freeze({ from: 'doc', topic: 'relates_to', other: 'references' });

const shiftRef = (v, by) => (typeof v === 'string' && /^@\d+$/.test(v) ? `@${Number(v.slice(1)) + by}` : v);

/**
 * 규칙 계획의 명령 + Claude 제안의 명령(체크한 것만)을 한 묶음으로. Claude 쪽 새 업무는 대상 업무 아래(contains)에 잇는다.
 * Claude 제안의 새 항목은 지도 중심에 잇지 않는다(대상 업무 지도의 가지로만 자란다).
 * @param {object} plan readDocumentRule의 plan
 * @param {object} selection resolveDocSelection이 받는 체크
 * @param {{proposal:object, selection:object}|null} ai 있으면 Claude 제안과 그 체크(text-extract의 selection 모양)
 */
export function buildAttachOps(plan, selection, ai, doc, { targetId = plan.targetId } = {}) {
  const base = planToOps(plan, selection, doc, { targetId });
  const ops = [...base.ops];
  const counts = { ...base.counts, aiNodes: 0, aiEdges: 0, aiLinks: 0 };
  if (ai && ai.proposal) {
    const used = ops.reduce((m, o) => Math.max(m, o.row || 0), 0);
    const sub = proposalToOps(ai.proposal, ai.selection || defaultSelection(ai.proposal, 'none'), doc, { attachRoot: false });
    let next = used + sub.reduce((m, o) => Math.max(m, o.row || 0), 0);
    const contains = [];
    const links = [];
    for (const o of sub) {
      const row = (o.row || 0) + used;
      const shifted = { ...o, row, ...(o.input ? { input: { ...o.input } } : {}) };
      for (const k of ['source', 'target', 'person_id', 'work_id']) if (shifted.input && k in shifted.input) shifted.input[k] = shiftRef(shifted.input[k], used);
      ops.push(shifted);
      if (o.op === 'addNode') {
        counts.aiNodes += 1;
        if (o.input && o.input.core_type === 'work') contains.push({ key: `${o.key}-contains`, node: row });
        else if (o.input) links.push({ key: `${o.key}-doclink`, node: row, type: o.input.core_type });
      } else if (o.op === 'addEdge' || o.op === 'assign') counts.aiEdges += 1;
    }
    for (const c of contains) {
      next += 1;
      ops.push({ op: 'addEdge', row: next, key: c.key, skipDup: true, input: { source: targetId, target: `@${c.node}`, core_type: 'contains' } });
    }
    // 새 주제·사람·조직·산출물: 문서 항목에서 잇는다(문서가 지도에 없고 만들지도 않으면 대상 업무에서)
    const docOp = ops.find((o) => o.op === 'addNode' && o.key === 'doc');
    const from = DOC_ATTACH_AI_LINK.from === 'doc' ? (docOp ? `@${docOp.row}` : plan.doc.match ? plan.doc.match.id : targetId) : targetId;
    for (const l of links) {
      next += 1;
      ops.push({ op: 'addEdge', row: next, key: l.key, skipDup: true, input: { source: from, target: `@${l.node}`, core_type: l.type === 'topic' ? DOC_ATTACH_AI_LINK.topic : DOC_ATTACH_AI_LINK.other } });
      counts.aiLinks += 1;
    }
  }
  return { ops, counts };
}
