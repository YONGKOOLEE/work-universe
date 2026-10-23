// 시험용 가짜 Anthropic 클라이언트(CR-15). 실제 호출 없이 messages.parse를 흉내 낸다.
// 쓰임: 단위 테스트, 그리고 점검 주소(?check)의 window.__wu.useFakeLlm(브라우저 점검이 「생성 중→교체→실패 대체」를 보도록).
// 프롬프트(prompts.js의 형식)를 되읽어 규칙 기반 문장을 그대로 돌려주는 "착실한 모델" 흉내를 기본으로 한다.
// 키·네트워크를 쓰지 않는다. 브라우저 기능을 쓰지 않는다.

import Anthropic from '@anthropic-ai/sdk';
import { parseConvertUser, parsePrompt } from './prompts.js';

/** 근거 글 한 줄에서 gid 뒤의 앞부분을 quote로 쓴다(근거 글에 글자 그대로 있는 구절) */
function quoteOf(line, gid) {
  if (!gid) return '';
  const body = String(line || '').slice(gid.length).trim();
  return body.slice(0, 14).trim();
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
  const topics = lines.filter((l) => /^###\s/.test(l)).slice(0, 3).map((l) => ({ label: l.replace(/^#+\s*[\d.]*\s*/, ''), description: '', subtype: '', quote: q(l) }));
  const ask = row(/^\d+\.\s.*\?$/);
  const memos = ask ? [{ text: ask.replace(/^\d+\.\s*/, ''), kind: 'issue', work: '', quote: q(ask) }] : [];
  const edges = people[0] && works[0] ? [{ from: { type: 'person', label: people[0].label }, to: { type: 'work', label: works[0].label }, relation: 'performs', quote: '' }] : [];
  return { name: heading.replace(/^#+\s*/, '').slice(0, 100), purpose: '', owner: '', date: '', works, people, artifacts, topics, memos, edges };
}

/** mode: ok(근거와 맞는 응답) · badquote(지어낸 quote) · garbage(JSON이 아님) · auth · rate · timeout · connect · server
 *  문서 변환(T-37) 요청에는: convert(원문에서 따온 항목 + 원문에 없는 업무 하나) · convert-clean(원문에서 따온 항목만, ok도 같음) · convert-badquote(모든 항목이 지어낸 인용). fake.convertOut에 객체를 넣으면 그것을 그대로 돌려준다 */
function answer(mode, params, fake) {
  const user = params.messages[0].content;
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
