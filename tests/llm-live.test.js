// T-36 실시간 Claude API 연결부(CR-15, R-28, D-33): 공급자·비동기 연결부·quote 검증·캐시·키 비포함.
// 실제 API는 부르지 않는다. 가짜 클라이언트(llm/fake-client.js)와 이 파일의 즉석 가짜만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { PREGEN } from '../app/data/pregen.js';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore, createLlmCache, cleanApiKey, loadSettings, saveSettings, API_KEY_MAX, LLM_MODEL_MAX, LLM_CACHE_MAX } from '../app/src/store/local.js';
import { buildEmbed, embedJson, insertEmbed } from '../app/src/view/embed.js';
import {
  DEFAULT_LLM_MODEL, LLM_EFFORT, LLM_MAX_RETRIES, LLM_MAX_TOKENS, LLM_TIMEOUT_MS, LlmError, PROVIDERS, classifyLlmError, createProvider, itemEvidence,
} from '../app/src/llm/providers.js';
import { QUOTE_FAIL, explainInsight, explainInsightAsync, isLive, llmCacheKey, refineDraft, refineDraftAsync, syncProvider } from '../app/src/llm/connector.js';
import { QUOTE_MAX, QUOTE_MIN, describeEvidence, evidenceBody, normalizeQuote, quoteInEvidence, quoteShapeProblem } from '../app/src/llm/evidence-text.js';
import { buildDraftPrompt, buildExplainPrompt, parsePrompt } from '../app/src/llm/prompts.js';
import { createFakeClient } from '../app/src/llm/fake-client.js';
import { EXPLAIN_SCENARIOS, HANDOVER_SCENARIOS, explainRequestOf, handoverDraftOf } from '../tools/pregen-scenarios.mjs';

// 가짜 키: 조각을 이어 붙여 비밀값 점검 패턴(sk-ant-…)에 걸리지 않게 한다
const FAKE_KEY = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), entries: () => [...m] };
};
const existsIn = (v) => (gid) => v.lookup(gid).found || v.events.some((e) => e.gid === gid);
const live = (client, extra = {}) => createProvider('claude_api', { pregen: PREGEN, apiKey: FAKE_KEY, client, cache: createLlmCache(null), ...extra });

const H1 = handoverDraftOf(HANDOVER_SCENARIOS[0]);
const usable = H1.draft.items.filter((i) => !i.insufficient);
const run = (provider, over = {}) => refineDraftAsync(H1.draft, { provider, exists: existsIn(H1.view), view: H1.view, ...over });
const X = EXPLAIN_SCENARIOS.map((s) => ({ s, ...explainRequestOf(s) })).filter((x) => x.req);
const runX = (x, provider) => explainInsightAsync(x.req, { provider, exists: existsIn(x.view), view: x.view });

test('시나리오 전제: 초안에 쓸 수 있는 항목이 여럿이고 설명 요청이 13개 있다', () => {
  assert.ok(usable.length >= 5, String(usable.length));
  assert.equal(X.length, EXPLAIN_SCENARIOS.length);
});

// ── 공급자 ──
test('공급자: 키가 없거나 공백이면 실시간이 아니라 사전 생성 공급자처럼 동작(CR-17 H), 키가 있어야만 live', async () => {
  const fake = createFakeClient();
  for (const apiKey of [undefined, '', '   ']) {
    const p = createProvider('claude_api', { pregen: PREGEN, apiKey, client: fake });
    assert.equal(p.live, undefined);
    assert.equal(isLive(p), false);
    assert.equal(p.method, 'pregen'); // CR-17 H: 키가 없으면 사전 생성 문장을 쓴다
    assert.equal(p.name, 'claude_api');
    assert.ok(Array.isArray(p.refine('handover', H1.draft).items), '사전 생성 조회는 던지지 않는다');
    assert.throws(() => p.convert('x'), /^Error: 키가 없어 규칙 변환 결과를 보여 줍니다/);
    assert.equal(p.keyless, true); // 3회차: 화면이 키 없음 안내를 한 번만 보이게 하는 표지
  }
  const p = live(fake);
  assert.equal(p.live, true);
  assert.equal(isLive(p), true);
  assert.equal(p.model, DEFAULT_LLM_MODEL);
  assert.equal(syncProvider(p), p.base); // 먼저 그릴 때는 사전 생성
  assert.equal(syncProvider(null), null);
  assert.equal(PROVIDERS.find((x) => x.name === 'claude_api').label, 'Claude API(키를 넣으면 실시간)');
  assert.equal(fake.calls.length, 0);
});

test('공급자: 요청 모양(모델·max_tokens 16000·effort medium·JSON 스키마 형식), 키는 요청에 없다', async () => {
  const fake = createFakeClient();
  const p = live(fake);
  const out = await p.refine('handover', buildDraftPrompt({ draft: H1.draft, items: usable.slice(0, 1), textOf: (g) => describeEvidence(H1.view, g) }));
  assert.ok(Array.isArray(out.items));
  const [params] = fake.calls;
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.max_tokens, 16000);
  assert.equal(LLM_MAX_TOKENS, 16000);
  assert.equal(LLM_EFFORT, 'medium');
  assert.equal(params.output_config.effort, 'medium');
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.output_config.format.schema.additionalProperties, false);
  assert.equal(typeof params.output_config.format.parse, 'function');
  assert.equal(params.thinking, undefined); // 생략 = 기본 켜짐
  assert.equal(LLM_TIMEOUT_MS, 30000);
  assert.equal(LLM_MAX_RETRIES, 1);
  assert.ok(!JSON.stringify(params).includes(FAKE_KEY));
  assert.equal(live(createFakeClient(), { model: '  my-model  ' }).model, 'my-model');
});

