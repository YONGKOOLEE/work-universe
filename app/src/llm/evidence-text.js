// 근거 글 만들기(순수). 노드·이력을 사람이 읽는 한 줄 글로 옮긴다.
// 쓰임: ① tools/pregen-dump.mjs(사전 생성 작성용 덤프) ② 실시간 Claude API 프롬프트 재료 ③ quote 검증(응답 인용이 이 글에 있어야 한다, CR-15).
// "규칙이 고른 근거만 보낸다"를 코드로 보장하려고 세 곳이 같은 함수를 쓴다. 브라우저 기능을 쓰지 않는다.

import { eventText } from '../view/describe.js';

/**
 * 근거 ID 하나를 글로. 노드: 「gid [유형·하위유형] 이름 (사번) — 설명 {속성}」, 이력: 「gid [이력 시각] 문장」, 없으면 「gid (없음)」
 * @param {object} view buildView 결과(lookup, events)
 * @param {string} gid
 */
export function describeEvidence(view, gid) {
  const hit = view.lookup(gid);
  if (hit.found) {
    const n = hit.node;
    const attrs = Object.entries(n.attrs || {}).map(([k, v]) => `${k}=${v}`).join('; ');
    return `${gid} [${n.type_label}${n.subtype ? `·${n.subtype}` : ''}] ${n.label}${n.emp_no ? ` (${n.emp_no})` : ''}${n.description ? ` — ${n.description}` : ''}${attrs ? ` {${attrs}}` : ''}`;
  }
  const ev = view.events.find((e) => e.gid === gid);
  return ev ? `${gid} [이력 ${ev.occurred_at}] ${eventText(view, ev)}` : `${gid} (없음)`;
}

/** 근거 ID 여러 개의 글(한 줄씩) */
export const describeAll = (view, ids) => ids.map((g) => describeEvidence(view, g));

/** quote 비교용 정규화: NFC로 맞추고 공백을 모두 없애고 소문자로(공백·대소문자·한글 조합 방식 무시, CR-15) */
export const normalizeQuote = (s) => String(s).normalize('NFC').replace(/\s+/g, '').toLowerCase();

/** quote 한 줄의 길이 범위(정규화한 뒤 글자 수). 짧은 인용은 어디에나 있어 근거가 되지 못하고, 너무 긴 인용은 원문을 통째로 베낀 것이다(R10-1·R10-9) */
export const QUOTE_MIN = 8;
export const QUOTE_MAX = 300;

/**
 * 정규화한 인용의 모양이 맞는가: 8~300글자이고 그 안에 글자·숫자가 8개 이상(`|---|---|` 같은 표 구분선·기호만의 인용은 근거가 되지 못함).
 * @param {string} q normalizeQuote 결과
 * @returns {null|'short'|'long'|'symbols'} 문제가 없으면 null
 */
export function quoteShapeProblem(q) {
  if (q.length < QUOTE_MIN) return 'short';
  if (q.length > QUOTE_MAX) return 'long';
  const letters = q.match(/[\p{L}\p{N}]/gu);
  return letters && letters.length >= QUOTE_MIN ? null : 'symbols';
}

/** 근거 글 머리 「gid [유형·하위유형]」 (describeEvidence가 붙이는 형식 글자). 인용은 본문에서만 찾는다 */
const EVIDENCE_HEAD = /^\S+\s+\[[^\]]*\]\s*/;
export const evidenceBody = (t) => String(t).replace(EVIDENCE_HEAD, '');

/**
 * 인용(quote)이 근거 글 안에 실제로 있는가. 근거 글은 그 문장의 근거 ID들의 글이다.
 * 머리(`gid [유형]`)는 떼고 본문만 비교한다 — 형식 글자(`U-A1/N-000`·`[꼭지]`)만 인용해서는 통과하지 못한다.
 * @param {string} quote
 * @param {string[]} evidenceTexts 문장의 근거 ID별 글
 */
export function quoteInEvidence(quote, evidenceTexts) {
  if (typeof quote !== 'string') return false;
  const q = normalizeQuote(quote);
  if (quoteShapeProblem(q)) return false;
  return evidenceTexts.some((t) => normalizeQuote(evidenceBody(t)).includes(q));
}

/**
 * 연결 인용 완화(표의 줄임말 칸): 연결의 인용은 표 한 칸(「법무/영업」)만 따올 수 있어 8글자에 못 미친다.
 * 아래를 모두 만족하면 짧아도 근거로 받는다 — 글자·숫자 minChars개 이상, 원문에 있고, 그 인용이 있는 줄을 가운데로 앞뒤 lineWindow줄 안에
 * (같은 줄 포함) 연결 끝 항목 이름(전체)이 있다. 가로 표는 한 줄, PDF에서 복사해 칸마다 줄이 나뉜 표(과제/담당/기한)는 몇 줄 떨어진다.
 * 노드 인용에는 쓰지 않는다. 판정 기준은 이 상수 한 곳(바꾸기 쉽게).
 */
export const EDGE_SHORT_QUOTE = { minChars: 2, lineWindow: 3 };

/**
 * @param {string} text 문서 원문
 * @param {string} quote 모델이 준 인용(짧은 것)
 * @param {string[]} endLabels 연결 양 끝 항목 이름
 * @param {string[]} [rowLabels] 표의 행 이름이 될 수 있는 항목 이름들(업무 이름 전부) — 칸 덩어리 순서 맞추기(tableRankOk)에 쓴다
 * @returns {boolean}
 */
