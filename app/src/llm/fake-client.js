// 시험용 가짜 Anthropic 클라이언트(CR-15). 실제 호출 없이 messages.parse를 흉내 낸다.
// 쓰임: 단위 테스트, 그리고 점검 주소(?check)의 window.__wu.useFakeLlm(브라우저 점검이 「생성 중→교체→실패 대체」를 보도록).
// 프롬프트(prompts.js의 형식)를 되읽어 규칙 기반 문장을 그대로 돌려주는 "착실한 모델" 흉내를 기본으로 한다.
// 키·네트워크를 쓰지 않는다. 브라우저 기능을 쓰지 않는다.

import Anthropic from '@anthropic-ai/sdk';
import { evidenceBody } from './evidence-text.js';
import { parseCandidatesUser, parseConvertUser, parseExtractUser, parsePrompt } from './prompts.js';
import { extractFromText } from '../rules/text-extract.js';

/** 근거 글 한 줄에서 머리(「gid [유형]」)를 뗀 본문의 앞부분을 quote로 쓴다(근거 글 본문에 글자 그대로 있는 구절, 8글자 이상) */
function quoteOf(line, gid) {
  if (!gid) return '';
  return evidenceBody(String(line || '')).trim().slice(0, 20).trim();
}

const isConvert = (params) => !!(params.output_config && params.output_config.format && params.output_config.format.schema.properties.works);

// ── 문서 변환 응답 흉내(T-37): 원문의 줄을 그대로 인용하는 "착실한 모델". 모양은 llm/ai-convert.js의 AI_CONVERT_SCHEMA ──
const FAKE_BAD_QUOTE = '원문 어디에도 없는 지어낸 문장입니다';
const cells = (line) => line.split('|').map((c) => c.trim()).filter(Boolean);
const fillWork = (label, quote, attrs = {}) => ({ label, description: '', attrs: { 절차: '', 주기: '', 마감: '', 주의사항: '', '사용 시스템': '', ...attrs }, quote });