test('오류 분류: SDK 오류 클래스로 구분한다(문자열 비교 없음)', () => {
  const h = new Headers();
  const code = (e) => classifyLlmError(e).code;
  assert.equal(code(new Anthropic.AuthenticationError(401, {}, 'x', h)), 'auth');
  assert.equal(classifyLlmError(new Anthropic.AuthenticationError(401, {}, 'x', h)).message, '키가 맞지 않음');
  assert.equal(code(new Anthropic.PermissionDeniedError(403, {}, 'x', h)), 'forbidden');
  assert.equal(code(new Anthropic.RateLimitError(429, {}, 'x', h)), 'rate');
  assert.equal(code(new Anthropic.APIConnectionTimeoutError()), 'timeout');
  assert.equal(classifyLlmError(new Anthropic.APIConnectionTimeoutError()).message, '연결 실패·시간 초과');
  assert.equal(code(new Anthropic.APIConnectionError({ message: 'x' })), 'connect');
  assert.equal(code(new Anthropic.NotFoundError(404, {}, 'x', h)), 'notfound');
  assert.equal(code(new Anthropic.InternalServerError(500, {}, 'x', h)), 'api');
  assert.equal(code(new Anthropic.AnthropicError('x')), 'format');
  assert.equal(code(new TypeError('x')), 'unknown');
  // 메시지에 "401" 같은 낱말이 있어도 클래스가 아니면 분류하지 않는다
  assert.equal(code(new Error('401 Unauthorized')), 'unknown');
  const own = new LlmError('x', 'y');
  assert.equal(classifyLlmError(own), own);
});

test('공급자: 응답 오류는 원문 메시지가 아니라 정해 둔 문구로(키가 새지 않게)', async () => {
  const fake = createFakeClient({ mode: 'auth' });
  await assert.rejects(() => live(fake).refine('handover', { system: 's', user: 'u', schema: { type: 'object', properties: {} } }), (e) => e instanceof LlmError && e.message === '키가 맞지 않음' && !e.message.includes('x-api-key'));
});

// ── 프롬프트 ──
test('프롬프트: 규칙이 고른 근거 글과 규칙 기반 문장만 보내고, 되읽으면 같다', () => {
  const textOf = (g) => describeEvidence(H1.view, g);
  const p = buildDraftPrompt({ draft: H1.draft, items: usable, textOf });
  assert.ok(p.system.includes('근거 글에 있는 사실만'));
  assert.ok(p.system.includes('quotes'));
  const secs = parsePrompt(p.user);
  assert.deepEqual(secs.map((s) => s.key), usable.map((i) => i.key));
  for (const [n, item] of usable.entries()) {
    assert.deepEqual(secs[n].allowed, itemEvidence(item));
    assert.deepEqual(secs[n].rule.map((r) => r.text), item.sentences.map((s) => s.text.replace(/\s*[\r\n]+\s*/g, ' ')));
    for (const g of itemEvidence(item)) assert.ok(secs[n].evidence[g].includes(textOf(g).replace(/\s*[\r\n]+\s*/g, ' ')), g);
  }
  // 근거로 고르지 않은 노드(예: 다른 업무)의 글은 들어가지 않는다
  const all = new Set(usable.flatMap(itemEvidence));
  const outside = H1.view.nodes.find((n) => !all.has(n.gid) && n.label.length >= 4);
  assert.ok(outside && !p.user.includes(`${outside.gid} [`), '근거 밖 노드가 프롬프트에 있음');
  const x = X[0];
  const e = parsePrompt(buildExplainPrompt({ req: x.req, textOf: (g) => describeEvidence(x.view, g) }).user);
  assert.equal(e.length, 1);
  assert.deepEqual(e[0].allowed, x.req.evidence_ids);
});

// ── quote 규칙 ──
test('quote 규칙: 공백·대소문자를 무시한 부분 문자열(본문만), 8글자 미만·없는 구절은 불통과', () => {
  const ev = ['U-1/N-1 [업무] Month End Close — 월말 정산 대사 확인 {담당=윤바다}'];
  assert.equal(quoteInEvidence('월말 정산 대사 확인', ev), true);
  assert.equal(quoteInEvidence('월말정산대사확인', ev), true); // 공백 무시
  assert.equal(quoteInEvidence('  월 말   정 산 대 사 확 인 ', ev), true);
  assert.equal(quoteInEvidence('MONTH end close', ev), true); // 대소문자 무시
  assert.equal(quoteInEvidence('월말 결산 대사 확인', ev), false); // 글에 없음
  assert.equal(quoteInEvidence('정', ev), false); // 너무 짧음
  assert.equal(quoteInEvidence('월말 정산', ev), false); // 7글자 이하(R10-1: 최소 3 → 8)
  assert.equal(quoteInEvidence('월말정산대사확', ev), false); // 7글자
  assert.equal(quoteInEvidence('월말정산대사확인', ev), true); // 8글자
  assert.equal(QUOTE_MIN, 8);
  assert.equal(QUOTE_MAX, 300);
  assert.equal(quoteInEvidence('', ev), false);
  assert.equal(quoteInEvidence(undefined, ev), false);
  assert.equal(quoteInEvidence(5, ev), false);
  assert.equal(quoteInEvidence('월말 정산', []), false);
  assert.equal(normalizeQuote(' A b\nC '), 'abc');
});

