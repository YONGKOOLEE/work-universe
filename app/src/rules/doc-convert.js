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
// [가정]·[미확인] 표시는 글자 그대로 남기고, 해당 노드의 attrs.상태에도 적는다(CR-3 AC ④).

import { newId } from '../model/commands.js';
import { ID_PREFIX, LABEL_MAX, SCHEMA_VERSION, SUBTYPE_ROLE, TEXT_MAX, normalizeLabel } from '../model/schema.js';

/** 변환 규칙의 값. 바꾸기 쉽게 한 곳에 둔다(CLAUDE.md 연속 진행 모드) */
export const CONVERT_RULES = {
  version: 'v1',
  nodeTarget: { min: 10, max: 20 }, // 월말 정산 수준(사용자 결정 2026-10-03). 벗어나면 미리 보기에서 알린다
  artifactLabelMax: 40, // 산출물 이름이 이보다 길면 앞부분만 이름으로, 전체는 설명으로
  maxInput: 200000, // 붙여 넣을 수 있는 글자 수
};

// 절 제목 → 무엇으로 바꿀지. 앞에 있는 것이 먼저다. 괄호 안 글자는 보지 않는다("비기능 요건 (…협의로 확정)")
const SECTION_KINDS = [
  ['artifacts', /산출물|결과물|제출물|양식|서식/],
  ['memos', /미확정|미결|질문|확정할|확인할|확인 ?필요|리스크|위험|이슈|문제점/],
  ['steps', /흐름|절차|프로세스|처리 ?순서|진행 ?순서/],
  ['people', /이해관계자|관계자|역할|담당자|연락처/],
  ['cautions', /주의사항|유의사항|유의 ?점|주의 ?점/],
  // 「범위 외」·「제외 사항」도 범위 제외(검토5 V-3 가). 제목 전체가 맞을 때만: 「장비 범위」·「수수료 제외 기준」·「대상 외부 기관 연계」는 아니다(재검증 1)
  ['scope_out', /^((업무 ?)?범위 ?(제외|외|밖)( ?(사항|항목|업무))?|제외 ?(범위|사항|대상|업무|항목)( ?업무)?|제외|비 ?범위|(적용 ?)?대상 ?외)$/],
  ['scope', /범위|대상 ?업무|업무 ?목록|하위 ?업무/],
  ['overview', /개요|요약|기본 ?정보|업무 ?정보/],
];
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
  ['owner', /^(작성 ?주체|작성자|작성 ?부서|주관|주관 ?부서|담당 ?부서|담당 ?팀)$/],
  ['work_attr', /^(주기|마감|사용 ?시스템|주의사항)$/], // 02-design 5.6 업무 속성 약속 → 대표 업무 속성
];
const ORG_HINT = /(사|팀|부|처|실|센터|기관|은행|공단|VAN)$|\//; // 소속으로 볼 앞 낱말(A사, 당사, 카드사/VAN, …팀)
const NOT_ORG = /^(외부|내부|일부|전부|본부|상부|하부|세부|실제|실무)$/; // '부'·'실'로 끝나지만 기관이 아닌 낱말(검토5 V-10)
const ROLE_SUFFIX = /^(담당|담당자|팀|부서|책임자|역할)$/;
const MARK = /\[(가정|미확인)[^\]]*\]/;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

// ── 문서 읽기 ───────────────────────────────────────────────────────────