function convertAnswer(mode, doc) {
  const bad = mode === 'badquote' || mode === 'convert-badquote';
  const lines = doc.split('\n').map((l) => l.trim()).filter(Boolean);
  const heading = lines.find((l) => /^#\s/.test(l)) || lines[0] || '';
  const row = (re) => lines.find((l) => re.test(l));
  const q = (line) => (bad ? FAKE_BAD_QUOTE : line);

  const scopeLine = row(/^\|\s*범위\s*\|/);
  const workNames = scopeLine ? (cells(scopeLine)[1] || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean) : [];
  const stepLines = lines.filter((l) => /^\d+\.\s/.test(l) && !/\?$/.test(l)).slice(0, 5);
  const circled = '①②③④⑤';
  const works = workNames.map((w, i) => fillWork(w, q(scopeLine), i === 0 && stepLines.length ? { 절차: stepLines.map((l, k) => `${circled[k]} ${l.replace(/^\d+\.\s*/, '')}`).join(' ') } : {}));
  if (!works.length && heading) works.push(fillWork(heading.replace(/^#+\s*/, '').slice(0, 40), q(heading)));
  if (mode === 'convert') works.push(fillWork('지어낸 업무', FAKE_BAD_QUOTE));

  const peopleLine = row(/^\|\s*이해관계자\s*\|/);
  const people = peopleLine ? (cells(peopleLine)[1] || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean).map((label) => ({ label, role: true, org: '', duty: '', quote: q(peopleLine) })) : [];
  const flow = row(/→/);
  const artifacts = flow ? flow.split(/\s*→\s*/).map((x) => x.trim()).filter(Boolean).map((label) => ({ label, description: '', quote: q(flow) })) : [];
  // 제목 줄만으로는 글자가 8개 미만일 수 있어 다음 줄을 붙여 인용한다(공백·줄바꿈은 비교에서 무시되므로 원문 부분 문자열)
  const topics = lines.map((l, i) => [l, i]).filter(([l]) => /^###\s/.test(l)).slice(0, 3).map(([l, i]) => ({ label: l.replace(/^#+\s*[\d.]*\s*/, ''), description: '', subtype: '', quote: q(`${l} ${lines[i + 1] || ''}`.trim()) }));
  const ask = row(/^\d+\.\s.*\?$/);
  const memos = ask ? [{ text: ask.replace(/^\d+\.\s*/, ''), kind: 'issue', work: '', quote: q(ask) }] : [];
  const edges = people[0] && works[0] ? [{ from: { type: 'person', label: people[0].label }, to: { type: 'work', label: works[0].label }, relation: 'performs', quote: '' }] : [];
  return { name: heading.replace(/^#+\s*/, '').slice(0, 100), purpose: '', owner: '', date: '', works, people, artifacts, topics, memos, edges };
}

const isCandidates = (params) => !!(params.output_config && params.output_config.format && params.output_config.format.schema.properties.pairs);

// ── AI 연관 후보 응답 흉내(T-38): 보낸 업무 목록을 되읽어 고른다. 모양은 llm/ai-candidates.js의 AI_CANDIDATES_SCHEMA ──
const FAKE_BAD_PAIR_QUOTE = '업무 글 어디에도 없는 지어낸 구절입니다';
const quoteOfWork = (w) => w.text.slice(0, 30).trim();
const pairOf = (x, y, extra = {}) => ({
  a: { universe: x.universe, node: x.node }, b: { universe: y.universe, node: y.node },
  reason: '두 업무가 같은 일을 다른 이름으로 부르는 것으로 보임', quote_a: quoteOfWork(x), quote_b: quoteOfWork(y), confidence: 'high', ...extra,
});

/** 진짜 쌍 하나: 끝에서 두 번째 유니버스의 마지막 업무 ↔ 마지막 유니버스의 첫 업무(유니버스가 둘뿐이면 첫 유니버스의 마지막 ↔ 둘째의 첫) */
function candidatesAnswer(mode, user) {
  const works = parseCandidatesUser(user);
  const order = [...new Set(works.map((w) => w.universe))];
  if (order.length < 2) return { pairs: [] };
  const lastOf = (u) => works.filter((w) => w.universe === u).pop();
  const firstOf = (u) => works.find((w) => w.universe === u);
  const x = lastOf(order[order.length - 2]);
  const y = firstOf(order[order.length - 1]);
  const good = pairOf(x, y);
  if (mode === 'badquote' || mode === 'candidates-badquote') return { pairs: [pairOf(x, y, { quote_a: FAKE_BAD_PAIR_QUOTE })] };
  if (mode !== 'candidates') return { pairs: [good] };
  const same = works.filter((w) => w.universe === x.universe);
  return {
    pairs: [
      good,
      { ...good, a: { universe: 'U-ZZZ', node: 'N-999' }, reason: '지어낸 업무' }, // 입력에 없는 업무
      pairOf(x, y, { quote_b: FAKE_BAD_PAIR_QUOTE }), // 인용이 틀림
      ...(same.length > 1 ? [pairOf(same[0], same[same.length - 1])] : []), // 같은 유니버스 안의 쌍
      pairOf(y, x), // 진짜 쌍과 같은 쌍(순서만 뒤집음)
    ],
  };
}

const isExtract = (params) => {
  const p = params.output_config && params.output_config.format && params.output_config.format.schema.properties;
  return !!(p && p.nodes && p.edges);
};

// ── 글로 추가 응답 흉내(CR-19): 보낸 글을 규칙 읽기로 읽어 그 항목·연결을 돌려주는 "착실한 모델". 모양은 llm/ai-extract.js의 AI_EXTRACT_SCHEMA ──
const FAKE_BAD_EXTRACT_QUOTE = '글 어디에도 없는 지어낸 구절입니다';
function extractAnswer(mode, user) {
  const sent = parseExtractUser(user) || { text: '', existing: [] };
  const rule = extractFromText(sent.text, null);
  const bad = mode === 'badquote' || mode === 'extract-badquote';
  const q = (quote) => (bad ? FAKE_BAD_EXTRACT_QUOTE : quote);
  const nodes = rule.nodes.map((n) => ({ type: n.type, label: n.label, emp_no: n.emp_no || '', quote: q(n.quote) }));
  const label = (key) => (rule.nodes.find((n) => n.key === key) || {}).label || '';
  const edges = rule.edges.map((e) => ({ from_label: label(e.from), to_label: label(e.to), type: e.type, quote: q(e.quote) }));
  if (mode === 'extract') {
    // 걸러져야 하는 행들: 글에 없는 이름, 인용이 틀린 항목, 유형 조합이 틀린 연결, 끝 항목이 없는 연결
    nodes.push({ type: 'work', label: '지어낸 업무', emp_no: '', quote: FAKE_BAD_EXTRACT_QUOTE });
    if (nodes[0]) nodes.push({ ...nodes[0], label: nodes[0].label, quote: FAKE_BAD_EXTRACT_QUOTE, emp_no: '' });
    if (nodes[0] && nodes[1]) edges.push({ from_label: nodes[1].label, to_label: nodes[0].label, type: 'produces', quote: nodes[0].quote });
    if (nodes[0]) edges.push({ from_label: nodes[0].label, to_label: '없는 항목입니다', type: 'references', quote: nodes[0].quote });
  }
  return { nodes, edges };
}

/** mode: ok(근거와 맞는 응답) · badquote(지어낸 quote) · garbage(JSON이 아님) · auth · rate · timeout · connect · server
 *  AI 연관 후보(T-38) 요청에는: candidates(진짜 쌍 1 + 지어낸 업무 쌍 + 인용이 틀린 쌍 + 같은 유니버스 쌍 + 중복 쌍) · badquote(인용이 틀린 쌍만) · 그 밖(ok 포함)은 진짜 쌍 1. fake.candidatesOut에 객체를 넣으면 그것을 그대로 돌려준다
 *  글로 추가(CR-19) 요청에는: extract(보낸 글을 규칙으로 읽은 항목·연결 + 걸러져야 하는 행들) · badquote/extract-badquote(모든 행의 인용이 지어낸 것) · 그 밖(ok 포함)은 걸러질 행이 없는 응답. fake.extractOut에 객체를 넣으면 그것을 그대로 돌려준다
 *  문서 변환(T-37) 요청에는: convert(원문에서 따온 항목 + 원문에 없는 업무 하나) · convert-clean(원문에서 따온 항목만, ok도 같음) · convert-badquote(모든 항목이 지어낸 인용). fake.convertOut에 객체를 넣으면 그것을 그대로 돌려준다 */
function answer(mode, params, fake) {
  const user = params.messages[0].content;
  if (isExtract(params)) return fake.extractOut || extractAnswer(mode, user);
  if (isCandidates(params)) return fake.candidatesOut || candidatesAnswer(mode, user);
  if (isConvert(params)) return fake.convertOut || convertAnswer(mode, parseConvertUser(user) || '');
  const sections = parsePrompt(user);
  const isDraft = !!(params.output_config && params.output_config.format && params.output_config.format.schema.properties.items);
  const sentencesOf = (sec) => sec.rule.map((r) => ({
    text: r.text,
    evidence_ids: r.evidence_ids,
    quotes: mode === 'badquote' ? ['근거 글 어디에도 없는 구절입니다'] : [quoteOf(sec.evidence[r.evidence_ids[0]], r.evidence_ids[0])],
  }));
  return isDraft
    ? { items: sections.map((sec) => ({ key: sec.key, sentences: sentencesOf(sec) })) }
    : { sentences: sections.length ? sentencesOf(sections[0]) : [] };
}

/**
 * @param {{mode?:string, delayMs?:number}} [opts]
 * @returns {{mode:string, delayMs:number, calls:object[], messages:{parse:(params:object)=>Promise<object>}}} mode·delayMs는 나중에 바꿀 수 있다
 */
export function createFakeClient({ mode = 'ok', delayMs = 0 } = {}) {
  const fake = {
    mode,
    delayMs,
    calls: [],
    messages: {
      async parse(params) {
        fake.calls.push(params);
        if (fake.delayMs) await new Promise((r) => setTimeout(r, fake.delayMs));
        switch (fake.mode) {
          case 'auth': throw new Anthropic.AuthenticationError(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
          case 'rate': throw new Anthropic.RateLimitError(429, { error: { type: 'rate_limit_error', message: 'rate limited' } }, 'rate limited', new Headers());
          case 'timeout': throw new Anthropic.APIConnectionTimeoutError();
          case 'connect': throw new Anthropic.APIConnectionError({ message: 'Connection error.' });
          case 'server': throw new Anthropic.InternalServerError(500, { error: { type: 'api_error', message: 'oops' } }, 'oops', new Headers());
          case 'garbage': return { stop_reason: 'end_turn', content: [{ type: 'text', text: '이것은 JSON이 아닙니다' }], parsed_output: null };
          default: {
            const out = answer(fake.mode, params, fake);
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }], parsed_output: out };
          }
        }
      },
    },
  };
  return fake;
}