// ── 초안(비동기) ──
test('초안: 가짜 응답이 근거·quote를 통과하면 항목이 Claude API 문장으로 교체되고, quotes는 결과에 남지 않는다', async () => {
  const fake = createFakeClient();
  const r = await run(live(fake));
  assert.equal(r.method, 'llm');
  assert.equal(r.fallback, null);
  assert.equal(r.counts.provider, usable.length);
  assert.equal(r.counts.rule, 0);
  assert.equal(fake.calls.length, 1); // 항목 전체를 한 번에
  for (const i of r.items) {
    if (i.insufficient) assert.equal(i.method, 'rule'); // 이력 부족은 건드리지 않음(문장 없음)
    else {
      assert.equal(i.method, 'llm');
      for (const s of i.sentences) assert.deepEqual(Object.keys(s).sort(), ['evidence_ids', 'text']);
    }
  }
  assert.deepEqual(r.live, { called: true, cached: 0 });
  // 이력 부족 항목은 문장을 지어내지 않는다
  for (const i of r.items.filter((x) => x.insufficient)) assert.deepEqual(i.sentences, []);
  assert.ok(!JSON.stringify(r).includes(FAKE_KEY));
});

test('초안: 지어낸 quote는 그 항목을 규칙 기반으로 두고 replaced + W-LLM-QUOTE, 캐시에 넣지 않는다', async () => {
  const cache = createLlmCache(null);
  const fake = createFakeClient({ mode: 'badquote' });
  const r = await run(live(fake, { cache }));
  assert.equal(r.method, 'rule');
  assert.equal(r.fallback.code, QUOTE_FAIL);
  assert.equal(QUOTE_FAIL, 'W-LLM-QUOTE');
  assert.match(r.fallback.reason, /원문 인용/);
  assert.match(r.fallback.reason, new RegExp(`${usable.length}개`));
  for (const i of r.items.filter((x) => !x.insufficient)) {
    assert.equal(i.method, 'rule');
    assert.equal(i.replaced, true);
    assert.deepEqual(i.sentences, H1.draft.items.find((x) => x.key === i.key).sentences); // 규칙 기반 문장 그대로
  }
  assert.equal(cache.size, 0);
});

test('초안: 일부 항목만 quote가 틀리면 그 항목만 규칙 기반이고 나머지는 교체된다', async () => {
  const fake = createFakeClient();
  const orig = fake.messages.parse;
  fake.messages.parse = async (p) => {
    const m = await orig(p);
    m.parsed_output.items[0].sentences[0].quotes = ['어디에도 없는 인용입니다'];
    return m;
  };
  const r = await run(live(fake));
  const first = usable[0].key;
  assert.equal(r.items.find((i) => i.key === first).method, 'rule');
  assert.equal(r.items.find((i) => i.key === first).replaced, true);
  assert.equal(r.counts.provider, usable.length - 1);
  assert.equal(r.method, 'llm');
  assert.equal(r.fallback.code, QUOTE_FAIL);
});

test('초안: quote가 없거나 빈 배열이면 불통과(quote 검증을 끄면 이 테스트가 깨진다)', async () => {
  for (const quotes of [undefined, [], [''], ['정']]) {
    const fake = createFakeClient();
    const orig = fake.messages.parse;
    fake.messages.parse = async (p) => {
      const m = await orig(p);
      for (const it of m.parsed_output.items) for (const s of it.sentences) { if (quotes === undefined) delete s.quotes; else s.quotes = quotes; }
      return m;
    };
    const r = await run(live(fake));
    assert.equal(r.method, 'rule', JSON.stringify(quotes));
    assert.equal(r.fallback.code, QUOTE_FAIL);
  }
});

test('초안: 허용 근거 밖의 ID·없는 ID·빈 근거는 W-LLM-FALLBACK(항목은 규칙 기반 + replaced)', async () => {
  const bad = [[], ['U-ZZ/N-999'], [usable[0].sentences[0].evidence_ids[0] + 'x']];
  for (const ids of bad) {
    const fake = createFakeClient();
    const orig = fake.messages.parse;
    fake.messages.parse = async (p) => {
      const m = await orig(p);
      m.parsed_output.items[0].sentences[0].evidence_ids = ids;
      return m;
    };
    const r = await run(live(fake));
    const first = r.items.find((i) => i.key === usable[0].key);
    assert.equal(first.method, 'rule');
    assert.equal(first.replaced, true);
    assert.equal(r.counts.provider, usable.length - 1);
    assert.equal(r.fallback.code, 'W-LLM-FALLBACK');
  }
});

test('초안: 응답에서 빠진 항목은 규칙 기반 + replaced', async () => {
  const fake = createFakeClient();
  const orig = fake.messages.parse;
  fake.messages.parse = async (p) => {
    const m = await orig(p);
    m.parsed_output.items.pop();
    return m;
  };
  const r = await run(live(fake));
  const last = usable[usable.length - 1].key;
  assert.equal(r.items.find((i) => i.key === last).replaced, true);
  assert.equal(r.counts.provider, usable.length - 1);
});