/** 굵게·기울임·코드 표시를 걷어 내고 공백을 한 칸으로 */
export function cleanText(s) {
  return String(s)
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
    if (/^\s*$/.test(line)) {
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
  if (m) return { kind: 'bullet', text: cleanText(m[1]) };
  return null;
}

// ── 도우미 ──────────────────────────────────────────────────────────────

const refOf = (s) => (s.num ? `§${s.num}` : `「${s.title}」`);
const titleCore = (title) => title.replace(/\([^)]*\)/g, '').replace(MARK, '').trim();
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
const hasName = (s) => /\p{L}/u.test(stripMarks(String(s)).replace(/\([^)]*\)|（[^）]*）/g, ''));

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
function nameCellIndex(header, kind, cells) {
  const named = header && header.length ? header.findIndex((h) => NAME_HEADER[kind].test(cleanText(h))) : -1;
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
  const name = (cells[i] || '').trim() || (i === 0 ? null : null);
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
const statusOf = (...texts) => {
  const all = texts.filter(Boolean).join(' ');
  if (/\[미확인/.test(all)) return '미확인';
  if (/\[가정/.test(all)) return '가정';
  return null;
};
const marksOf = (t) => (String(t).match(new RegExp(MARK.source, 'g')) || []);
const stripMarks = (s) => s.replace(new RegExp(MARK.source, 'g'), '').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compact = (s) => normalizeLabel(s).replace(/\s/g, '');
const contains = (hay, needle) => needle.length >= 2 && compact(hay).includes(compact(needle));
const circled = (i) => CIRCLED[i] || `(${i + 1})`;

function sectionKind(section) {
  for (let s = section; s; s = s.parent) {
    const core = titleCore(s.title);
    const hit = SECTION_KINDS.find(([, re]) => re.test(core));
    if (hit) return hit[0];
  }
  return 'topic';
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
    else lines.push({ text: b.text, n: b.kind === 'num' ? b.n : undefined, kind: b.kind, ...(b.sub ? { sub: true } : {}) });
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
      for (const row of b.rows) if (row.length >= 2 && row[0]) out.push([row[0], row.slice(1).filter(Boolean).join(' — '), b]);
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
      used += 1;
      block.used = true;
      info.refs.add(ref);
      if (k === 'scope') info.scope.push({ text: v, ref: `${ref} 범위` });
      else if (k === 'scope_out') info.scope_out.push(v);
      else if (k === 'people') info.people.push({ text: v, ref: `${ref} ${cleanText(key)}` });
      else if (k === 'work_attr') {
        const wk = cleanText(key).replace(/\s/g, ' ');
        if (!(wk in info.work_attrs)) info.work_attrs[wk] = v; // 이미 있는 속성은 덮어쓰지 않는다(corpus F8)
      }
      else if (k === 'date') info.date = info.date || findDate(v);
      else if (!info[k]) info[k] = v;
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
      if (!info.purpose && rest.length) info.purpose = rest.map((b) => b.text).join(' ');
      if (s.blocks.length) sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'overview', made: used });
    }
  }
  if (!info.date) info.date = headDate([parsed.title, ...intro].filter(Boolean).join(' '));
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
    const clean = stripMarks(label).slice(0, LABEL_MAX) || label.slice(0, LABEL_MAX);
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
    for (const l of lines) {
      if (!l.cells) { info.scope.push({ text: l.text, ref: refOf(s), desc: null }); continue; }
      const { name: cellName, desc } = nameAndRest(l.cells, l.header, 'scope'); // 구분 열이 있는 표도 업무 이름 칸을 쓴다(검토5 V-1)
      if (!cellName) { notes.push({ code: 'C-ROW-NO-NAME', ref: refOf(s), row: l.row }); continue; }
      info.scope.push({ text: cellName, ref: refOf(s), desc });
    }
    if (lines.some((l) => l.cells && nameCellIndex(l.header, 'scope') > 0)) notes.push({ code: 'C-TABLE-NAME-COL', ref: refOf(s), col: nameCellIndex(lines.find((l) => l.cells).header, 'scope') + 1 });
    sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'scope', made: lines.length });
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
    works.push(pushNode('work', name, { ref: stepRefs[0] || (parsed.title ? '제목' : '전체') }));
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
  for (const s of parsed.sections.filter((x) => x.kind === 'topic')) {
    const lines = linesOf(s.blocks);
    if (!lines.length) continue; // 하위 절만 있는 절
    // 괄호뿐인 제목(「7. (참고)」)은 괄호 안 글자를 이름으로(재검증 R3). 괄호 안도 비면 아래에서 C-NO-NAME
    const inner = stripMarks(s.title).replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim();
    const core = titleCore(s.title) || s.title;
    const label = hasName(core) ? core : inner || core;
    if (!hasName(label)) { notes.push({ code: 'C-NO-NAME', ref: refOf(s), text: s.title }); continue; } // 「## 3.」처럼 번호뿐인 제목
    const headNote = (s.title.match(new RegExp(`\\([^)]*\\)|${MARK.source}`, 'g')) || []).join(' ');
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

  // 사람(역할): 개요의 이해관계자 + 이해관계자 절
  const roleItems = [];
  for (const p of info.people) for (const part of splitList(p.text)) roleItems.push({ text: part, ref: p.ref });
  for (const s of parsed.sections.filter((x) => x.kind === 'people')) {
    const lines = linesOf(s.blocks);
    for (const l of lines) {
      if (l.cells) {
        const { name: cellName, desc, duty } = nameAndRest(l.cells, l.header, 'people');
        if (!cellName) { notes.push({ code: 'C-ROW-NO-NAME', ref: refOf(s), row: l.row }); continue; }
        roleItems.push({ text: cellName, ref: refOf(s), desc: desc || '', duty: duty || '' });
      }
      else {
        const kv = /^([^:：[]{1,30})[:：]\s*(.+)$/.exec(l.text);
        roleItems.push(kv ? { text: kv[1], ref: refOf(s), desc: kv[2] } : { text: l.text, ref: refOf(s) });
      }
    }
    sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'people', made: lines.length });
  }
  const roles = [];
  const roleDuty = new Map(); // 역할 노드 → [{text, ref}] 원문에 적힌 하는 일(담당 추정의 근거)
  for (const item of roleItems) {
    for (const label of item.desc ? [item.text] : expandRoles(item.text)) {
      if (!hasName(label)) { notes.push({ code: 'C-NO-NAME', ref: item.ref, text: label }); continue; }
      const { org } = roleParts(label);
      const r = pushNode('person', label, { ref: item.ref, subtype: SUBTYPE_ROLE, description: item.desc, attrs: org ? { 소속: org } : {}, status: statusOf(label, item.desc) });
      if (!roles.includes(r)) roles.push(r);
      if (item.desc) {
        if (!roleDuty.has(r)) roleDuty.set(r, []);
        roleDuty.get(r).push({ text: item.duty !== undefined ? item.duty : item.desc, ref: item.ref }); // 표면 「하는 일」 칸만, 아니면 설명 전체
      }
    }
  }
  if (roles.length) subtypes.set(`person|${SUBTYPE_ROLE}`, { core_type: 'person', name: SUBTYPE_ROLE });

  // 산출물: "가 → 나 → 다", 목록, 표의 이름 칸(산출물·문서·이름 칸, 첫 칸이 번호면 다음 칸 — corpus F5)
  const artifacts = [];
  for (const s of parsed.sections.filter((x) => x.kind === 'artifacts')) {
    let order = 0;
    let made = 0;
    for (const l of linesOf(s.blocks)) {
      const cell = l.cells ? nameAndRest(l.cells, l.header, 'artifacts') : null;
      if (cell && !cell.name) { notes.push({ code: 'C-ROW-NO-NAME', ref: refOf(s), row: l.row }); continue; }
      const parts = cell ? [cell.name] : l.text.includes('→') ? l.text.split(/\s*→\s*/) : l.n !== undefined || l.kind === 'bullet' ? [l.text] : splitList(l.text);
      const ordered = l.text.includes('→') || l.n !== undefined;
      for (const p of parts.filter(Boolean)) {
        const m = /^(.+?)\s*\(([^)]*)\)\s*$/.exec(p);
        let label = m ? m[1] : p;
        let desc = m ? m[2] : cell ? cell.desc || '' : '';
        if (!hasName(label)) { notes.push({ code: 'C-NO-NAME', ref: refOf(s), text: p }); continue; }
        if (label.length > CONVERT_RULES.artifactLabelMax) {
          desc = [p, desc].filter(Boolean).join(' — ');
          label = `${label.slice(0, CONVERT_RULES.artifactLabelMax - 1)}…`;
        }
        if (ordered) order += 1;
        const a = pushNode('artifact', label, { ref: refOf(s), description: desc || undefined, attrs: ordered ? { 순서: order } : {}, status: statusOf(p) });
        if (!artifacts.includes(a)) artifacts.push(a);
        made += 1;
      }
    }
    sections.push({ order: parsed.sections.indexOf(s), ref: refOf(s), title: s.heading, kind: 'artifacts', made });
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
  for (const r of roles) {
    const { core } = roleParts(r.label);
    const hits = topics.filter((t) => contains(t.node.label, core));
    for (const t of hits) pushEdge(r.id, t.node.id, 'relates_to', '규칙 기반 추정: 역할 이름과 주제 이름이 겹침');
    // 담당(수행): 원문이 그 역할의 하는 일로 업무 이름을 적은 경우만. 기간은 원문에 없으므로 두지 않는다(= 지금 담당으로 계산)
    // 하는 일을 쉼표로 나눈 항목이 업무 이름과 같을 때만 잇는다(D3-33). "결과 승인"처럼 업무 이름이 일부만 들어간 항목(결재·수강)은 담당이 아니다
    const duties = roleDuty.get(r) || [];
    const bare = (t) => compact(stripMarks(t).replace(/\([^)]*\)|（[^）]*）/g, '').replace(/[.。·\s]+$/, ''));
    const dutyItems = duties.flatMap((d) => splitList(d.text).map((t) => ({ text: t, ref: d.ref })));
    // 글자 그대로 같은 업무가 먼저다. 그런 업무가 없을 때만 괄호를 뗀 값으로 비교한다(「승인(재처리)」 업무가 있으면 「승인」에 붙이지 않는다, 2차 B)
    const half = (t) => t.replace(/（/g, '(').replace(/）/g, ')'); // 전각 괄호는 반각과 같게 본다(3차 3)
    const exact = (t) => compact(half(stripMarks(t)).replace(/[.。·\s]+$/, ''));
    const dutyHit = (t, w) => exact(t.text) === exact(w.label) || (!works.some((x) => exact(t.text) === exact(x.label)) && bare(t.text) === compact(w.label));
    const done = works.filter((w) => dutyItems.some((t) => dutyHit(t, w)));
    for (const w of done) {
      const d = dutyItems.find((t) => dutyHit(t, w));
      pushEdge(r.id, w.id, 'performs', `규칙 기반 추정: 원문 ${d.ref}의 하는 일에 「${w.label}」이(가) 나옴(기간 미기재)`);
      performs += 1;
    }
    if (!hits.length && !done.length) pushEdge(rootId, r.id, 'contains');
  }
  if (performs) notes.push({ code: 'C-PERFORMS-GUESS', count: performs });
  for (const a of artifacts) pushEdge(rootId, a.id, 'contains');

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
  descParts.push('문서에서 규칙 기반으로 초벌 변환한 유니버스(CR-5).');
  const universe = {
    id: newId(ID_PREFIX.universe, random),
    name,
    level: '업무',
    owner: info.owner ? truncate(info.owner, LABEL_MAX, notes, '작성 주체') : '',
    description: truncate(descParts.join(' '), TEXT_MAX, notes, '유니버스 설명'),
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
