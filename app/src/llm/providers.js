// LLM 공급자(D-07 5.4, R-15, CR-1). 화면·기능 코드는 connector.js의 계약만 쓰고, 공급자는 이름으로 고른다.
//   none      — 규칙 기반 그대로
//   pregen    — 사전 생성(기본, CR-1): 개발 중 Claude Code가 작성한 결과(app/data/pregen.js, 12.3)를 조회 키로 찾는다
//   claude_api — 키가 없으면 "연결 전"(규칙 기반으로 돌아가고 이유를 알림). 키가 있으면 실시간 호출(CR-15, D-33): 공식 SDK를 번들에 묶어 쓴다
//   internal — P2(1차 제출 범위 밖). 고르면 이유를 알리고 규칙 기반으로 돌아간다
//   fail      — 점검용 "실패 흉내"(R-04 ③): 호출 실패를 흉내 내 규칙 기반 전환을 보여 준다
// 브라우저 기능을 쓰지 않는다(12.7). 네트워크는 SDK만 부른다(이 파일에서 fetch를 직접 부르지 않는다 — 빌드가 검사).

import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { buildConvertPrompt } from './ai-convert.js';

// 실시간 호출 설정(한 곳). 모델은 설정 창에서 바꿀 수 있다
export const DEFAULT_LLM_MODEL = 'claude-opus-5-5';
export const LLM_MAX_TOKENS = 16000;
export const LLM_EFFORT = 'medium';
export const LLM_TIMEOUT_MS = 30000; // SDK timeout 옵션. 재시도 1회까지 하면 최악 두 배
export const LLM_MAX_RETRIES = 1;
// 문서 AI 변환(T-37): 응답이 길 수 있다. 재시도 없이 이 시간 안에 끝나야 한다(화면 문구 「최대 90초」와 같은 값)
export const LLM_CONVERT_MAX_TOKENS = 32000;
export const LLM_CONVERT_TIMEOUT_MS = 90000;

export const PROVIDERS = [
  { name: 'pregen', label: '사전 생성(개발 시 Claude로 작성)', help: '기본값. 개발 중 Claude로 미리 작성한 문장을 씁니다. 결과가 없거나 데이터가 바뀐 항목은 규칙 기반 문장으로 보입니다.' },
  { name: 'none', label: '규칙 기반만', help: '기록을 규칙으로 옮겨 적은 문장만 씁니다(LLM 없음).' },
  { name: 'claude_api', label: 'Claude API(키를 넣으면 실시간)', help: '키를 넣으면 초안·인사이트 설명 문장을 실시간으로 다듬습니다(근거와 원문 인용이 확인된 문장만 씁니다). 키가 없으면 규칙 기반으로 동작하고 이유를 표시합니다.' },
  { name: 'internal', label: '사내 LLM (다음 단계에서 연결)', help: '사용 방법이 정해지면 이 자리에 연결합니다. 지금은 규칙 기반으로 동작합니다.' },
  { name: 'fail', label: '실패 흉내(점검용)', help: 'LLM 호출이 실패한 상황을 흉내 냅니다. 규칙 기반으로 바뀌고 원인이 표시되는지 확인할 때 씁니다(개발 점검용).' },
];
import { itemEvidence } from '../rules/handover.js';

export const DEFAULT_PROVIDER = 'pregen';

const sortedIds = (ids) => [...new Set(ids)].sort();
/**
 * 사전 생성 조회 키(12.3): 작업, 대상, (초안이면) 항목·보내는 사람>받는 사람, 정렬한 근거 ID.
 * 초안은 사람에 따라 문장(문의할 사람 등)이 달라지므로 보내는·받는 사람이 같을 때만 쓴다(검토3 LLM-1)
 */
export function pregenKey(task, target, item, evidenceIds, people = '') {
  return [task, target, item || '', people, sortedIds(evidenceIds).join(',')].join('|');
}
export const peopleKey = (from, to) => (from && to ? `${from}>${to}` : '');