test('초안: 호출 실패(키 오류·한도·시간 초과·연결·서버·엉터리 응답)는 전체 규칙 기반 + 원인(W-LLM-FALLBACK)', async () => {
  const table = [['auth', /키가 맞지 않음/], ['rate', /한도/], ['timeout', /연결 실패·시간 초과/], ['connect', /연결 실패·시간 초과/], ['server', /API 오류\(상태 500\)/], ['garbage', /응답 형식 오류/]];
  for (const [mode, re] of table) {
    const fake = createFakeClient({ mode });
    const cache = createLlmCache(null);
    const r = await run(live(fake, { cache }));
    assert.equal(r.method, 'rule', mode);
    assert.equal(r.fallback.code, 'W-LLM-FALLBACK', mode);
    assert.match(r.fallback.reason, re, mode);
    assert.equal(r.counts.provider, 0);
    assert.ok(r.items.every((i) => i.method === 'rule'));
    assert.deepEqual(r.items.map((i) => i.sentences), H1.draft.items.map((i) => i.sentences)); // 규칙 기반 문장 그대로
    assert.equal(cache.size, 0);
    assert.ok(!r.fallback.reason.includes('x-api-key'));
  }
});

test('초안: 응답 구조가 틀리면(items 없음) 전체 규칙 기반', async () => {
  const fake = createFakeClient();
  fake.messages.parse = async () => ({ stop_reason: 'end_turn', content: [], parsed_output: { nothing: true } });
  const r = await run(live(fake));
  assert.equal(r.method, 'rule');
  assert.equal(r.fallback.code, 'W-LLM-FALLBACK');
  // 모델이 거절한 경우
  fake.messages.parse = async () => ({ stop_reason: 'refusal', content: [], parsed_output: null });
  assert.match((await run(live(fake))).fallback.reason, /거절/);
});

test('초안: parsed_output이 없어도 본문 글이 올바른 JSON이면 쓴다', async () => {
  const fake = createFakeClient();
  const orig = fake.messages.parse;
  fake.messages.parse = async (p) => {
    const m = await orig(p);
    return { stop_reason: 'end_turn', content: m.content, parsed_output: null };
  };
  assert.equal((await run(live(fake))).method, 'llm');
});

// ── 캐시 ──
test('캐시: 같은 (작업, 대상, 항목, 지문)이면 호출 없이 쓰고, 규칙 기반 문장이 바뀌면 다시 호출한다', async () => {
  const fake = createFakeClient();
  const cache = createLlmCache(null);
  const p = live(fake, { cache });
  const first = await run(p);
  assert.equal(fake.calls.length, 1);
  assert.equal(cache.size, usable.length);
  const second = await run(p);
  assert.equal(fake.calls.length, 1, '캐시 적중이면 호출 없음');
  assert.deepEqual(second.live, { called: false, cached: usable.length });
  assert.deepEqual(second.items.map((i) => i.sentences), first.items.map((i) => i.sentences));
  assert.equal(second.method, 'llm');

  // 한 항목의 규칙 기반 문장이 바뀌면(근거 내용 변경) 그 항목만 다시 호출한다
  const changed = { ...H1.draft, items: H1.draft.items.map((i) => (i.key === usable[0].key ? { ...i, sentences: i.sentences.map((s) => ({ ...s, text: `${s.text} (바뀜)` })) } : i)) };
  const third = await refineDraftAsync(changed, { provider: p, exists: existsIn(H1.view), view: H1.view });
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(third.live, { called: true, cached: usable.length - 1 });
  const sent = parsePrompt(fake.calls[1].messages[0].content);
  assert.deepEqual(sent.map((s) => s.key), [usable[0].key]); // 바뀐 항목만 보냄
  assert.ok(third.items.find((i) => i.key === usable[0].key).method === 'llm');
});

test('캐시 키: 작업·대상·항목·지문·모델이 모두 들어간다', () => {
  const a = [{ text: '가', evidence_ids: ['G'] }];
  const b = [{ text: '나', evidence_ids: ['G'] }];
  const base = llmCacheKey('t', 'target', 'item', a, 'm');
  assert.notEqual(base, llmCacheKey('t', 'target', 'item', b, 'm'), '지문');
  assert.notEqual(base, llmCacheKey('u', 'target', 'item', a, 'm'), '작업');
  assert.notEqual(base, llmCacheKey('t', 'other', 'item', a, 'm'), '대상');
  assert.notEqual(base, llmCacheKey('t', 'target', 'other', a, 'm'), '항목');
  assert.notEqual(base, llmCacheKey('t', 'target', 'item', a, 'm2'), '모델');
});

test('캐시: 저장된 문장이라도 지금 근거로 다시 검증한다(근거 글이 바뀌어 quote가 사라지면 다시 호출)', async () => {
  // 캐시 내용을 지어낸 quote로 오염
  const keyed = new Map();
  const mem = { get: (k) => keyed.get(k) || null, set: (k, v) => keyed.set(k, v) };
  await run(live(createFakeClient(), { cache: mem }));
  for (const [k, v] of keyed) keyed.set(k, { sentences: v.sentences.map((s) => ({ ...s, quotes: ['지어낸 인용 구절'] })) });
  const f2 = createFakeClient();
  const r = await run(live(f2, { cache: mem }));
  assert.equal(f2.calls.length, 1, '오염된 캐시는 쓰지 않고 다시 호출');
  assert.equal(r.method, 'llm');
});

