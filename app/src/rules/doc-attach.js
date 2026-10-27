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
});

/** 메모 범주: resolved·in_progress는 쓰지 않는다(resolved는 같은 대상의 열린 메모를 닫고, in_progress·issue는 매주 점검의 열린 항목으로 센다) */
export const DOC_ATTACH_MEMO_CATEGORIES = Object.freeze(['issue', 'caution']);

// ── 낱말·글 다루기 ───────────────────────────────────────────────────────────

const squash = (s) => String(s).replace(/\s+/g, '');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hasWord = (title, words) => { const t = squash(title); return words.some((w) => t.includes(w)); };
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
  if (noHead && /[\p{L}\p{N}]/u.test(noHead) && noHead.length >= 2) t = noHead;
  else if (WHOLE_BRACKET.test(t)) t = t.slice(1, -1).trim();
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

/**
 * 글 → {title, titleLine, sections:[{num, title, lines[]}]}. 첫 절(title '')은 제목 앞 머리말이다.
 * 빈 줄·※ 줄은 버린다. 번호 절 제목은 앞 번호 다음 번호일 때만(목록의 「1. …」을 제목으로 보지 않게)
 */
export function splitDocument(text) {
  const all = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const hasMd = all.some((l) => /^#{1,6}\s+\S/.test(l));
  const lines = all.filter((l) => l && !DOC_ATTACH_WORDS.skipLine.test(l));
  const first = lines[0] || '';
  const head8 = lines.slice(0, 8);
  const titleKey = head8.map((l) => /^제목\s*[:：]\s*(\S.*)$/.exec(l)).find(Boolean);
  let title = '';
  let rest = lines;
  if (first && !/^#{2,6}\s/.test(first)) {
    title = cleanTitle(WHOLE_BRACKET.test(first) && titleKey ? titleKey[1] : first);
    rest = lines.slice(1);
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

const NAME_PIECE = /^[\p{L}\p{N}·()]{2,20}$/u;
/** 담당 칸 → 사람(역할) 이름들. 「/」「,」로 나눈다. 읽을 수 없으면 null(그 행을 읽지 않는다) */
export function ownersOf(cell) {
  const v = oneLine(cell);
  if (!v) return [];
  if (DOC_ATTACH_WORDS.noOwner.includes(squash(v).toLowerCase())) return [];
  const pieces = v.split(/\s*[/／,，、]\s*/).map((p) => p.trim()).filter(Boolean);
  if (!pieces.length || pieces.length > DOC_ATTACH_LIMITS.ownersPerTask) return null;
  const out = [];
  for (const p of pieces) {
    if (!NAME_PIECE.test(p) || /다$/.test(p)) return null;
    if (DOC_ATTACH_WORDS.noOwner.includes(p.toLowerCase())) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** 과제 이름으로 쓸 수 있는가: 글자가 있고 문장 끝(다.)이 아니다 */
const taskNameOk = (s) => s.length >= 2 && s.length <= LABEL_MAX && /\p{L}/u.test(s) && !/다\.$/.test(s);

/** 행 하나 → {task, owners, due}|{why} */
function readRow(line, header) {
  let task;
  let ownerCell;
  let dueCell;
  if (header.cells) {
    const cells = cellsOf(line);
    if (!cells) return { why: '표의 칸으로 나뉘지 않는 줄' };
    if (isSeparator(cells)) return { skip: true };
    if (cells.length !== header.tokens.length) return { why: '칸 수가 머리줄과 다름' };
    task = cells[header.order.indexOf('task')];
    ownerCell = cells[header.order.indexOf('owner')];
    dueCell = cells[header.order.indexOf('due')];
  } else {
    // 공백만 있는 표(PDF에서 복사한 글): 머리줄이 「과제 담당 기한」 순서일 때만 줄 끝의 기한 → 그 앞 낱말(담당) → 나머지(과제)
    if (header.order.join() !== 'task,owner,due') return { why: '공백만 있는 표는 「과제 담당 기한」 순서일 때만 읽음' };
    const m = DATE_TAIL.exec(line);
    if (!m) return { why: '줄 끝에서 기한을 찾지 못함' };
    const before = line.slice(0, m.index).trim();
    const om = /^(.*\S)\s+(\S+)$/.exec(before);
    if (!om) return { why: '담당과 과제를 나눌 수 없음' };
    task = om[1].trim();
    ownerCell = om[2];
    dueCell = m[0].trim();
  }
  task = oneLine(task || '');
  if (!taskNameOk(task)) return { why: '과제 이름을 읽을 수 없음' };
  const owners = ownersOf(ownerCell || '');
  if (owners === null) return { why: '담당을 사람·역할 이름으로 읽을 수 없음' };
  let due = null;
  if (oneLine(dueCell || '')) {
    due = parseDue(dueCell);
    if (!due) return { why: '기한을 날짜로 읽을 수 없음' };
  }
  return { task, owners, due };
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
    if (s.title && hasWord(s.title, DOC_ATTACH_WORDS.decision)) decisions.push(...itemsOf(s.lines));
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
    const hi = s.lines.findIndex((l) => taskHeader(l));
    if (hi < 0) continue;
    const header = taskHeader(s.lines[hi]);
    usedSections.push(s.title);
    for (const line of s.lines.slice(hi + 1)) {
      const r = readRow(line, header);
      if (r.skip) continue;
      if (r.why) { unread.push({ text: clip(line, 160), why: r.why, section: s.title }); continue; }
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
          return { label: o, match: f && !f.ambiguous ? f : null };
        }),
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

  // 3) 메모: 미결 절 → issue, 유의·추적 절 → caution (미결이 우선)
  const memos = [];
  const memoDate = docDate && docDate <= today ? docDate : today;
  const prefix = `[${clip(docLabel, DOC_ATTACH_LIMITS.memoNameMax)}] `;
  const usedMemoSections = [];
  let memoCapped = 0;
  for (const s of sections) {
    if (!s.title) continue;
    const category = hasWord(s.title, DOC_ATTACH_WORDS.issue) ? 'issue' : hasWord(s.title, DOC_ATTACH_WORDS.caution) ? 'caution' : '';
    if (!category) continue;
    if (usedSections.includes(s.title)) continue; // 할 일 표가 있는 절의 줄은 메모로 읽지 않는다
    usedMemoSections.push(s.title);
    for (const sentence of itemsOf(s.lines, { speaker: true })) {
      if (memos.length >= DOC_ATTACH_LIMITS.maxMemos) { memoCapped += 1; continue; }
      const note = `${prefix}${clip(sentence, DOC_ATTACH_LIMITS.memoMax)}`;
      const exists = (doc.events || []).some((e) => e.type === 'memo' && e.payload && e.payload.target_id === targetId && String(e.note || '').trim() === note);
      memos.push({ key: `m${memos.length + 1}`, category, text: note, date: memoDate, section: s.title, exists });
    }
  }
  if (memoCapped) notes.push(`메모는 ${DOC_ATTACH_LIMITS.maxMemos}건까지 읽습니다(${memoCapped}건은 읽지 않음)`);

  const skippedSections = sections.filter((s) => s.title && !usedSections.includes(s.title) && !usedMemoSections.includes(s.title) && !hasWord(s.title, DOC_ATTACH_WORDS.decision)).map((s) => s.title);
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
    sections: { tables: usedSections, memos: usedMemoSections, decisions: sections.filter((s) => s.title && hasWord(s.title, DOC_ATTACH_WORDS.decision)).map((s) => s.title), skipped: skippedSections },
    notes,
  };
  return { ok: true, source: 'rule', plan };
}

// ── 체크와 명령 ──────────────────────────────────────────────────────────────

/** 처음 체크: 문서 항목·지난 기한이 아닌 할 일·이미 있지 않은 메모. 막힌 할 일(대상 업무와 같은 이름·상위 업무)은 체크할 수 없다 */
export function defaultDocSelection(plan) {
  const tasks = {};
  const memos = {};
  for (const t of plan.tasks) tasks[t.key] = !t.past && !t.blocked && !t.exists;
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
  const needRole = plan.tasks.some((t) => sel.tasks[t.key] && t.owners.some((o) => !o.match && !(findNode(cands, 'person', o.label))));
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
      const k = normalizeLabel(o.label);
      if (!roleRef.has(k)) {
        const found = o.match || findNode(cands, 'person', o.label);
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

/** 알림 문구(「문서 1·업무 n·메모 n 더함 — 되돌리려면 지도 관리 → 편집 되감기」). 메모는 되감아도 남으므로 메모가 있으면 한 줄 더 */
export function attachNotice(created, memoCount) {
  const works = created.filter((n) => n.core_type === 'work').length;
  const docs = created.filter((n) => n.core_type === 'artifact').length;
  const parts = [`문서 ${docs}`, `업무 ${works}`, `메모 ${memoCount}`];
  const roles = created.filter((n) => n.core_type === 'person').length;
  const tail = memoCount ? ' (메모는 되감아도 남습니다 — 필요 없으면 「해결로 표시」로 닫으세요)' : '';
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
  const counts = { ...base.counts, aiNodes: 0, aiEdges: 0 };
  if (ai && ai.proposal) {
    const used = ops.reduce((m, o) => Math.max(m, o.row || 0), 0);
    const sub = proposalToOps(ai.proposal, ai.selection || defaultSelection(ai.proposal, 'none'), doc, { attachRoot: false });
    let next = used + sub.reduce((m, o) => Math.max(m, o.row || 0), 0);
    const contains = [];
    for (const o of sub) {
      const row = (o.row || 0) + used;
      const shifted = { ...o, row, ...(o.input ? { input: { ...o.input } } : {}) };
      for (const k of ['source', 'target', 'person_id', 'work_id']) if (shifted.input && k in shifted.input) shifted.input[k] = shiftRef(shifted.input[k], used);
      ops.push(shifted);
      if (o.op === 'addNode') {
        counts.aiNodes += 1;
        if (o.input && o.input.core_type === 'work') contains.push({ key: `${o.key}-contains`, node: row });
      } else if (o.op === 'addEdge' || o.op === 'assign') counts.aiEdges += 1;
    }
    for (const c of contains) {
      next += 1;
      ops.push({ op: 'addEdge', row: next, key: c.key, skipDup: true, input: { source: targetId, target: `@${c.node}`, core_type: 'contains' } });
    }
  }
  return { ops, counts };
}
