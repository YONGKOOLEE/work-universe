// 문서로 더하기의 Claude 읽기(CR-23). 글로 추가의 Claude 읽기(llm/ai-extract.js·connector.extractTextAsync)를 그대로 쓴다 — 호출·인용 검증은 새로 만들지 않는다.
// 문서가 글로 추가의 글자 상한(TEXT_LIMITS.maxChars)을 넘으면 절 단위로 상한 이하 덩어리로 나눠 차례로 보내고, 결과를 합친다(같은 이름은 하나로).
//   chunkDocument(text, max)         글 → 상한 이하 덩어리들(절 경계에서 나눈다)
//   mergeProposals(proposals, view)  덩어리별 제안 → 하나의 제안(같은 유형·이름 합침, 지도와 다시 맞댐)
//   readDocumentAi(text, opts)       덩어리마다 extractTextAsync → 합친 제안. 실패하면 ok:false + 이유 한 줄(화면이 규칙 결과를 대신 보인다)
// 순수 함수 + 주입된 읽기 함수만 부른다 — DOM·저장소를 쓰지 않는다. 실제 API 응답의 모습은 미확인(가짜 공급자로만 시험).

import { normalizeLabel } from '../model/schema.js';
import { TEXT_LIMITS, createBuilder, finalizeProposal } from '../rules/text-extract.js';
import { extractTextAsync } from './connector.js';

/** 덩어리 수 상한(호출 수 = 비용). 넘으면 앞에서부터 읽고 알린다 */
export const AI_DOC_MAX_CHUNKS = 8;

/**
 * 글 → 덩어리 목록. 제목 + 절을 순서대로 채우다가 상한을 넘으면 다음 덩어리로 넘어가고, 절 하나가 상한보다 크면 줄 단위로 자른다.
 * 덩어리 글은 원문의 줄을 그대로(앞뒤 공백만 정리) 이은 것이다 — Claude가 따오는 인용은 보낸 덩어리 안에서 검증된다.
 */
export function chunkDocument(text, max = TEXT_LIMITS.maxChars) {
  const src = String(text ?? '');
  if (src.length <= max) return src.trim() ? [src] : [];
  // 줄 단위 조각(빈 줄·※ 줄은 버린다). 절 제목처럼 보이는 줄(「## 제목」「3. 제목」「■ 제목」)은 다음 줄과 같은 덩어리에 둔다
  const pieces = [];
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('※')) continue;
    const head = l.length <= 40 && /^(?:#{1,6}\s|\d{1,2}\s*[.)]\s+\S|[■□▣◆◇●○▶【[])/.test(l);
    if (l.length <= max) pieces.push({ text: l, head });
    else for (let i = 0; i < l.length; i += max) pieces.push({ text: l.slice(i, i + max), head: false });
  }
  const chunks = [];
  let cur = '';
  pieces.forEach((p, i) => {
    const add = cur ? `\n${p.text}` : p.text;
    const need = p.head && pieces[i + 1] ? add.length + 1 + pieces[i + 1].text.length : add.length;
    if (cur && cur.length + need > max) {
      chunks.push(cur);
      cur = p.text;
    } else cur += add;
  });
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** 덩어리별 제안(extractTextAsync가 돌려준 proposal)을 하나로 합친다. 같은 유형·이름은 먼저 나온 것 하나, 연결도 같은 쌍·관계는 하나 */
export function mergeProposals(proposals, view = null) {
  const b = createBuilder(TEXT_LIMITS);
  const notes = [];
  const unread = [];
  const unreadWhy = [];
  let unreadContext = false;
  let ctxVeto = false;
  const add = (arr, x) => { if (x && !arr.includes(x)) arr.push(x); };
  for (const p of proposals) {
    const map = new Map();
    for (const n of p.nodes) {
      const nn = b.addNode({ type: n.type, label: n.label, emp_no: n.emp_no || '' }, n.quote);
      if (nn) map.set(n.key, nn);
    }
    for (const e of p.edges) {
      const a = map.get(e.from);
      const c = map.get(e.to);
      if (!a || !c) continue;
      const made = b.addEdge(a, c, e.type, e.quote, e.verb || '');
      if (made && typeof e.hold === 'string' && e.hold) made.hold = e.hold;
    }
    for (const n of p.notes || []) add(notes, n);
    (p.unread || []).forEach((u, i) => { unread.push(u); unreadWhy.push((p.unreadWhy || [])[i] || ''); });
    unreadContext = unreadContext || !!p.unreadContext;
    ctxVeto = ctxVeto || !!p.ctxVeto;
  }
  const merged = finalizeProposal({ method: 'claude_api', nodes: b.nodes, edges: b.edges, unread, unreadWhy, partial: [], notes: [], unreadContext, ctxVeto }, view);
  for (const n of notes) if (!merged.notes.includes(n)) merged.notes.push(n);
  return merged;
}

/** 같은 이름이 한 번만 남았는지 보는 도우미(테스트용) */
export const labelKeys = (proposal) => proposal.nodes.map((n) => `${n.type}|${normalizeLabel(n.label)}`);

/**
 * Claude로 문서 읽기. 덩어리마다 글로 추가의 Claude 읽기를 부른다(키가 없으면 null).
 * @param {string} text 붙여 넣은 문서 글
 * @param {{provider:object|null, view?:object|null, extract?:Function, maxChars?:number, maxChunks?:number}} opts extract: 주입(시험용), 기본 extractTextAsync
 * @returns {Promise<null | {ok:true, proposal:object, dropped:object[], chunks:number, failed:{index:number, reason:string}[], model:string} | {ok:false, fallback:{reason:string}}>}
 */
export async function readDocumentAi(text, { provider = null, view = null, extract = extractTextAsync, maxChars = TEXT_LIMITS.maxChars, maxChunks = AI_DOC_MAX_CHUNKS } = {}) {
  const all = chunkDocument(text, maxChars);
  if (!all.length) return { ok: false, fallback: { reason: '읽을 글이 비어 있습니다' } };
  const chunks = all.slice(0, maxChunks);
  const proposals = [];
  const dropped = [];
  const failed = [];
  let model = '';
  for (let i = 0; i < chunks.length; i += 1) {
    const r = await extract(chunks[i], { provider, view });
    if (r === null) return null; // 키가 없다(실시간 공급자가 아님)
    if (r.ok) {
      proposals.push(r.proposal);
      dropped.push(...(r.dropped || []));
      model = r.model || model;
    } else failed.push({ index: i + 1, reason: r.fallback && r.fallback.reason ? r.fallback.reason : '알 수 없는 오류' });
  }
  if (!proposals.length) return { ok: false, fallback: { reason: failed.length ? failed[0].reason : '읽은 항목이 없음' } };
  const proposal = mergeProposals(proposals, view);
  if (all.length > chunks.length) proposal.notes.push(`문서가 길어 앞의 ${chunks.length}덩어리(전체 ${all.length}덩어리)만 보냈습니다`);
  if (failed.length) proposal.notes.push(`${chunks.length}덩어리 중 ${failed.length}덩어리는 읽지 못했습니다(${failed[0].reason}) — 나머지 결과만 보입니다`);
  return { ok: true, proposal, dropped, chunks: chunks.length, failed, model };
}