test('캐시 저장소: 200건 상한(오래된 것부터 버림), 키 지우기, 깨진 값·저장 실패에도 동작', () => {
  const st = memoryStorage();
  const c = createLlmCache(st);
  assert.equal(LLM_CACHE_MAX, 200);
  for (let i = 0; i < 205; i += 1) c.set(`k${i}`, { sentences: [{ text: String(i), evidence_ids: ['g'], quotes: ['qqq'] }] });
  assert.equal(c.size, 200);
  assert.equal(c.get('k0'), null);
  assert.equal(c.get('k4'), null);
  assert.ok(c.get('k5'));
  assert.ok(c.get('k204'));
  // 다시 쓰면 가장 새것
  c.set('k5', { sentences: [] });
  c.set('k205', { sentences: [] });
  assert.ok(c.get('k5'));
  assert.equal(c.get('k6'), null);
  // 새 인스턴스가 같은 저장값을 읽는다
  assert.equal(createLlmCache(st).size, 200);
  assert.ok(createLlmCache(st).get('k205'));
  // 키 지우기
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(st.getItem('wu:v1:llm-cache'), null);
  assert.equal(createLlmCache(st).size, 0);
  // 깨진 저장값·이상한 항목
  for (const raw of ['{깨짐', 'null', '{"entries":5}', '{"entries":[null,[1,2],["a"],["b",{"x":1}]]}']) {
    const s2 = memoryStorage();
    s2.setItem('wu:v1:llm-cache', raw);
    const c2 = createLlmCache(s2);
    assert.ok(c2.size <= 1, raw);
    c2.set('z', { sentences: [] });
    assert.ok(c2.get('z'));
  }
  // 저장소가 없거나 쓰기가 실패해도 메모리에서 동작
  const broken = { getItem: () => null, setItem: () => { throw new Error('가득 참'); }, removeItem: () => { throw new Error('막힘'); } };
  const c3 = createLlmCache(broken);
  c3.set('a', { sentences: [] });
  assert.ok(c3.get('a'));
  c3.clear();
  assert.equal(c3.get('a'), null);
  const c4 = createLlmCache(null);
  c4.set('a', { sentences: [] });
  assert.ok(c4.get('a'));
  assert.equal(createLlmCache(null, { max: 2 }).size, 0);
  const small = createLlmCache(null, { max: 2 });
  small.set('a', { x: 1 }); small.set('b', { x: 1 }); small.set('c', { x: 1 });
  assert.equal(small.size, 2);
  assert.equal(small.get('a'), null);
});

test('캐시가 고장 나도(읽기·쓰기 예외) 결과는 정상', async () => {
  const bad = { get: () => { throw new Error('x'); }, set: () => { throw new Error('y'); } };
  const r = await run(live(createFakeClient(), { cache: bad }));
  assert.equal(r.method, 'llm');
});

// ── 인사이트 설명(비동기) ──
test('설명: 13개 시나리오(7종)가 모두 교체되고, 지어낸 quote는 규칙 기반 + W-LLM-QUOTE', async () => {
  const kinds = new Set(X.map((x) => x.s.kind));
  assert.ok(kinds.size >= 7, [...kinds].join());
  for (const x of X) {
    const ok = await runX(x, live(createFakeClient()));
    assert.equal(ok.method, 'llm', x.s.id);
    assert.equal(ok.fallback, null);
    assert.deepEqual(ok.sentences.map((s) => s.text), x.req.rule.map((s) => s.text));
    for (const s of ok.sentences) assert.deepEqual(Object.keys(s).sort(), ['evidence_ids', 'text']);
    const bad = await runX(x, live(createFakeClient({ mode: 'badquote' })));
    assert.equal(bad.method, 'rule', x.s.id);
    assert.equal(bad.fallback.code, QUOTE_FAIL);
    assert.deepEqual(bad.sentences, x.req.rule);
  }
});

test('설명: 실패(키 오류·시간 초과·엉터리)는 규칙 기반 + 원인, 캐시 적중이면 호출 없음', async () => {
  const x = X[0];
  for (const [mode, re] of [['auth', /키가 맞지 않음/], ['timeout', /시간 초과/], ['garbage', /형식/]]) {
    const r = await runX(x, live(createFakeClient({ mode })));
    assert.equal(r.method, 'rule');
    assert.equal(r.fallback.code, 'W-LLM-FALLBACK');
    assert.match(r.fallback.reason, re);
    assert.deepEqual(r.sentences, x.req.rule);
  }
  const fake = createFakeClient();
  const p = live(fake);
  assert.equal((await runX(x, p)).live.called, true);
  const again = await runX(x, p);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(again.live, { called: false, cached: true });
  assert.equal(again.method, 'llm');
  // 근거가 없는 요청은 호출하지 않는다
  const none = await explainInsightAsync({ target: 't', evidence_ids: [], rule: [{ text: '가', evidence_ids: [] }] }, { provider: p, exists: () => true, view: x.view });
  assert.equal(none.method, 'rule');
  assert.equal(fake.calls.length, 1);
  // 응답 구조가 틀리면
  fake.messages.parse = async () => ({ stop_reason: 'end_turn', content: [], parsed_output: { items: [] } });
  assert.equal((await runX(X[1], live(fake))).fallback.code, 'W-LLM-FALLBACK');
});