/**
 * 규칙 기반 문장의 지문(FNV-1a 32비트, 16진수 8자리). 사전 생성 줄에는 만들 때의 규칙 기반 문장 지문(fp)을 넣고,
 * 조회할 때 지금 규칙 기반 문장의 지문과 같을 때만 쓴다 → 근거 ID가 같아도 내용이 바뀐 항목은 규칙 기반으로 돌아간다(K-9, 12.3).
 * 기준일에만 달라지는 "기록 없는 기간" 경고 문장은 지문에서 뺀다(사전 생성 문장에도 넣지 않는다, 검토5 I-6).
 */
const VOLATILE = /개 기간은 기록이 없어 판단하지 않습니다/;
export function fingerprint(sentences) {
  const s = (Array.isArray(sentences) ? sentences : []).map((x) => (x && typeof x.text === 'string' ? x.text : '')).filter((t) => !VOLATILE.test(t)).join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 규칙 기반 초안 항목의 근거 ID 전체 */
export { itemEvidence };

function pregenProvider(file) {
  const index = new Map();
  for (const it of (file && Array.isArray(file.items) ? file.items : [])) {
    if (!it || !Array.isArray(it.evidence_ids) || !Array.isArray(it.sentences)) continue; // 깨진 줄은 건너뛴다
    index.set(pregenKey(it.task, it.target, it.item, it.evidence_ids, peopleKey(it.from, it.to)), it);
  }
  return {
    name: 'pregen',
    method: 'pregen',
    // 초안: 항목마다 키가 맞는 결과만 돌려준다. 맞지 않는 항목(새 데이터·바뀐 근거)은 빠지고 규칙 기반이 남는다(K-9)
    refine(task, draft) {
      const items = [];
      for (const item of draft.items) {
        if (item.insufficient) continue;
        const hit = index.get(pregenKey(task, draft.target, item.key, itemEvidence(item), peopleKey(draft.from, draft.to)));
        if (hit && hit.fp === fingerprint(item.sentences)) items.push({ key: item.key, sentences: hit.sentences });
      }
      return { items };
    },
    // 설명(인사이트 설명 insight_explain, 업무 후보 이유 work_candidate_reason): 대상·근거가 맞고 규칙 기반 문장 지문이 같으면 문장, 아니면 null
    // rule: 지금의 규칙 기반 문장(지문 비교용). 없으면 비교할 수 없으므로 쓰지 않는다
    explain(target, evidenceIds, task = 'insight_explain', rule = null) {
      const hit = index.get(pregenKey(task, target, '', evidenceIds));
      return hit && rule && hit.fp === fingerprint(rule) ? { sentences: hit.sentences } : null;
    },
  };
}

/** 실시간 호출 오류(원인 분류가 끝난 것). code: auth|forbidden|rate|connect|timeout|notfound|api|format|refusal|unknown */
export class LlmError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
  }
}

/**
 * SDK 오류를 종류별로 나눈다(문자열 비교 없이 SDK 오류 클래스로만, 시간 초과는 연결 오류의 하위 클래스라 먼저 본다).
 * 응답에는 키가 들어 있지 않지만, 어떤 경우에도 원문 메시지는 화면에 내지 않고 정해 둔 문구만 낸다
 */
export function classifyLlmError(err) {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new LlmError('auth', '키가 맞지 않음');
  if (err instanceof Anthropic.PermissionDeniedError) return new LlmError('forbidden', '키에 이 모델을 쓸 권한이 없음');
  if (err instanceof Anthropic.RateLimitError) return new LlmError('rate', '요청 한도 초과(잠시 뒤 다시 시도)');
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError('timeout', '연결 실패·시간 초과');
  if (err instanceof Anthropic.APIConnectionError) return new LlmError('connect', '연결 실패·시간 초과');
  if (err instanceof Anthropic.NotFoundError) return new LlmError('notfound', '모델 이름을 찾을 수 없음(설정의 모델 칸 확인)');
  if (err instanceof Anthropic.APIError) return new LlmError('api', `API 오류(상태 ${err.status === undefined ? '없음' : err.status})`);
  if (err instanceof Anthropic.AnthropicError) return new LlmError('format', '응답 형식 오류');
  return new LlmError('unknown', '알 수 없는 오류');
}