export function shortEdgeQuoteOk(text, quote, endLabels, rowLabels = []) {
  const q = normalizeQuote(quote);
  if (q.length >= QUOTE_MIN) return false; // 짧지 않은 인용은 이 길이 밖(보통 검사)
  if ((q.match(/[\p{L}\p{N}]/gu) || []).length < EDGE_SHORT_QUOTE.minChars) return false;
  const ends = endLabels.map(normalizeQuote).filter(Boolean);
  // 인용은 한 끝 항목을 가리켜야 한다: 인용을 「/」·「,」·「·」 등으로 나눈 조각(글자 minChars개 이상) 하나가 그 끝 이름 안에 있음(「법무」 ⊂ 「법무·준법팀」).
  // 그래야 다른 행의 담당 칸(「재무정산」)을 따와 엉뚱한 끝(영업팀)과 근처 업무를 잇는 연결이 걸러진다
  const pieces = String(quote).split(/[\s/／,，、·ㆍ]+/).map(normalizeQuote).filter((p) => (p.match(/[\p{L}\p{N}]/gu) || []).length >= EDGE_SHORT_QUOTE.minChars);
  const named = ends.filter((l) => pieces.some((p) => l.includes(p)));
  if (!named.length) return false;
  // 줄 단위로 나눠 인용이 있는 줄 앞뒤 lineWindow줄 안(같은 줄 포함)에서, 인용이 가리킨 끝이 아닌 다른 끝 항목 이름(전체)을 찾는다.
  // 인용이 들어 있는 이름(인용 「재무정산」과 「재무정산팀」)은 그 줄 자체라 근거가 못 된다
  const lines = String(text).split(/\r\n?|\n/).map(normalizeQuote);
  const w = EDGE_SHORT_QUOTE.lineWindow;
  // 칸이 한 줄씩 떨어진 표로 확인되면 표 순서가 정답이다 — 줄 거리 창은 세로 표에서 이웃 행의 과제와도 짝을 맞춰 버린다
  const ranked = tableRankOk(text, q, named, ends, rowLabels);
  if (ranked !== null) return ranked;
  return lines.some((line, i) => {
    if (!line.includes(q)) return false;
    const near = lines.slice(Math.max(0, i - w), i + w + 1);
    return named.some((n) => ends.some((l) => l !== n && !l.includes(q) && near.some((x) => x.includes(l))));
  });
}

/**
 * 칸 덩어리 순서 맞추기(PDF에서 복사한 표): 칸이 한 줄씩 떨어지면 「과제 줄 n개 → 담당 줄 n개 → 기한 줄 n개」 덩어리로 나오고,
 * 쪽이 바뀌면 다음 절 제목이 덩어리 사이에 끼어 담당 칸이 과제 이름과 lineWindow줄보다 멀어진다(2026 회의록 실행 계획 표, 사용자 원문 2026-10-28).
 * 그때는 표 안에서 k번째 과제 줄과 k번째 담당 줄이 짝이다. 아래를 모두 만족할 때만 받는다(억지로 짝 맞추지 않게 좁게):
 * 인용이 한 줄 전체(칸 하나)이고, 그 위 maxBack줄 안에 머리 낱말 줄(「담당」 등)이 있고, 머리줄부터 긴 문장 줄 전까지(표 범위)에서
 * 행 이름 줄(rowLabels와 같은 줄)과 칸 줄(날짜·절 제목·머리 낱말이 아닌 짧은 줄)의 수가 같고, 인용 줄의 순번 = 다른 끝(행 이름)의 순번.
 */
export const TABLE_RANK = { maxBack: 30, maxSpan: 40, cellMax: 30, headWords: ['과제', '담당', '담당자', '담당부서', '기한', '일정', '완료일', '책임', '책임자', '비고', '구분'] };

/** @returns {boolean|null} 표 구조로 판정했으면 참·거짓, 칸 덩어리 표가 아니면 null(줄 거리 창으로 판정) */
function tableRankOk(text, q, named, ends, rowLabels) {
  const rows = new Set((rowLabels || []).map(normalizeQuote).filter(Boolean));
  if (rows.size < 2) return null;
  const raw = String(text).split(/\r\n?|\n/).map((l) => l.trim());
  const norm = raw.map(normalizeQuote);
  const heads = new Set(TABLE_RANK.headWords);
  const isDate = (l) => /^\d{4}\.\s*\d{1,2}\s*[\.월]/.test(l) || /^\d{4}(?:-\d{2}|년)/.test(l); // 「2026. 11. 13.」·「2017. 3월 말」·「2026-11」·「2026년 …」
  const isHeading = (l) => /^\d{1,2}\s*[.)]\s+\S/.test(l) || /^#{1,6}\s/.test(l);
  for (let i = 0; i < raw.length; i += 1) {
    if (norm[i] !== q) continue; // 칸 하나가 한 줄 전체여야 한다
    let h = -1;
    for (let k = i - 1; k >= Math.max(0, i - TABLE_RANK.maxBack); k -= 1) if (norm[k] === '담당' || norm[k] === '담당자' || norm[k] === '담당부서') { h = k; break; }
    if (h < 0) continue;
    const cells = [];
    const tasks = [];
    for (let k = h + 1; k < Math.min(raw.length, h + 1 + TABLE_RANK.maxSpan); k += 1) {
      const l = raw[k];
      if (!l) continue;
      if (rows.has(norm[k])) { tasks.push(norm[k]); continue; }
      if (norm[k].length > TABLE_RANK.cellMax || /다\.?$/.test(l)) break; // 긴 문장 줄이 나오면 표가 끝났다
      if (heads.has(norm[k]) || isDate(l) || isHeading(l)) continue;
      cells.push(k);
    }
    if (tasks.length < 2 || tasks.length !== cells.length) continue;
    const rank = cells.indexOf(i);
    if (rank < 0) continue;
    const row = tasks[rank];
    return named.some((n) => ends.some((l) => l !== n && l === row));
  }
  return null;
}