test('설명: 근거 ID가 허용 밖이면 W-LLM-FALLBACK(quote가 맞아도)', async () => {
  const x = X[0];
  const fake = createFakeClient();
  const orig = fake.messages.parse;
  fake.messages.parse = async (p) => {
    const m = await orig(p);
    m.parsed_output.sentences[0].evidence_ids = ['U-ZZ/N-1'];
    return m;
  };
  const r = await runX(x, live(fake));
  assert.equal(r.method, 'rule');
  assert.equal(r.fallback.code, 'W-LLM-FALLBACK');
});

// ── 키가 없으면 아무것도 부르지 않는다 ──
test('키 없음: 비동기 함수는 null을 돌려주고 가짜 클라이언트 호출 수는 0', async () => {
  const fake = createFakeClient();
  const providers = [
    null,
    createProvider('none'),
    createProvider('pregen', { pregen: PREGEN, client: fake }),
    createProvider('fail'),
    createProvider('claude_api', { pregen: PREGEN, client: fake }), // 키 없음
    createProvider('claude_api', { pregen: PREGEN, client: fake, apiKey: '' }),
    createProvider('internal'),
  ];
  for (const p of providers) {
    assert.equal(await run(p), null);
    assert.equal(await runX(X[0], p), null);
  }
  assert.equal(fake.calls.length, 0);
});

test('키 없음(CR-17 H): 동기 경로는 사전 생성 결과를 쓰고 안내 문구가 사실대로 — 쓸 문장이 없으면 규칙 기반', async () => {
  const pregen = createProvider('pregen', { pregen: PREGEN });
  const a = refineDraft(H1.draft, { provider: pregen, exists: existsIn(H1.view) });
  const b = refineDraft(H1.draft, { provider: syncProvider(pregen), exists: existsIn(H1.view) });
  assert.deepEqual(a, b);
  assert.equal(a.method, 'pregen');
  const noKey = createProvider('claude_api', { pregen: PREGEN });
  const r = refineDraft(H1.draft, { provider: syncProvider(noKey), exists: existsIn(H1.view) });
  assert.equal(r.method, 'pregen');
  assert.deepEqual(r.items.map((i) => [i.key, i.method, i.sentences]), a.items.map((i) => [i.key, i.method, i.sentences]), '문장은 사전 생성 공급자와 같다');
  assert.equal(r.fallback.reason, '키가 없어 미리 받아 둔 문장(사전 생성)으로 보여 줍니다 — 「설정」에서 키를 넣으면 Claude가 실시간으로 다시 씁니다');
  assert.equal(r.fallback.keyless, true);
  assert.equal(r.fallback.code, 'W-LLM-FALLBACK'); // 원인 코드는 그대로
  assert.ok(!r.fallback.reason.includes('공급자 오류'));
  const e = explainInsight(X[0].req, { provider: syncProvider(noKey), exists: existsIn(X[0].view) });
  const ep = explainInsight(X[0].req, { provider: pregen, exists: existsIn(X[0].view) });
  assert.deepEqual(e, ep, '설명도 사전 생성 공급자와 같다');
  // 사전 생성 파일이 없으면(쓸 문장이 하나도 없으면) 규칙 기반이라고 말한다
  const bare = createProvider('claude_api', { apiKey: '' });
  const rb = refineDraft(H1.draft, { provider: syncProvider(bare), exists: existsIn(H1.view) });
  assert.equal(rb.method, 'rule');
  assert.equal(rb.fallback.reason, '키가 없어 기록을 그대로 모은 문장(규칙 기반)으로 보여 줍니다 — 「설정」에서 키를 넣으면 Claude가 실시간으로 다시 씁니다');
  assert.equal(rb.fallback.keyless, true);
  // 기록이 바뀌어 지문이 달라진 항목은 사전 생성 문장을 쓰지 않는다(키 없음에서도 같은 검사)
  const tampered = { ...H1.draft, items: H1.draft.items.map((i) => (i.insufficient || !Array.isArray(i.sentences) ? i : { ...i, sentences: i.sentences.map((s) => ({ ...s, text: `${s.text} 바뀜` })) })) };
  const rt = refineDraft(tampered, { provider: syncProvider(noKey), exists: existsIn(H1.view) });
  assert.equal(rt.method, 'rule');
  assert.equal(rt.fallback.reason, '키가 없어 기록을 그대로 모은 문장(규칙 기반)으로 보여 줍니다 — 「설정」에서 키를 넣으면 Claude가 실시간으로 다시 씁니다');
  // 키가 있어도 동기 함수에는 base(사전 생성)를 넘겨 먼저 그린다
  const withKey = live(createFakeClient());
  assert.equal(refineDraft(H1.draft, { provider: syncProvider(withKey), exists: existsIn(H1.view) }).method, 'pregen');
  // 문서 변환은 T-37에서 연결했다(tests/ai-convert.test.js). 빈 글은 호출 없이 거부한다
  await assert.rejects(() => withKey.convert(''), /변환할 문서가 비어 있습니다/);
});