/**
 * 실시간 공급자(Claude API). 네트워크는 공식 SDK만 부른다.
 *  - live: true — 연결부(connector)가 비동기 경로(refineDraftAsync·explainInsightAsync)로 부르는 표지
 *  - base — 먼저 그릴 때 쓰는 동기 공급자(사전 생성). 화면은 base 결과를 먼저 그리고 응답이 오면 교체한다(R-04 ③)
 *  - refine(task, {system, user, schema}) → Promise<파싱된 JSON>. 오류는 LlmError로 던진다. 검증(근거 ID·quote)은 연결부가 한다
 *  - client는 시험용으로 주입한다(messages.parse를 흉내 내는 가짜). 없으면 SDK를 처음 부를 때 만든다
 */
function claudeProvider({ apiKey, model, client = null, base = null, cache = null }) {
  const useModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_LLM_MODEL;
  let cli = client;
  const getClient = () => {
    if (!cli) cli = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: LLM_TIMEOUT_MS, maxRetries: LLM_MAX_RETRIES });
    return cli;
  };
  return {
    name: 'claude_api',
    method: 'llm',
    live: true,
    model: useModel,
    base,
    cache,
    refine: (task, prompt) => request(prompt, LLM_MAX_TOKENS, undefined),
    // 문서 AI 변환(T-37): 응답이 길 수 있어 max_tokens·시간 제한이 따로이고, 재시도하지 않는다(화면의 「최대 90초」가 곧 최악의 시간)
    async convert(text) {
      return request(buildConvertPrompt(text), LLM_CONVERT_MAX_TOKENS, { timeout: LLM_CONVERT_TIMEOUT_MS, maxRetries: 0 });
    },
  };

  async function request({ system, user, schema }, maxTokens, options) {
    let msg;
    try {
      const body = {
        model: useModel,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: LLM_EFFORT, format: jsonSchemaOutputFormat(schema) },
      };
      msg = await (options ? getClient().messages.parse(body, options) : getClient().messages.parse(body));
    } catch (err) {
      throw classifyLlmError(err);
    }
    if (msg && msg.stop_reason === 'refusal') throw new LlmError('refusal', '모델이 응답을 거절함');
    // 출력이 max_tokens에서 잘렸으면 JSON이 끝나지 않았으니 쓰지 않는다
    if (msg && msg.stop_reason === 'max_tokens') throw new LlmError('format', '응답이 길어 도중에 끊김');
    let out = msg ? msg.parsed_output : null;
    if (!out && msg && Array.isArray(msg.content)) {
      const block = msg.content.find((b) => b && b.type === 'text' && typeof b.text === 'string');
      try {
        out = block ? JSON.parse(block.text) : null;
      } catch {
        out = null;
      }
    }
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw new LlmError('format', '응답 형식 오류');
    return out;
  }
}

function unavailable(name, reason) {
  const fail = () => {
    throw new Error(reason);
  };
  return { name, method: 'llm', refine: fail, explain: fail, convert: fail };
}

/**
 * @param {string} name 공급자 이름
 * @param {{pregen?: object, apiKey?: string, model?: string, client?: object, cache?: object}} deps pregen: 사전 생성 결과 파일 내용. apiKey·model·client·cache는 claude_api 전용(client는 시험용 가짜, cache는 응답 캐시)
 * @returns {object|null} null이면 규칙 기반(none)
 */
export function createProvider(name, { pregen, apiKey = '', model = '', client = null, cache = null } = {}) {
  switch (name) {
    case 'none':
      return null;
    case 'claude_api':
      // 키가 없으면 지금처럼 "연결 전"(규칙 기반 + 이유). 키가 있어야만 실시간 호출 경로가 생긴다
      if (typeof apiKey !== 'string' || !apiKey.trim()) return unavailable(name, 'Claude API는 이번 제출물에 연결하지 않았습니다(다음 단계)');
      return claudeProvider({ apiKey: apiKey.trim(), model, client, base: pregenProvider(pregen), cache });
    case 'internal':
      return unavailable(name, '사내 LLM은 사용 방법이 정해지지 않아 연결하지 않았습니다(다음 단계)');
    case 'fail':
      return unavailable(name, '호출 실패(점검용 흉내)');
    case 'pregen':
    default:
      return pregenProvider(pregen);
  }
}