// ── 설정 필드 ──
test('설정: apiKey·llmModel은 문자열·길이 상한 안일 때만 받고, 넘으면 버린다(잘라 쓰지 않음)', () => {
  const DEF = { provider: 'pregen' };
  const st = memoryStorage();
  assert.equal(saveSettings(st, { provider: 'claude_api', apiKey: `  ${FAKE_KEY}  `, llmModel: ' claude-x ' }), true);
  assert.deepEqual(loadSettings(st, DEF), { provider: 'claude_api', apiKey: FAKE_KEY, llmModel: 'claude-x' });
  // 상한
  assert.equal(API_KEY_MAX, 200);
  assert.equal(LLM_MODEL_MAX, 100);
  const ok = 'k'.repeat(API_KEY_MAX);
  const long = 'k'.repeat(API_KEY_MAX + 1);
  const mem = (o) => { const s = memoryStorage(); s.setItem('wu:v1:settings', JSON.stringify(o)); return s; };
  assert.equal(loadSettings(mem({ provider: 'pregen', apiKey: ok }), DEF).apiKey, ok);
  assert.equal('apiKey' in loadSettings(mem({ provider: 'pregen', apiKey: long }), DEF), false);
  assert.equal(loadSettings(mem({ provider: 'pregen', llmModel: 'm'.repeat(LLM_MODEL_MAX) }), DEF).llmModel.length, LLM_MODEL_MAX);
  assert.equal('llmModel' in loadSettings(mem({ provider: 'pregen', llmModel: 'm'.repeat(LLM_MODEL_MAX + 1) }), DEF), false);
  for (const bad of [5, null, {}, [], true, '', '   ']) {
    const s = loadSettings(mem({ provider: 'pregen', apiKey: bad, llmModel: bad }), DEF);
    assert.deepEqual(s, DEF, String(bad));
  }
  // 저장할 때도 같은 규칙
  const st2 = memoryStorage();
  saveSettings(st2, { provider: 'pregen', apiKey: long, llmModel: 'm'.repeat(101) });
  assert.deepEqual(JSON.parse(st2.getItem('wu:v1:settings')), { provider: 'pregen' });
  assert.equal(cleanApiKey(long), '');
  assert.equal(cleanApiKey(`${ok} `), ok);
  // 키를 지우면(필드 없음) 다시 읽어도 없다
  saveSettings(st, { provider: 'claude_api' });
  assert.equal('apiKey' in loadSettings(st, DEF), false);
});

// ── 키 비포함(A-2) ──
test('키 비포함: 키를 넣은 브라우저에서 내보낸 JSON·내용 포함 HTML·폴더 파일·이력에 키와 응답 캐시가 없다', async () => {
  const st = memoryStorage();
  saveSettings(st, { provider: 'claude_api', apiKey: FAKE_KEY, llmModel: 'claude-x' });
  const cache = createLlmCache(st);
  const now = () => '2026-10-23T10:00:00+09:00';
  const app = createApp({ store: createStore(st), samples: SAMPLES, currentId: 'U-A1', now });
  // 실시간 경로를 실제로 돌려 캐시를 채운다
  const settings = loadSettings(st, { provider: 'pregen' });
  assert.equal(settings.apiKey, FAKE_KEY);
  const fake = createFakeClient();
  const provider = createProvider('claude_api', { pregen: PREGEN, apiKey: settings.apiKey, model: settings.llmModel, client: fake, cache });
  const v = app.view;
  const target = v.nodes.find((n) => n.core_type === 'root').gid;
  const people = v.nodes.filter((n) => n.core_type === 'person');
  assert.ok(people.length >= 2);
  const { buildHandoverDraft } = await import('../app/src/rules/handover.js');
  const built = buildHandoverDraft(v, { target, from: people[0].gid, to: people[1].gid, asOf: '2026-10-02' });
  assert.ok(built.ok);
  const r = await refineDraftAsync(built.draft, { provider, exists: v.exists, view: v });
  assert.equal(r.method, 'llm');
  assert.ok(cache.size > 0);
  const cachedText = st.getItem('wu:v1:llm-cache');
  assert.ok(cachedText && cachedText.length > 10);

  // 내보내기 JSON(= 폴더 거울 파일의 내용: ui/folder-link.js는 app.exportJson()을 그대로 쓴다)
  const json = app.exportJson();
  assert.ok(!json.includes(FAKE_KEY), '내보낸 JSON에 키');
  assert.ok(!json.includes('claude-x'), '내보낸 JSON에 모델');
  assert.ok(!json.includes('llm-cache'));
  // 내용 포함 HTML
  const html = insertEmbed('<html><head></head><body></body></html>', buildEmbed(app.doc, (id) => SAMPLES.find((d) => d.universe.id === id) || null));
  assert.ok(html && !html.includes(FAKE_KEY), '내용 포함 HTML에 키');
  assert.ok(!embedJson(buildEmbed(app.doc, () => null)).includes(FAKE_KEY));
  // 이력(되감기 재료)
  assert.ok(!JSON.stringify(app.doc.events).includes(FAKE_KEY));
  // 저장된 유니버스 문서 전체
  for (const [k, val] of st.entries()) {
    if (k === 'wu:v1:settings') assert.ok(val.includes(FAKE_KEY)); // 키는 설정 한 곳에만
    else assert.ok(!val.includes(FAKE_KEY), `${k}에 키`);
  }
  // 응답 캐시는 키를 담지 않고, 내보낸 JSON에 응답 문장 본문이 따로 실리지 않는다
  assert.ok(!cachedText.includes(FAKE_KEY));
  // 초안 결과·오류 이유에도 키가 없다
  const failed = await refineDraftAsync(built.draft, { provider: createProvider('claude_api', { pregen: PREGEN, apiKey: FAKE_KEY, client: createFakeClient({ mode: 'auth' }) }), exists: v.exists, view: v });
  assert.ok(!JSON.stringify(failed).includes(FAKE_KEY));
  // 키를 지우면(설정 + 캐시) 저장소에 키와 캐시가 없다
  saveSettings(st, { provider: 'claude_api' });
  cache.clear();
  for (const [k, val] of st.entries()) assert.ok(!val.includes(FAKE_KEY), `${k}에 키(지운 뒤)`);
  assert.equal(st.getItem('wu:v1:llm-cache'), null);
});

// ── 소스 규칙 ──
test('소스 규칙: app/src에는 fetch( 호출이 없다(네트워크는 SDK로만), 키 문자열 상수도 없다', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.js') ? [`${d}/${e.name}`] : []));
  const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  for (const f of walk(new URL('../app/src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    const code = noComments(fs.readFileSync(f, 'utf8'));
    assert.ok(!/\bfetch\s*\(/.test(code), `${f}에 fetch(`);
    assert.ok(!/sk-ant-[A-Za-z0-9_-]{10,}/.test(code), `${f}에 키 모양`);
  }
});

test('가짜 클라이언트: 모드별로 SDK 오류 클래스를 던진다', async () => {
  for (const [mode, cls] of [['auth', Anthropic.AuthenticationError], ['rate', Anthropic.RateLimitError], ['timeout', Anthropic.APIConnectionTimeoutError], ['connect', Anthropic.APIConnectionError], ['server', Anthropic.InternalServerError]]) {
    await assert.rejects(() => createFakeClient({ mode }).messages.parse({ messages: [{ content: '' }] }), (e) => e instanceof cls, mode);
  }
  const slow = createFakeClient({ delayMs: 20 });
  const t0 = Date.now();
  await slow.messages.parse({ messages: [{ content: '' }], output_config: { format: { schema: { properties: { items: {} } } } } });
  assert.ok(Date.now() - t0 >= 15);
});

// ── 실제 SDK 클라이언트 + 가짜 fetch(네트워크 없음): 요청 모양과 오류 분류를 SDK 안쪽까지 확인 ──
const sdkClient = (fetchImpl) => new Anthropic({ apiKey: FAKE_KEY, dangerouslyAllowBrowser: true, timeout: LLM_TIMEOUT_MS, maxRetries: LLM_MAX_RETRIES, fetch: fetchImpl });
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const message = (text) => ({ id: 'msg_test', type: 'message', role: 'assistant', model: DEFAULT_LLM_MODEL, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

test('실제 SDK(가짜 fetch): 요청은 api.anthropic.com/v1/messages, 본문에 output_config.format(JSON 스키마)·effort·max_tokens, 응답은 parsed_output으로 읽는다', async () => {
  const seen = [];
  const p = createProvider('claude_api', {
    pregen: PREGEN,
    apiKey: FAKE_KEY,
    cache: createLlmCache(null),
    client: sdkClient(async (url, init) => {
      seen.push({ url: String(url), init });
      const sections = parsePrompt(JSON.parse(init.body).messages[0].content);
      const first = sections[0];
      const ev = first.evidence[first.rule[0].evidence_ids[0]];
      const out = { items: [{ key: first.key, sentences: [{ text: first.rule[0].text, evidence_ids: first.rule[0].evidence_ids, quotes: [evidenceBody(ev).trim().slice(0, 20).trim()] }] }] };
      return jsonResponse(200, message(JSON.stringify(out)));
    }),
  });
  const r = await run(p);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.output_config.effort, 'medium');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema.type, 'object');
  assert.equal(body.thinking, undefined);
  assert.ok(typeof body.system === 'string' && body.system.includes('근거 글에 있는 사실만'));
  assert.ok(!seen[0].init.body.includes(FAKE_KEY)); // 키는 본문이 아니라 헤더로만
  assert.equal(r.items.find((i) => i.key === usable[0].key).method, 'llm'); // 응답에 있던 항목만 교체
  assert.equal(r.items.find((i) => i.key === usable[1].key).replaced, true); // 응답에 없던 항목은 규칙 기반
});

test('실제 SDK(가짜 fetch): 401은 재시도 없이 "키가 맞지 않음", 연결 실패는 "연결 실패·시간 초과"', async () => {
  let calls = 0;
  const auth = live(sdkClient(async () => { calls += 1; return jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }); }));
  const r = await run(auth);
  assert.equal(calls, 1);
  assert.match(r.fallback.reason, /키가 맞지 않음/);
  assert.ok(!r.fallback.reason.includes('invalid x-api-key'));
  let tries = 0;
  const down = live(sdkClient(async () => { tries += 1; throw new TypeError('fetch failed'); }));
  const r2 = await run(down);
  assert.equal(tries, 2); // maxRetries 1 → 처음 + 한 번
  assert.match(r2.fallback.reason, /연결 실패·시간 초과/);
});
